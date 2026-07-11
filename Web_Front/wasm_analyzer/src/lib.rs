use wasm_bindgen::prelude::*;
use std::io::Cursor;
use serde::Serialize;
use oa_sample_analyzer::analyze::analyze_buffer;

#[wasm_bindgen]
pub fn analyze_audio_buffer(buffer: &[u8], name: &str, folder: &str) -> String {
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
