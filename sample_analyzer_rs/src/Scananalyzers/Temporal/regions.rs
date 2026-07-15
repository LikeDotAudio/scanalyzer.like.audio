//! Multi-region detection: find the distinct sounding stretches inside one file,
//! separated by silence, and report an in-point / out-point per region.
//!
//! A field recording or a comp'd take is often several sounds with gaps between
//! them — a door that opens, a pause, then closes. This scananalyzer walks the
//! RMS amplitude envelope already computed for the ADSR stage, gates it against a
//! peak-relative silence floor, and returns the start/end seconds of each region.
//! `count > 1` is what flags a file as "has multiple regions" for the library.
//!
//! The numbers here MUST match the TypeScript mirror used by the interactive
//! Extractor editor (`Web_Front/src/examiner/detectRegions.ts`) — same defaults,
//! same state machine — so the stored regions and the re-detected ones agree at
//! the default settings.

use crate::peak::{Region, Regions};

/// Silence floor, in dB below the file's loudest frame. Anything quieter is a gap.
pub const DEFAULT_THRESHOLD_DECIBELS: f64 = -40.0;
/// A quiet stretch shorter than this is a dip *within* a region, not a break
/// between two — so it does not split them.
pub const DEFAULT_MINIMUM_SILENCE_SECONDS: f64 = 0.15;
/// A sounding stretch shorter than this is a click, not a region — dropped.
pub const DEFAULT_MINIMUM_REGION_SECONDS: f64 = 0.05;
/// Bound on the stored array so a pathological file can't bloat the .PEAK.
const MAX_REGIONS: usize = 512;

/// Detect regions from the RMS envelope (the `amplitude_envelope` track) at
/// `rate_hz` frames per second. `length_seconds` clamps the final out-point.
pub fn detect_regions(envelope: &[f64], rate_hz: f64, length_seconds: f64) -> Regions {
    let empty = || Regions {
        count: 0,
        detection_threshold_decibels: DEFAULT_THRESHOLD_DECIBELS,
        minimum_silence_seconds: DEFAULT_MINIMUM_SILENCE_SECONDS,
        minimum_region_seconds: DEFAULT_MINIMUM_REGION_SECONDS,
        regions: Vec::new(),
    };
    if envelope.is_empty() || rate_hz <= 0.0 {
        return empty();
    }
    let peak = envelope.iter().cloned().fold(0.0f64, f64::max);
    if peak <= 1e-9 {
        return empty(); // digitally silent file: no regions at all
    }
    let threshold = peak * 10f64.powf(DEFAULT_THRESHOLD_DECIBELS / 20.0);
    let min_silence_frames = (DEFAULT_MINIMUM_SILENCE_SECONDS * rate_hz).round() as usize;

    // Contiguous runs of above-threshold frames: (start_frame, end_frame_exclusive, peak).
    let n = envelope.len();
    let mut runs: Vec<(usize, usize, f64)> = Vec::new();
    let mut i = 0;
    while i < n {
        if envelope[i] >= threshold {
            let start = i;
            let mut pk = 0.0f64;
            while i < n && envelope[i] >= threshold {
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

    // Bridge runs separated by a gap shorter than the minimum silence: a brief dip
    // inside one sound must not read as two regions.
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

    // Convert to seconds, drop too-short regions, cap the count.
    let mut regions: Vec<Region> = Vec::new();
    for (start_frame, end_frame, pk) in merged {
        let start_seconds = start_frame as f64 / rate_hz;
        let mut end_seconds = end_frame as f64 / rate_hz;
        if length_seconds > 0.0 && end_seconds > length_seconds {
            end_seconds = length_seconds;
        }
        let duration_seconds = end_seconds - start_seconds;
        if duration_seconds < DEFAULT_MINIMUM_REGION_SECONDS {
            continue;
        }
        regions.push(Region {
            index: 0,
            start_seconds,
            end_seconds,
            duration_seconds,
            peak_amplitude: pk,
            name: String::new(),
        });
        if regions.len() >= MAX_REGIONS {
            break;
        }
    }
    for (idx, r) in regions.iter_mut().enumerate() {
        r.index = idx;
    }

    Regions {
        count: regions.len(),
        detection_threshold_decibels: DEFAULT_THRESHOLD_DECIBELS,
        minimum_silence_seconds: DEFAULT_MINIMUM_SILENCE_SECONDS,
        minimum_region_seconds: DEFAULT_MINIMUM_REGION_SECONDS,
        regions,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Build an RMS-like envelope at 200 Hz: `spec` is (loud?, seconds) blocks.
    fn envelope(spec: &[(bool, f64)]) -> (Vec<f64>, f64) {
        let rate = 200.0;
        let mut v = Vec::new();
        for &(loud, secs) in spec {
            let frames = (secs * rate).round() as usize;
            for _ in 0..frames {
                v.push(if loud { 1.0 } else { 0.0 });
            }
        }
        (v, rate)
    }

    #[test]
    fn two_sounds_with_a_real_gap_are_two_regions() {
        let (env, rate) = envelope(&[(true, 0.4), (false, 0.3), (true, 0.4)]);
        let r = detect_regions(&env, rate, 1.1);
        assert_eq!(r.count, 2, "expected two regions");
        assert!(r.regions[0].start_seconds < 0.05);
        assert!((r.regions[1].start_seconds - 0.7).abs() < 0.02);
    }

    #[test]
    fn a_brief_dip_does_not_split_a_region() {
        // 50 ms gap < 150 ms minimum silence → one region.
        let (env, rate) = envelope(&[(true, 0.4), (false, 0.05), (true, 0.4)]);
        let r = detect_regions(&env, rate, 0.85);
        assert_eq!(r.count, 1, "a short dip must not split the sound");
    }

    #[test]
    fn silence_has_no_regions() {
        let (env, rate) = envelope(&[(false, 1.0)]);
        assert_eq!(detect_regions(&env, rate, 1.0).count, 0);
        assert_eq!(detect_regions(&[], 200.0, 0.0).count, 0);
    }
}
