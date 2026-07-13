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

    // Splice the per-category files into a single JSON array. No parsing needed:
    // each file is already a complete JSON object.
    let bodies: Vec<String> = cat_files
        .iter()
        .map(|p| fs::read_to_string(p).unwrap_or_else(|e| panic!("read {}: {e}", p.display())))
        .map(|s| s.trim().to_string())
        .collect();
    let bundle = format!("[{}]", bodies.join(","));

    let out = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
    fs::write(out.join("ucs_signed.json"), &bundle).expect("write ucs_signed.json");

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

    println!("cargo:rustc-env=ANALYZER_REV={:016x}", h);
}
