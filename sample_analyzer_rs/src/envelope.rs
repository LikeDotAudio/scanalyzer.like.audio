//! ADSR-style envelope analysis — how the sound behaves over time.
//!
//! A recorded one-shot has no note-off, so the classic synthesizer ADSR is
//! estimated from the amplitude envelope itself:
//!   Attack  — rise time from 10 % to 90 % of the peak level
//!   Decay   — time from the peak down to the sustain plateau
//!   Sustain — the plateau level after the decay, as a fraction of peak
//!   Release — the final fade from the plateau down to silence
//! plus the temporal centroid (where the energy sits in time: ~0 = front-
//! loaded hit, ~0.5 = held evenly), the envelope's statistical skewness and
//! kurtosis (a strongly positive-skewed envelope IS a percussive sound), and
//! a categorical envelope `shape`.
use crate::moments::moments;

pub struct Envelope {
    pub attack: f64,   // 10 % → 90 % rise time (s)
    pub decay: f64,    // peak → sustain plateau (s)
    pub sustain: f64,  // plateau level, fraction of peak (0..1)
    pub release: f64,  // final fade (plateau → 5 % of peak) (s)
    pub centroid: f64, // temporal energy centroid, 0..1 of file length
    pub skew: f64,     // 3rd moment: high positive ⇒ front-loaded energy
    pub kurt: f64,     // 4th moment (excess): high ⇒ sharp isolated bursts
    pub shape: &'static str,
}

impl Envelope {
    fn silent() -> Envelope {
        Envelope {
            attack: 0.0, decay: 0.0, sustain: 0.0, release: 0.0,
            centroid: 0.0, skew: 0.0, kurt: 0.0, shape: "Silent",
        }
    }
}

/// Measure the ADSR-style envelope. `transients` (from the onset counter)
/// marks multi-hit material, whose single-note envelope model doesn't apply.
pub fn envelope_analysis(data: &[f32], sr: u32, transients: usize) -> Envelope {
    if data.is_empty() {
        return Envelope::silent();
    }
    // ~5 ms RMS frames: fine enough to resolve fast attacks.
    let hop = (sr as usize / 200).max(1);
    let dt = hop as f64 / sr as f64;
    let mut env: Vec<f64> = Vec::with_capacity(data.len() / hop + 1);
    let mut i = 0;
    while i < data.len() {
        let end = (i + hop).min(data.len());
        let mut s = 0.0f64;
        for &x in &data[i..end] {
            s += x as f64 * x as f64;
        }
        env.push((s / (end - i) as f64).sqrt());
        i += hop;
    }
    let n = env.len();
    // 3-tap smoothing to keep single-cycle ripple out of the crossings.
    let sm: Vec<f64> = (0..n)
        .map(|k| (env[k.saturating_sub(1)] + env[k] + env[(k + 1).min(n - 1)]) / 3.0)
        .collect();
    let peak = sm.iter().cloned().fold(0.0f64, f64::max);
    if peak <= 0.0 {
        return Envelope::silent();
    }
    // Anchor the decay/sustain/release segmentation at the first arrival near
    // the peak: a held tone's literal argmax is just numeric ripple and can
    // land at the very end of the file, which would erase the plateau.
    let peak_idx = sm.iter().position(|&v| v >= 0.95 * peak).unwrap_or(0);

    // Attack: first 10 % crossing → first 90 % crossing.
    let onset = sm.iter().position(|&v| v >= 0.10 * peak).unwrap_or(0);
    let t90 = sm.iter().position(|&v| v >= 0.90 * peak).unwrap_or(onset);
    let attack = (t90.saturating_sub(onset)) as f64 * dt;

    // Sustain: median level over the middle of the post-peak region.
    let tail = n - peak_idx;
    let sustain = if tail > 4 {
        let a = peak_idx + (tail as f64 * 0.3) as usize;
        let b = peak_idx + (tail as f64 * 0.7) as usize;
        let mut w: Vec<f64> = sm[a..b.max(a + 1)].to_vec();
        w.sort_by(|x, y| x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal));
        (w[w.len() / 2] / peak).clamp(0.0, 1.0)
    } else {
        // Too short after the peak to have a plateau at all.
        0.0
    };

    // Decay: peak → first arrival at the plateau (10 % above the sustain level).
    let dec_target = (sustain * 1.1).min(0.95) * peak;
    let decay = sm[peak_idx..]
        .iter()
        .position(|&v| v <= dec_target)
        .map(|k| k as f64 * dt)
        .unwrap_or((n - peak_idx) as f64 * dt);

    // Release: last time at/above the plateau (or ≥25 % of peak, whichever is
    // higher) → last audible frame (≥5 % of peak).
    let rel_thr = (sustain * 0.7).max(0.25) * peak;
    let i_rel = sm.iter().rposition(|&v| v >= rel_thr).unwrap_or(peak_idx);
    let i_end = sm.iter().rposition(|&v| v >= 0.05 * peak).unwrap_or(i_rel);
    let release = i_end.saturating_sub(i_rel) as f64 * dt;

    // Temporal centroid: energy-weighted mean time, normalized 0..1.
    let e_sum: f64 = env.iter().map(|&v| v * v).sum();
    let centroid = if e_sum > 0.0 {
        env.iter().enumerate().map(|(k, &v)| k as f64 * v * v).sum::<f64>() / (e_sum * n.max(1) as f64)
    } else {
        0.0
    };

    // Envelope moments: skewness separates front-loaded percussive envelopes
    // from held ones; kurtosis flags isolated bursts in otherwise smooth audio.
    let m = moments(&env);

    let length = data.len() as f64 / sr as f64;
    let shape = classify_shape(attack, sustain, decay, length, transients);
    Envelope { attack, decay, sustain, release, centroid, skew: m.skew, kurt: m.kurt, shape }
}

/// Categorical envelope shape from the measured segments.
fn classify_shape(attack: f64, sustain: f64, decay: f64, length: f64, transients: usize) -> &'static str {
    if transients > 1 {
        return "Multi"; // repeated hits — single-note ADSR doesn't apply
    }
    if attack > (0.1 * length).max(0.15) {
        return "Swell"; // slow fade-in (pad / bowed / reversed)
    }
    if sustain > 0.5 {
        return "Sustained"; // held at level (drone / organ / lead)
    }
    if sustain < 0.15 && decay < 0.15 {
        return "Plucky"; // instant peak, dies immediately (pluck / click / dry hit)
    }
    "Decaying" // fast attack, gradual die-off (piano / cymbal / room hit)
}

#[cfg(test)]
mod tests {
    use super::envelope_analysis;

    const SR: u32 = 44_100;

    /// Tone with a piecewise-linear amplitude envelope over (time s, level) points.
    fn shaped(points: &[(f32, f32)]) -> Vec<f32> {
        let total = points.last().unwrap().0;
        (0..(total * SR as f32) as usize)
            .map(|i| {
                let t = i as f32 / SR as f32;
                let mut lvl = 0.0;
                for w in points.windows(2) {
                    let ((t0, a0), (t1, a1)) = (w[0], w[1]);
                    if t >= t0 && t <= t1 {
                        lvl = a0 + (a1 - a0) * (t - t0) / (t1 - t0).max(1e-9);
                    }
                }
                lvl * (2.0 * std::f32::consts::PI * 220.0 * t).sin()
            })
            .collect()
    }

    #[test]
    fn pad_swell_vs_pluck() {
        // Slow 0.5 s fade-in, hold, slow fade-out ⇒ Swell, high sustain.
        let pad = shaped(&[(0.0, 0.0), (0.5, 1.0), (1.5, 0.95), (2.0, 0.0)]);
        let e = envelope_analysis(&pad, SR, 1);
        assert_eq!(e.shape, "Swell");
        assert!(e.attack > 0.3, "attack = {}", e.attack);
        assert!(e.sustain > 0.5, "sustain = {}", e.sustain);

        // Instant peak, dead in 80 ms ⇒ Plucky, near-zero sustain.
        let pluck = shaped(&[(0.0, 0.0), (0.005, 1.0), (0.08, 0.0), (0.5, 0.0)]);
        let e = envelope_analysis(&pluck, SR, 1);
        assert_eq!(e.shape, "Plucky");
        assert!(e.attack < 0.05, "attack = {}", e.attack);
        assert!(e.sustain < 0.15, "sustain = {}", e.sustain);
        assert!(e.centroid < 0.2, "centroid = {}", e.centroid);
        // Front-loaded energy ⇒ strongly positive envelope skewness.
        assert!(e.skew > 1.0, "skew = {}", e.skew);
    }

    #[test]
    fn held_tone_is_sustained() {
        let lead = shaped(&[(0.0, 0.0), (0.01, 1.0), (0.9, 0.9), (1.0, 0.0)]);
        let e = envelope_analysis(&lead, SR, 1);
        assert_eq!(e.shape, "Sustained");
        assert!(e.sustain > 0.5);
    }
}
