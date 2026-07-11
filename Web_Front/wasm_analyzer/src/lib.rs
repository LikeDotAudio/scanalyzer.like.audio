use wasm_bindgen::prelude::*;
use std::io::Cursor;
use serde::Serialize;
use hound::WavReader;

#[derive(Serialize)]
pub struct AudioAnalysisResult {
    pub channels: u16,
    pub sample_rate: u32,
    pub duration_seconds: f32,
    pub bit_depth: u16,
    pub status: String,
}

#[wasm_bindgen]
pub fn analyze_audio_buffer(buffer: &[u8]) -> String {
    let cursor = Cursor::new(buffer);
    
    match WavReader::new(cursor) {
        Ok(reader) => {
            let spec = reader.spec();
            let duration = reader.duration();
            let duration_seconds = duration as f32 / spec.sample_rate as f32;
            
            let result = AudioAnalysisResult {
                channels: spec.channels,
                sample_rate: spec.sample_rate,
                duration_seconds,
                bit_depth: spec.bits_per_sample,
                status: "success".to_string(),
            };
            
            serde_json::to_string(&result).unwrap_or_else(|_| "{\"status\":\"error\"}".to_string())
        }
        Err(e) => {
            format!("{{\"status\":\"error\", \"message\":\"{}\"}}", e)
        }
    }
}
