//! wasm_extractor — the Extractor's cutting engine, exposed to the web front.
//!
//! A stateful [`ExtractorSession`] holds the decoded PCM once, so live slider re-detects
//! only pass a small params string across the wasm boundary rather than re-copying the
//! multi-megabyte buffer every tick. The DSP itself lives in `extractor_engine`; the
//! per-chunk UCS analysis reuses `oa_sample_analyzer::analyze::analyze_buffer`, so a slice
//! becomes a first-class analyzed sample without a second decode path.

use extractor_engine::{
    detect_regions_from_samples, encode_wav_pcm16, slice_region, DetectParams, FadeCurve, Region,
};
use oa_sample_analyzer::analyze::analyze_buffer;
use wasm_bindgen::prelude::*;

/// The version this engine reports. Bumping the crate version invalidates any cached
/// client assumptions the way `analyzer_version()` does for the analyzer.
#[wasm_bindgen]
pub fn extractor_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// One loaded audio buffer the Extractor edits. Constructed once per file from browser-
/// decoded mono PCM; every detect/slice/analyze call reuses it.
#[wasm_bindgen]
pub struct ExtractorSession {
    samples: Vec<f32>,
    sample_rate: u32,
}

#[wasm_bindgen]
impl ExtractorSession {
    /// Take ownership of the decoded mono PCM. The Float32Array crosses the boundary once
    /// here, not on every re-detect.
    #[wasm_bindgen(constructor)]
    pub fn new(samples: &[f32], sample_rate: u32) -> ExtractorSession {
        console_error_panic_hook::set_once();
        ExtractorSession {
            samples: samples.to_vec(),
            sample_rate,
        }
    }

    /// Detect regions with the given parameters (`params_json` is a `DetectParams`; empty
    /// or invalid JSON falls back to the improved defaults). Returns a JSON array of
    /// `Region`.
    pub fn detect(&self, params_json: &str) -> String {
        let params: DetectParams = serde_json::from_str(params_json).unwrap_or_default();
        let regions = detect_regions_from_samples(&self.samples, self.sample_rate, &params);
        serde_json::to_string(&regions).unwrap_or_else(|_| "[]".to_string())
    }

    /// Slice one region (a JSON `Region`, carrying its own fade fields) to 16-bit PCM WAV
    /// bytes for download / write-to-disk.
    pub fn slice_wav(&self, region_json: &str) -> Vec<u8> {
        match serde_json::from_str::<Region>(region_json) {
            Ok(region) => {
                let slice = slice_region(&self.samples, self.sample_rate, &region, FadeCurve::Linear);
                encode_wav_pcm16(&slice, self.sample_rate)
            }
            Err(_) => Vec::new(),
        }
    }

    /// Slice → WAV → full UCS analysis. Returns the `Peak` JSON, or `{"status":"too_short"}`
    /// when the chunk is too short for the analyzer to extract features (do NOT fabricate a
    /// Peak for a sub-window blip).
    pub fn analyze_chunk(&self, region_json: &str, name: &str, folder: &str) -> String {
        let region: Region = match serde_json::from_str(region_json) {
            Ok(r) => r,
            Err(_) => return "{\"status\":\"error\",\"message\":\"bad region\"}".to_string(),
        };
        let slice = slice_region(&self.samples, self.sample_rate, &region, FadeCurve::Linear);
        if slice.len() < 2 {
            return "{\"status\":\"too_short\"}".to_string();
        }
        let wav = encode_wav_pcm16(&slice, self.sample_rate);
        match analyze_buffer(&wav, name, folder, 600.0) {
            Some(peak) => serde_json::to_string(&peak).unwrap_or_else(|_| "{\"status\":\"error\"}".to_string()),
            None => "{\"status\":\"too_short\"}".to_string(),
        }
    }
}
