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
    /// Ring time: seconds for the post-peak level to fall 60 dB, extrapolated
    /// from the initial decay slope. None when the sound never decays (a held
    /// tone, a steady bed) — which is itself the diagnostic, so it must not be
    /// confused with a decay time of zero. This is the material-impedance axis:
    /// METAL-IMPACT rings, WOOD-IMPACT thuds.
    pub decay_time_60db: Option<f64>,
}

impl Envelope {
    fn silent() -> Envelope {
        Envelope {
            attack: 0.0, decay: 0.0, sustain: 0.0, release: 0.0,
            centroid: 0.0, skew: 0.0, kurt: 0.0, shape: "Silent",
            decay_time_60db: None,
        }
    }
}

/// The RMS amplitude track and its sample rate in frames per second.
///
/// ~5 ms frames: fine enough to resolve fast attacks. Shared by the ADSR
/// measurement and by `morphology::syllabic_modulation`, which needs the same
/// track at a known rate — computing it once here keeps the two definitions
/// from drifting apart.
pub fn amplitude_envelope(data: &[f32], sr: u32) -> (Vec<f64>, f64) {
    let hop = (sr as usize / 200).max(1);
    let rate_hz = sr as f64 / hop as f64;
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
    (env, rate_hz)
}

/// Measure the ADSR-style envelope. `transients` (from the onset counter)
/// marks multi-hit material, whose single-note envelope model doesn't apply.
pub fn envelope_analysis(data: &[f32], sr: u32, transients: usize) -> Envelope {
    if data.is_empty() {
        return Envelope::silent();
    }
    let (env, rate_hz) = amplitude_envelope(data, sr);
    let dt = 1.0 / rate_hz;
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
    let decay_time_60db = decay_time(&sm, peak_idx, peak, dt);
    Envelope {
        attack, decay, sustain, release, centroid,
        skew: m.skew, kurt: m.kurt, shape, decay_time_60db,
    }
}

/// Ring time (RT60), extrapolated from the initial post-peak decay slope.
///
/// Fitting the *whole* tail would be wrong: it runs into the noise floor, and
/// into whatever else happens later in the file. So the fit is confined to the
/// −5 dB → −25 dB window below the peak, the room-acoustics convention (a T20
/// measurement), and stops at the first frame that leaves it. The slope over
/// that window is extrapolated to a 60 dB fall.
///
/// Returns None when the sound does not decay at all — a held tone or a steady
/// bed never falls 25 dB, and reporting 0 s of ring for a drone would be a lie
/// that reads as "maximally damped".
fn decay_time(smoothed: &[f64], peak_idx: usize, peak: f64, dt: f64) -> Option<f64> {
    const START_DB: f64 = -5.0; // skip the peak itself: it is a transient, not the decay
    const END_DB: f64 = -25.0;
    const MAX_SECONDS: f64 = 60.0;

    if peak <= 0.0 || peak_idx >= smoothed.len() {
        return None;
    }
    let mut points: Vec<(f64, f64)> = Vec::new();
    for (k, &v) in smoothed.iter().enumerate().skip(peak_idx) {
        let db = 20.0 * (v / peak).max(1e-12).log10();
        if db > START_DB {
            continue; // still in the peak region
        }
        if db < END_DB {
            break; // left the fit window — everything past here is floor
        }
        points.push(((k - peak_idx) as f64 * dt, db));
    }
    if points.len() < 4 {
        return None; // never decayed through the window (or fell through it instantly)
    }
    // Insist on a real fall before extrapolating one. Fitting a slope to a
    // fragment that only slipped 2 dB and then multiplying it out to 60 dB is
    // how you get the 20-second "ring times" that came out of the first pass
    // over FSD50K — an extrapolation 30× longer than its evidence.
    const MIN_FALL_DB: f64 = 15.0;
    let observed_fall = points.first()?.1 - points.last()?.1;
    if observed_fall < MIN_FALL_DB {
        return None;
    }
    // Ordinary least squares of dB against time.
    let n = points.len() as f64;
    let mt = points.iter().map(|p| p.0).sum::<f64>() / n;
    let md = points.iter().map(|p| p.1).sum::<f64>() / n;
    let mut num = 0.0;
    let mut den = 0.0;
    for (t, db) in &points {
        num += (t - mt) * (db - md);
        den += (t - mt) * (t - mt);
    }
    if den < 1e-12 {
        return None;
    }
    let slope_db_per_second = num / den;
    if slope_db_per_second > -1.0 {
        return None; // flat or rising: not a decay
    }
    let rt60 = -60.0 / slope_db_per_second;
    (rt60.is_finite() && rt60 > 0.0).then(|| rt60.min(MAX_SECONDS))
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

    /// Exponentially decaying tone with a known RT60, to check we recover it.
    fn ringing(rt60: f32, secs: f32) -> Vec<f32> {
        let tau = rt60 / 6.908; // 60 dB fall = e^(-t/tau) with t/tau = ln(1000)
        (0..(secs * SR as f32) as usize)
            .map(|i| {
                let t = i as f32 / SR as f32;
                (-t / tau).exp() * (2.0 * std::f32::consts::PI * 440.0 * t).sin()
            })
            .collect()
    }

    #[test]
    fn ring_time_separates_a_bell_from_a_thud() {
        // A 2 s ring (metal) and a 0.15 s one (wood) — the material-impedance axis.
        let bell = envelope_analysis(&ringing(2.0, 3.0), SR, 1).decay_time_60db.unwrap();
        let thud = envelope_analysis(&ringing(0.15, 1.0), SR, 1).decay_time_60db.unwrap();
        assert!((bell - 2.0).abs() < 0.4, "bell RT60 = {bell} s");
        assert!((thud - 0.15).abs() < 0.06, "thud RT60 = {thud} s");
        assert!(bell > thud * 5.0);
    }

    #[test]
    fn a_sound_that_never_decays_reports_no_ring_time_rather_than_zero() {
        // A held tone at full level: a 0 s ring time would read as "maximally
        // damped", the exact opposite of the truth.
        let drone = shaped(&[(0.0, 0.0), (0.01, 1.0), (2.0, 1.0)]);
        assert!(envelope_analysis(&drone, SR, 1).decay_time_60db.is_none());
    }
}
