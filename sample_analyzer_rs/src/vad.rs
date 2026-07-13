use webrtc_vad::{SampleRate, Vad, VadMode};

/// The VAD's two answers from a single pass: the *fraction* of 20 ms frames it
/// calls voiced (None when the file is too short for even one frame), and the
/// boolean "this contains voice" the god-category assignment uses.
///
/// The ratio is the spec's `voicing_ratio` (§4b), referenced by 148 UCS priors —
/// CROWDS-CHEERING vs CROWDS-APPLAUSE is exactly this number. The VAD was already
/// computing it and throwing it away behind the boolean. They share a pass
/// because resampling to 16 kHz and running WebRTC over the file is the most
/// expensive thing in the extractor; doing it twice to get two views of the same
/// count would be pure waste.
pub fn voice_activity(data: &[f32], sr: u32) -> (Option<f64>, bool) {
    let (voice_frames, total_frames) = count_voice_frames(data, sr);
    let ratio = (total_frames > 0).then(|| voice_frames as f64 / total_frames as f64);
    // Containing voice: >100 ms of it, or >5 % of the file.
    let has_voice = voice_frames >= 5 || ratio.is_some_and(|r| r > 0.05);
    (ratio, has_voice)
}

/// Returns true if significant voice activity is detected in the audio.
pub fn has_voice(data: &[f32], sr: u32) -> bool {
    voice_activity(data, sr).1
}

/// (voiced frames, total frames) at 20 ms per frame.
fn count_voice_frames(data: &[f32], sr: u32) -> (usize, usize) {
    if data.is_empty() {
        return (0, 0);
    }

    // WebRTC VAD requires 8, 16, 32, or 48 kHz. We'll resample to 16 kHz.
    let target_sr = 16000;
    
    // Simple linear interpolation resampler
    let mut resampled = Vec::new();
    let ratio = sr as f64 / target_sr as f64;
    let new_len = (data.len() as f64 / ratio).floor() as usize;
    
    for i in 0..new_len {
        let src_idx = i as f64 * ratio;
        let idx_floor = src_idx.floor() as usize;
        let idx_ceil = (idx_floor + 1).min(data.len() - 1);
        let weight = src_idx - idx_floor as f64;
        
        let sample_f32 = data[idx_floor] * (1.0 - weight as f32) + data[idx_ceil] * weight as f32;
        
        // Convert f32 [-1.0, 1.0] to i16
        let sample_i16 = (sample_f32.clamp(-1.0, 1.0) * 32767.0) as i16;
        resampled.push(sample_i16);
    }
    
    let mut vad = Vad::new_with_rate_and_mode(SampleRate::Rate16kHz, VadMode::Aggressive);
    
    let frame_size = 320; // 20ms at 16kHz
    
    let mut voice_frames = 0;
    let mut total_frames = 0;
    
    for frame in resampled.chunks(frame_size) {
        if frame.len() == frame_size {
            total_frames += 1;
            if let Ok(true) = vad.is_voice_segment(frame) {
                voice_frames += 1;
            }
        }
    }

    (voice_frames, total_frames)
}
