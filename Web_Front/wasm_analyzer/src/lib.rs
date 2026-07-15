use wasm_bindgen::prelude::*;
use std::io::Cursor;
use serde::Serialize;
use oa_sample_analyzer::analyze::analyze_buffer;
use oa_sample_analyzer::decode::read_audio_buffer;

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

/// PCM decoded from a compressed/lossy file, handed back to JS so the Examiner and
/// Extractor can draw a waveform preview on the desktop webview (WebKitGTK), whose
/// Web Audio `decodeAudioData` rejects MP3/OGG/M4A/AAC/FLAC/AIFF. `samples` is
/// interleaved f32 (frame-major); JS de-interleaves into an AudioBuffer.
#[wasm_bindgen]
pub struct DecodedAudio {
    interleaved: Vec<f32>,
    sample_rate: u32,
    channels: u16,
}

#[wasm_bindgen]
impl DecodedAudio {
    #[wasm_bindgen(getter)]
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }
    #[wasm_bindgen(getter)]
    pub fn channels(&self) -> u16 {
        self.channels
    }
    /// Interleaved samples, copied into a JS-owned Float32Array.
    #[wasm_bindgen(getter)]
    pub fn samples(&self) -> Vec<f32> {
        self.interleaved.clone()
    }
}

/// Decode `buffer` to interleaved PCM. `name` supplies the extension hint (may be
/// empty — WAV is caught by magic bytes and the rest is content-probed). Returns
/// `undefined` when the bytes can't be decoded by any supported codec.
#[wasm_bindgen]
pub fn decode_audio_buffer(buffer: &[u8], name: &str) -> Option<DecodedAudio> {
    console_error_panic_hook::set_once();
    let dec = read_audio_buffer(buffer, name)?;
    Some(DecodedAudio {
        interleaved: dec.raw,
        sample_rate: dec.sample_rate,
        channels: dec.channels,
    })
}
