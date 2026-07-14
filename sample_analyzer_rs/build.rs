//! Two jobs at compile time:
//!
//! 1. Bundle the UCS category data. The signed category files in UCS/categories/
//!    are the source of truth; the analyzer used to carry its own stale copy,
//!    which drifted. We now splice them into one array in OUT_DIR and embed
//!    that, so the two cannot disagree.
//!
//! 2. Stamp the build with an analyzer revision: an FNV-1a hash over all of
//!    src/*.rs AND the UCS data. Same inputs ⇒ same revision ⇒ existing .PEAK
//!    sidecars stay valid; any change to an extractor OR to a category
//!    signature produces a new revision and invalidates them.
use std::fs;
use std::path::{Path, PathBuf};

fn sorted_files(dir: &Path, ext: &str) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("read_dir {}: {e}", dir.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some(ext))
        .collect();
    v.sort();
    v
}

fn main() {
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=../UCS/categories");

    let ucs_dir = Path::new("../UCS/categories");
    let cat_files: Vec<PathBuf> = sorted_files(ucs_dir, "json")
        .into_iter()
        .filter(|p| p.file_name().and_then(|x| x.to_str()) != Some("index.json"))
        .collect();
    assert!(
        !cat_files.is_empty(),
        "no UCS category files under {} — the analyzer cannot classify without them",
        ucs_dir.display()
    );

    // Splice the per-category files into a single JSON array, MINIFIED.
    //
    // The category files on disk are pretty-printed for humans to read and diff,
    // and that indentation is ~29 % of their bytes. This bundle is `include_str!`d
    // into the binary, so every one of those spaces used to be compiled into the
    // analyzer *and* shipped to the browser inside the WASM engine — 822 KB of
    // whitespace downloaded by every visitor. Re-serializing compact here costs a
    // build-time parse and changes nothing about what the data MEANS: serde parses
    // both forms to the same structs.
    //
    // A file may opt out of the matcher with `"matchable": false`. Those describe a
    // different axis (MUSICPROD answers "what role does this play in a production",
    // not "what is this sound"), and they reuse the synonyms and signatures of a real
    // UCS category. Letting one into the index would give every music sample a twin
    // candidate with an identical signature — splitting the posterior and lowering
    // the IDF of every music token. They are bundled separately instead.
    let matchable = |p: &PathBuf| -> bool {
        let text = fs::read_to_string(p).unwrap_or_else(|e| panic!("read {}: {e}", p.display()));
        let value: serde_json::Value = serde_json::from_str(&text)
            .unwrap_or_else(|e| panic!("{} is not valid JSON: {e}", p.display()));
        value.get("matchable").and_then(|m| m.as_bool()).unwrap_or(true)
    };

    let bodies: Vec<String> = cat_files
        .iter()
        .filter(|p| matchable(p))
        .map(|p| {
            let text = fs::read_to_string(p).unwrap_or_else(|e| panic!("read {}: {e}", p.display()));
            let value: serde_json::Value = serde_json::from_str(&text)
                .unwrap_or_else(|e| panic!("{} is not valid JSON: {e}", p.display()));
            serde_json::to_string(&value).expect("re-serialize category")
        })
        .collect();
    let bundle = format!("[{}]", bodies.join(","));

    // The opted-out files, bundled on their own. MUSICPROD is read from here.
    let role_bodies: Vec<String> = cat_files
        .iter()
        .filter(|p| !matchable(p))
        .map(|p| {
            let text = fs::read_to_string(p).unwrap_or_else(|e| panic!("read {}: {e}", p.display()));
            let value: serde_json::Value = serde_json::from_str(&text)
                .unwrap_or_else(|e| panic!("{} is not valid JSON: {e}", p.display()));
            serde_json::to_string(&value).expect("re-serialize category")
        })
        .collect();
    let role_bundle = format!("[{}]", role_bodies.join(","));

    let out = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
    fs::write(out.join("ucs_signed.json"), &bundle).expect("write ucs_signed.json");
    fs::write(out.join("ucs_roles.json"), &role_bundle).expect("write ucs_roles.json");

    // Revision hash over the extractors and the category data together.
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut absorb = |bytes: &[u8]| {
        for b in bytes {
            h ^= *b as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    for p in sorted_files(Path::new("src"), "rs") {
        absorb(&fs::read(&p).expect("read src file"));
    }
    absorb(bundle.as_bytes());
    // The role taxonomy decides a field we write into every record, so a change to
    // it must invalidate existing sidecars exactly as a change to a signature does.
    absorb(role_bundle.as_bytes());

    println!("cargo:rustc-env=ANALYZER_REV={:016x}", h);

    let date_output = std::process::Command::new("date")
        .arg("+%Y%m%d.%H%M")
        .output()
        .expect("failed to execute date command");
    let date_str = String::from_utf8_lossy(&date_output.stdout).trim().to_string();
    println!("cargo:rustc-env=ANALYZER_DATE={}", date_str);
}
