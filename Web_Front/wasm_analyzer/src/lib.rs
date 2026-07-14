use wasm_bindgen::prelude::*;
use std::io::Cursor;
use serde::Serialize;
use oa_sample_analyzer::analyze::analyze_buffer;

/// The version stamp this engine writes into every record: crate version + a
/// hash of the extractor sources.
///
/// The scanner uses it to decide whether a `.PEAK` sidecar sitting next to an
/// audio file can be *absorbed* instead of recomputed. A sidecar carrying this
/// exact version was produced by identical extractor code, so re-analyzing the
/// file is guaranteed to reproduce it bit for bit — the only thing a re-scan
/// would buy is the time it costs. Any other version means the code moved and
/// the record must be recomputed.
///
/// This is the same constant the native binary stamps, so a library analyzed on
/// the desktop is absorbed by the web front for free, and vice versa.
#[wasm_bindgen]
pub fn analyzer_version() -> String {
    oa_sample_analyzer::version::ANALYZER_VERSION.to_string()
}

#[wasm_bindgen]
pub fn analyze_audio_buffer(buffer: &[u8], name: &str, folder: &str) -> String {
    console_error_panic_hook::set_once();
    // Note: max_len is hardcoded to 600.0 (10 minutes) for the web version to prevent hangs
    match analyze_buffer(buffer, name, folder, 600.0) {
        Some(peak) => {
            serde_json::to_string(&peak).unwrap_or_else(|_| "{\"status\":\"error\"}".to_string())
        }
        None => {
            "{\"status\":\"error\", \"message\":\"analysis failed or file too long\"}".to_string()
        }
    }
}
