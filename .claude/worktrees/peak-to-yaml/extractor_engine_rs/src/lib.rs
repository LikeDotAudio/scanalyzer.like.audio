//! extractor_engine — the single source of truth for the Extractor's cutting DSP.
//!
//! Pure DSP: it receives already-decoded **mono f32 PCM + sample rate** and returns
//! regions, sliced-and-faded audio, and 16-bit WAV bytes. It decodes nothing and depends
//! on nothing app-specific, so it is a leaf crate: the web build (`wasm_extractor`) and,
//! later, the analyzer both call these exact functions and therefore cut identically —
//! no more hand-maintained TypeScript/Rust mirror drifting apart.
//!
//! The framing (RMS envelope at ~200 fps, hop = sr/200) matches the analyzer's
//! `amplitude_envelope` and the retired `detectRegions.ts`, so a region's frame→seconds
//! mapping is unchanged.

use serde::{Deserialize, Serialize};

/// Bound on the region count so a pathological file can't produce a runaway list.
const MAX_REGIONS: usize = 512;

/// One detected region ("chunk"). The seconds/peak/name fields mirror
/// `sample_analyzer_rs` `Core/peak.rs::Region` (so the JSON matches the `.PEAK` schema);
/// the fade fields are Extractor-only and `serde(default)` so records without them
/// round-trip cleanly.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Region {
    pub index: usize,
    pub start_seconds: f64,
    pub end_seconds: f64,
    pub duration_seconds: f64,
    #[serde(default)]
    pub peak_amplitude: f64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub fade_in_seconds: f64,
    #[serde(default)]
    pub fade_out_seconds: f64,
}

/// Fade shape applied to a slice. `Linear` reproduces the historical JS export exactly;
/// `EqualPower` (sine) holds constant perceived loudness across the ramp.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum FadeCurve {
    Linear,
    EqualPower,
}

impl Default for FadeCurve {
    fn default() -> Self {
        FadeCurve::Linear
    }
}

/// Detection parameters. [`DetectParams::default`] is the *improved* algorithm the
/// Extractor UI uses; [`DetectParams::legacy`] degenerates to the exact historical
/// behavior so the analyzer's stored `.PEAK` regions never silently change when it later
/// delegates here.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DetectParams {
    /// Gate OPENS when the envelope rises above this many dB below the file's peak.
    pub open_threshold_db: f64,
    /// Gate CLOSES only when it falls below this lower floor (hysteresis). Must be
    /// `<= open_threshold_db`; a wobble between the two can't chatter a region in two.
    pub close_threshold_db: f64,
    /// A gap shorter than this is a dip *within* a region, not a break between two.
    pub minimum_silence_seconds: f64,
    /// A sounding stretch shorter than this is a click, not a region — dropped.
    pub minimum_region_seconds: f64,
    /// Extend each region's start earlier so onsets aren't clipped.
    pub attack_pad_seconds: f64,
    /// Extend each region's end later so decay tails aren't clipped.
    pub release_pad_seconds: f64,
    /// Snap the start to the true attack (steepest local energy rise) near the gate open.
    pub transient_aware: bool,
    /// Snap in/out sample indices to the nearest zero crossing — kills export clicks.
    pub snap_zero_crossing: bool,
}

impl Default for DetectParams {
    fn default() -> Self {
        Self {
            open_threshold_db: -40.0,
            // 6 dB of hysteresis below the open floor: enough to bridge a wobble, not so
            // wide that two genuinely separate-but-quiet hits merge.
            close_threshold_db: -46.0,
            minimum_silence_seconds: 0.15,
            minimum_region_seconds: 0.05,
            attack_pad_seconds: 0.010,
            release_pad_seconds: 0.030,
            transient_aware: true,
            snap_zero_crossing: true,
        }
    }
}

impl DetectParams {
    /// The historical algorithm, bit-for-bit: single threshold (open == close), no padding,
    /// no onset/zero-cross refinement. Used by the analyzer so stored regions don't move.
    pub fn legacy() -> Self {
        Self {
            open_threshold_db: -40.0,
            close_threshold_db: -40.0,
            minimum_silence_seconds: 0.15,
            minimum_region_seconds: 0.05,
            attack_pad_seconds: 0.0,
            release_pad_seconds: 0.0,
            transient_aware: false,
            snap_zero_crossing: false,
        }
    }
}

/// RMS amplitude envelope at ~200 fps (hop = sr/200) — identical framing to the analyzer's
/// `amplitude_envelope`, so `frame / rate_hz` gives the same seconds. Returns `(envelope,
/// rate_hz)`.
pub fn amplitude_envelope(samples: &[f32], sample_rate: u32) -> (Vec<f64>, f64) {
    let hop = ((sample_rate as f64 / 200.0).floor() as usize).max(1);
    let rate_hz = sample_rate as f64 / hop as f64;
    let mut env = Vec::with_capacity(samples.len() / hop + 1);
    let mut i = 0;
    while i < samples.len() {
        let end = (i + hop).min(samples.len());
        let mut s = 0.0f64;
        for &x in &samples[i..end] {
            s += (x as f64) * (x as f64);
        }
        env.push((s / (end - i) as f64).sqrt());
        i += hop;
    }
    (env, rate_hz)
}

/// Hysteresis-gated, gap-bridged runs of above-threshold frames, as
/// `(start_frame, end_frame_exclusive, peak_amplitude)`. Shared by the envelope-only and
/// sample-based detection paths.
fn gate_and_merge(envelope: &[f64], rate_hz: f64, p: &DetectParams) -> Vec<(usize, usize, f64)> {
    let n = envelope.len();
    if n == 0 || rate_hz <= 0.0 {
        return Vec::new();
    }
    let peak = envelope.iter().cloned().fold(0.0f64, f64::max);
    if peak <= 1e-9 {
        return Vec::new(); // digitally silent: no regions at all
    }
    let open = peak * 10f64.powf(p.open_threshold_db / 20.0);
    let close = peak * 10f64.powf(p.close_threshold_db.min(p.open_threshold_db) / 20.0);
    let min_silence_frames = (p.minimum_silence_seconds * rate_hz).round() as usize;

    // Hysteresis gate: open above `open`, stay open until the envelope falls below `close`.
    let mut runs: Vec<(usize, usize, f64)> = Vec::new();
    let mut i = 0;
    while i < n {
        if envelope[i] >= open {
            let start = i;
            let mut pk = 0.0f64;
            while i < n && envelope[i] >= close {
                if envelope[i] > pk {
                    pk = envelope[i];
                }
                i += 1;
            }
            runs.push((start, i, pk));
        } else {
            i += 1;
        }
    }

    // Bridge runs separated by a gap shorter than the minimum silence.
    let mut merged: Vec<(usize, usize, f64)> = Vec::new();
    for r in runs {
        if let Some(last) = merged.last_mut() {
            if r.0.saturating_sub(last.1) < min_silence_frames {
                last.1 = r.1;
                last.2 = last.2.max(r.2);
                continue;
            }
        }
        merged.push(r);
    }
    merged
}

/// Detect regions from a precomputed RMS envelope — the analyzer-parity path (no raw
/// samples, so no zero-cross/onset refinement). With [`DetectParams::legacy`] this is
/// identical to the historical `regions.rs`. `length_seconds` clamps the final out-point.
pub fn detect_regions_with_params(
    envelope: &[f64],
    rate_hz: f64,
    length_seconds: f64,
    p: &DetectParams,
) -> Vec<Region> {
    let merged = gate_and_merge(envelope, rate_hz, p);
    let mut regions: Vec<Region> = Vec::new();
    for (sf, ef, pk) in merged {
        let start_seconds = sf as f64 / rate_hz;
        let mut end_seconds = ef as f64 / rate_hz;
        if length_seconds > 0.0 && end_seconds > length_seconds {
            end_seconds = length_seconds;
        }
        let duration_seconds = end_seconds - start_seconds;
        if duration_seconds < p.minimum_region_seconds {
            continue;
        }
        regions.push(Region {
            index: regions.len(),
            start_seconds,
            end_seconds,
            duration_seconds,
            peak_amplitude: pk,
            name: String::new(),
            fade_in_seconds: 0.0,
            fade_out_seconds: 0.0,
        });
        if regions.len() >= MAX_REGIONS {
            break;
        }
    }
    regions
}

/// Detect regions straight from mono PCM — the Extractor path. Computes the envelope
/// internally (so a caller can't drift the hop), gates it, then refines each cut with the
/// improvements the envelope-only path can't do: transient-aware onset, attack/release
/// padding, and zero-crossing snap.
pub fn detect_regions_from_samples(samples: &[f32], sample_rate: u32, p: &DetectParams) -> Vec<Region> {
    if samples.is_empty() || sample_rate == 0 {
        return Vec::new();
    }
    let (env, rate_hz) = amplitude_envelope(samples, sample_rate);
    let merged = gate_and_merge(&env, rate_hz, p);
    if merged.is_empty() {
        return Vec::new();
    }

    let sr = sample_rate as f64;
    let total = samples.len() as isize;
    let pad_a = (p.attack_pad_seconds * sr).round() as isize;
    let pad_r = (p.release_pad_seconds * sr).round() as isize;

    let mut regions: Vec<Region> = Vec::new();
    for (sf, ef, pk) in merged {
        // Drop clicks on the DETECTED span, before padding — otherwise the attack/release
        // pad would inflate a sub-threshold blip above the minimum and defeat the filter.
        let detected_seconds = (ef as f64 - sf as f64) / rate_hz;
        if detected_seconds < p.minimum_region_seconds {
            continue;
        }

        // Frame → sample.
        let mut s = ((sf as f64 / rate_hz) * sr).round() as isize;
        let mut e = ((ef as f64 / rate_hz) * sr).round() as isize;

        // Tighten the start onto the true attack before padding widens it.
        if p.transient_aware {
            s = refine_onset(samples, sample_rate, s);
        }
        s -= pad_a;
        e += pad_r;

        // Land both cuts on a zero crossing so a slice starts/ends at silence.
        if p.snap_zero_crossing {
            s = snap_to_zero_crossing(samples, s, sample_rate);
            e = snap_to_zero_crossing(samples, e, sample_rate);
        }

        let s = s.clamp(0, total) as usize;
        let e = (e.clamp(0, total) as usize).max(s);
        let start_seconds = s as f64 / sr;
        let end_seconds = e as f64 / sr;
        let duration_seconds = end_seconds - start_seconds;
        if duration_seconds < p.minimum_region_seconds {
            continue;
        }
        regions.push(Region {
            index: regions.len(),
            start_seconds,
            end_seconds,
            duration_seconds,
            peak_amplitude: pk,
            name: String::new(),
            fade_in_seconds: 0.0,
            fade_out_seconds: 0.0,
        });
        if regions.len() >= MAX_REGIONS {
            break;
        }
    }

    // Padding can push a region's end past the next region's start; clamp so they don't
    // overlap (a slice never contains audio that belongs to the next chunk).
    for k in 0..regions.len().saturating_sub(1) {
        let next_start = regions[k + 1].start_seconds;
        if regions[k].end_seconds > next_start {
            regions[k].end_seconds = next_start;
            regions[k].duration_seconds = (regions[k].end_seconds - regions[k].start_seconds).max(0.0);
        }
    }
    regions
}

/// Nearest sample to `idx` where the waveform crosses zero, searched within ~3 ms. A cut
/// on a zero crossing has no step discontinuity, so it doesn't click.
pub fn snap_to_zero_crossing(samples: &[f32], idx: isize, sample_rate: u32) -> isize {
    let n = samples.len() as isize;
    if n < 2 {
        return idx.clamp(0, (n - 1).max(0));
    }
    let radius = ((sample_rate as f64 * 0.003).round() as isize).max(1);
    let c = idx.clamp(0, n - 1);
    let lo = (c - radius).max(1);
    let hi = (c + radius).min(n - 1);
    let mut best = c;
    let mut best_d = isize::MAX;
    let mut j = lo;
    while j <= hi {
        let a = samples[(j - 1) as usize];
        let b = samples[j as usize];
        if (a <= 0.0 && b >= 0.0) || (a >= 0.0 && b <= 0.0) {
            let d = (j - c).abs();
            if d < best_d {
                best_d = d;
                best = j;
            }
        }
        j += 1;
    }
    best
}

/// Refine a gate-open sample index to the true attack: within a short look-back window,
/// the point of steepest short-time-energy rise. Keeps starts tight instead of a frame
/// early. Returns a sample index `<= near`.
pub fn refine_onset(samples: &[f32], sample_rate: u32, near: isize) -> isize {
    let n = samples.len() as isize;
    if n < 2 {
        return near.clamp(0, (n - 1).max(0));
    }
    // Look back ~30 ms — a hop of the envelope — for the rising edge.
    let window = ((sample_rate as f64 * 0.030).round() as isize).max(1);
    let step = ((sample_rate as f64 * 0.002).round() as isize).max(1);
    let lo = (near - window).max(0);
    let hi = near.clamp(0, n - 1);
    let mut best = near;
    let mut best_slope = 0.0f32;
    let mut j = lo;
    while j + step <= hi {
        let e0 = local_energy(samples, j, step);
        let e1 = local_energy(samples, j + step, step);
        let slope = e1 - e0;
        if slope > best_slope {
            best_slope = slope;
            best = j;
        }
        j += step;
    }
    best
}

fn local_energy(samples: &[f32], start: isize, len: isize) -> f32 {
    let n = samples.len() as isize;
    let a = start.clamp(0, n);
    let b = (start + len).clamp(0, n);
    if b <= a {
        return 0.0;
    }
    let mut s = 0.0f32;
    for k in a..b {
        let x = samples[k as usize];
        s += x * x;
    }
    (s / (b - a) as f32).sqrt()
}

/// Apply a fade-in over the first `fade_in_seconds` and a fade-out over the last
/// `fade_out_seconds`, in place. Same gain the preview player must reproduce so what you
/// hear is what you export.
pub fn apply_fades(buf: &mut [f32], sample_rate: u32, fade_in_seconds: f64, fade_out_seconds: f64, curve: FadeCurve) {
    let sr = sample_rate as f64;
    let len = buf.len();
    let fi = ((fade_in_seconds.max(0.0) * sr) as usize).min(len);
    let fo = ((fade_out_seconds.max(0.0) * sr) as usize).min(len);
    let gain = |t: f32| -> f32 {
        match curve {
            FadeCurve::Linear => t,
            FadeCurve::EqualPower => (t * std::f32::consts::FRAC_PI_2).sin(),
        }
    };
    for i in 0..fi {
        buf[i] *= gain(i as f32 / fi as f32);
    }
    for i in 0..fo {
        buf[len - 1 - i] *= gain(i as f32 / fo as f32);
    }
}

/// Cut `[start_sample, end_sample)` out of the buffer and apply the fades.
pub fn slice_samples(
    samples: &[f32],
    start_sample: usize,
    end_sample: usize,
    sample_rate: u32,
    fade_in_seconds: f64,
    fade_out_seconds: f64,
    curve: FadeCurve,
) -> Vec<f32> {
    let a = start_sample.min(samples.len());
    let b = end_sample.min(samples.len());
    if b <= a {
        return Vec::new();
    }
    let mut out = samples[a..b].to_vec();
    apply_fades(&mut out, sample_rate, fade_in_seconds, fade_out_seconds, curve);
    out
}

/// Cut a region (by seconds) out of the buffer and apply its fades. Convenience over
/// [`slice_samples`] for the seconds-based UI.
pub fn slice_region(samples: &[f32], sample_rate: u32, region: &Region, curve: FadeCurve) -> Vec<f32> {
    let sr = sample_rate as f64;
    let a = (region.start_seconds * sr).floor().max(0.0) as usize;
    let b = (region.end_seconds * sr).floor().max(0.0) as usize;
    slice_samples(samples, a, b, sample_rate, region.fade_in_seconds, region.fade_out_seconds, curve)
}

/// Encode mono f32 PCM as canonical 16-bit little-endian PCM WAV bytes. The 44-byte header
/// is exactly what `hound` (and therefore `analyze_buffer`) reads, so a slice can be fed
/// straight back into the analyzer.
pub fn encode_wav_pcm16(mono: &[f32], sample_rate: u32) -> Vec<u8> {
    let n = mono.len();
    let data_bytes = n * 2;
    let mut b = Vec::with_capacity(44 + data_bytes);
    b.extend_from_slice(b"RIFF");
    b.extend_from_slice(&((36 + data_bytes) as u32).to_le_bytes());
    b.extend_from_slice(b"WAVE");
    b.extend_from_slice(b"fmt ");
    b.extend_from_slice(&16u32.to_le_bytes()); // fmt chunk size
    b.extend_from_slice(&1u16.to_le_bytes()); // PCM
    b.extend_from_slice(&1u16.to_le_bytes()); // mono
    b.extend_from_slice(&sample_rate.to_le_bytes());
    b.extend_from_slice(&(sample_rate * 2).to_le_bytes()); // byte rate (sr * blockAlign)
    b.extend_from_slice(&2u16.to_le_bytes()); // block align (mono * 16-bit)
    b.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    b.extend_from_slice(b"data");
    b.extend_from_slice(&(data_bytes as u32).to_le_bytes());
    for &x in mono {
        let s = x.clamp(-1.0, 1.0);
        let v = if s < 0.0 { (s * 32768.0) as i16 } else { (s * 32767.0) as i16 };
        b.extend_from_slice(&v.to_le_bytes());
    }
    b
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: u32 = 44100;

    // Build mono PCM from (amplitude, seconds) blocks of a 220 Hz sine.
    fn pcm(blocks: &[(f32, f64)]) -> Vec<f32> {
        let mut out = Vec::new();
        let mut phase = 0.0f64;
        let dphase = 2.0 * std::f64::consts::PI * 220.0 / SR as f64;
        for &(amp, secs) in blocks {
            let frames = (secs * SR as f64).round() as usize;
            for _ in 0..frames {
                out.push((amp as f64 * phase.sin()) as f32);
                phase += dphase;
            }
        }
        out
    }

    #[test]
    fn two_bursts_with_a_real_gap_are_two_regions() {
        let s = pcm(&[(1.0, 0.4), (0.0, 0.3), (1.0, 0.4)]);
        let r = detect_regions_from_samples(&s, SR, &DetectParams::default());
        assert_eq!(r.len(), 2, "expected two regions, got {}", r.len());
        assert!(r[0].start_seconds < 0.05);
        assert!(r[1].start_seconds > 0.6 && r[1].start_seconds < 0.8);
    }

    #[test]
    fn a_short_gap_does_not_split_a_region() {
        // 60 ms gap < 150 ms minimum silence → one bridged region.
        let s = pcm(&[(1.0, 0.3), (0.0, 0.06), (1.0, 0.3)]);
        let r = detect_regions_from_samples(&s, SR, &DetectParams::default());
        assert_eq!(r.len(), 1, "short gap should bridge, got {}", r.len());
    }

    #[test]
    fn a_tiny_click_is_dropped() {
        // 20 ms < 50 ms minimum region.
        let s = pcm(&[(0.0, 0.2), (1.0, 0.02), (0.0, 0.2)]);
        let r = detect_regions_from_samples(&s, SR, &DetectParams::default());
        assert!(r.is_empty(), "20 ms burst should be dropped, got {}", r.len());
    }

    #[test]
    fn hysteresis_keeps_a_wobbling_tail_as_one_region() {
        // Loud, then a 200 ms stretch between the close (-46 dB) and open (-40 dB) floors,
        // then loud again. With hysteresis this is one region; a single-threshold gate
        // (legacy) would split it in two.
        let peak = 1.0f32;
        let mid = peak * 10f32.powf(-43.0 / 20.0); // amplitude ~ -43 dB, between the floors
        let s = pcm(&[(peak, 0.3), (mid, 0.2), (peak, 0.3)]);

        let improved = detect_regions_from_samples(&s, SR, &DetectParams::default());
        assert_eq!(improved.len(), 1, "hysteresis should hold one region, got {}", improved.len());

        let (env, rate) = amplitude_envelope(&s, SR);
        let legacy = detect_regions_with_params(&env, rate, s.len() as f64 / SR as f64, &DetectParams::legacy());
        assert_eq!(legacy.len(), 2, "single-threshold gate should split, got {}", legacy.len());
    }

    #[test]
    fn legacy_params_match_the_envelope_only_path() {
        let s = pcm(&[(1.0, 0.4), (0.0, 0.3), (1.0, 0.4)]);
        let (env, rate) = amplitude_envelope(&s, SR);
        let r = detect_regions_with_params(&env, rate, s.len() as f64 / SR as f64, &DetectParams::legacy());
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].index, 0);
        assert_eq!(r[1].index, 1);
    }

    #[test]
    fn wav_header_is_canonical_and_sized() {
        let mono = vec![0.0f32, 0.5, -0.5, 1.0, -1.0];
        let w = encode_wav_pcm16(&mono, SR);
        assert_eq!(&w[0..4], b"RIFF");
        assert_eq!(&w[8..12], b"WAVE");
        assert_eq!(&w[36..40], b"data");
        assert_eq!(w.len(), 44 + mono.len() * 2);
        // data chunk size field
        let data_len = u32::from_le_bytes([w[40], w[41], w[42], w[43]]) as usize;
        assert_eq!(data_len, mono.len() * 2);
    }

    #[test]
    fn linear_fades_ramp_from_silence() {
        let mut buf = vec![1.0f32; SR as usize]; // 1 s of DC-ish 1.0
        apply_fades(&mut buf, SR, 0.1, 0.1, FadeCurve::Linear);
        assert!(buf[0].abs() < 1e-6, "fade-in starts at silence");
        assert!(*buf.last().unwrap() < 0.05, "fade-out ends near silence");
        assert!((buf[SR as usize / 2] - 1.0).abs() < 1e-6, "middle is untouched");
    }

    #[test]
    fn zero_crossing_snap_lands_on_a_crossing() {
        let s = pcm(&[(1.0, 0.1)]);
        let idx = 1000isize;
        let snapped = snap_to_zero_crossing(&s, idx, SR) as usize;
        // Sign changes across the snapped index (a genuine crossing).
        let a = s[snapped - 1];
        let b = s[snapped];
        assert!((a <= 0.0 && b >= 0.0) || (a >= 0.0 && b <= 0.0), "not a zero crossing");
    }
}
