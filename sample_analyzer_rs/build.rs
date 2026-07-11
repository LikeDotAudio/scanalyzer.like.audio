//! Stamp each compile with an analyzer revision: an FNV-1a hash over all of
//! src/*.rs. Same source ⇒ same revision ⇒ existing .PEAK sidecars stay valid;
//! any change to the extractors produces a new revision and invalidates them.
use std::fs;

fn main() {
    println!("cargo:rerun-if-changed=src");
    let mut entries: Vec<_> = fs::read_dir("src")
        .expect("src dir")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("rs"))
        .collect();
    entries.sort();
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for p in entries {
        for b in fs::read(&p).expect("read src file") {
            h ^= b as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    println!("cargo:rustc-env=ANALYZER_REV={:016x}", h);
}
