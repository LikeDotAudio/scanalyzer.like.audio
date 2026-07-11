//! Analyze one WAV file into a `Peak` record. This orchestrates the individual
//! single-purpose feature extractors; each `let` is one well-scoped step.
use std::path::Path;

use crate::acid::read_acid;
use crate::amplitude::amplitude_features;
use crate::distortion::distortion_analysis;
use crate::envelope::envelope_analysis;
use crate::family::classify_family;
use crate::flux::spectral_flux;
use crate::framestats::centroid_stats;
use crate::god::god_category;
use crate::label::label_sample;
use crate::mfcc::mfcc_mean;
use crate::partials::partial_analysis;
use crate::peak::Peak;
use crate::pitch::pitch_features;
use crate::root::{extract_root, midi_to_name};
use crate::spectrum::spectral_features;
use crate::sustain::sustain_ratio;
use crate::tags::{acoustic_tags, sound_design_tags};
use crate::transients::count_transients;
use crate::version::ANALYZER_VERSION;
use crate::wav::read_wav_mono;

/// STFT geometry for the frame-based features (flux, MFCC, centroid stats).
const N_FFT: usize = 2048;
const HOP: usize = 512;

pub fn analyze(path: &Path, root: &Path, max_len: f64) -> Option<Peak> {
    let (data, sr, bit_depth, channels) = read_wav_mono(path)?;
    let sr_f = sr as f64;
    let length = data.len() as f64 / sr_f;
    if length > max_len {
        return None; // skip long files
    }

    // Feature extraction — each helper does one thing.
    let amp = amplitude_features(&data, sr_f, length);
    let (pitch, harmonicity) = pitch_features(&data, sr_f);
    let spec = spectral_features(&data, sr_f)?; // None ⇒ too short to analyze
    let transients = count_transients(&data, sr);
    let sustain = sustain_ratio(&data, sr);
    let (bpm, root_note) = read_acid(path);

    // Frame-based features: one STFT shared by flux, MFCC, and centroid stats.
    let frames = crate::stft::stft_mags(&data, N_FFT, HOP);
    let flux = spectral_flux(&frames);
    let mfcc = mfcc_mean(&frames, sr_f, N_FFT);
    let (centroid_mean, centroid_std) = centroid_stats(&frames, sr_f, N_FFT);

    // Measured ADSR envelope + its statistical moments and shape.
    let env = envelope_analysis(&data, sr, transients);

    // ROOT note (musical key). Prefer the embedded ACID root when present,
    // otherwise detect it from the spectrum (FFT + harmonic product spectrum).
    let fft_root = extract_root(&data, sr_f);
    let (root_name, root_hz, root_cents) = if root_note >= 0 {
        (midi_to_name(root_note), 0.0, 0.0)
    } else {
        (fft_root.note.clone(), fft_root.hz, fft_root.cents)
    };

    // Partials vs the fundamental: harmonic series or detuned/metallic?
    let f0 = if fft_root.hz > 0.0 { fft_root.hz } else { pitch };
    let parts = partial_analysis(&data, sr_f, f0);

    // Distortion: how hard the sound is being pushed (THD + clipping density,
    // with the crest factor from `amplitude_features` as the third metric).
    let dist = distortion_analysis(&data, sr_f, f0, amp.crest);

    // Blind classifications — computed from the measurements alone, before the
    // file name is ever looked at.
    let acoustic = acoustic_tags(harmonicity, spec.flatness, &parts, length, &env);
    let sound_design =
        sound_design_tags(&env, transients, harmonicity, spec.centroid, spec.low, spec.high, pitch, fft_root.hz);

    // ---- FINAL STEP: the file name. Everything above was measured from the
    // audio alone; only now is the path/name consulted, to lay the curated
    // taxonomy (group / subgroup / family / god category) on top of the
    // acoustic evidence.
    let name = path.file_name().and_then(|x| x.to_str()).unwrap_or("").to_string();
    let parent = path.parent().unwrap_or(root);
    let folder = parent
        .strip_prefix(root)
        .ok()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();

    // Taxonomy labels (group / subgroup / reason / timbre / length tier / audit).
    let l = label_sample(
        &folder, &name, length, transients, bpm, harmonicity, sustain,
        amp.attack, amp.crest, spec.centroid, spec.low, spec.high,
    );
    let is_loop = l.group == "Loops/Patterns";
    let family = classify_family(&l.group, &l.subgroup, &acoustic, flux, l.sustained);
    let god_class = god_category(&l.group, is_loop, &env).to_string();

    // Three-part membership reason: 1) the name evidence, 2) the envelope
    // evidence, 3) the spectral evidence — so a record always shows WHY it
    // landed where it did, from more than just the file/folder name.
    let band = if spec.low >= spec.mid && spec.low >= spec.high {
        ("low", spec.low)
    } else if spec.high >= spec.mid {
        ("high", spec.high)
    } else {
        ("mid", spec.mid)
    };
    let root_part = if root_name.is_empty() { String::new() } else { format!(" · root {}", root_name) };
    let reason = format!(
        "1) {}  2) envelope {} (attack {:.0} ms, sustain {:.0}%, {} transient{})  3) {} · {}-band {:.0}%{}",
        l.reason,
        env.shape, env.attack * 1000.0, env.sustain * 100.0,
        transients, if transients == 1 { "" } else { "s" },
        acoustic.join("+"), band.0, band.1 * 100.0, root_part,
    );

    Some(Peak {
        analyzer_version: ANALYZER_VERSION.to_string(),
        name,
        folder: folder.clone(),
        sub: folder,
        path: path.to_string_lossy().to_string(),
        group: l.group,
        reason,
        timbre: l.timbre,
        length_class: l.length_class,
        subgroup: l.subgroup,
        audit: l.audit,
        length_seconds: length,
        transient_count: transients,
        attack_seconds: amp.attack,
        root_mean_square_level: amp.rms,
        crest_factor: amp.crest,
        zero_crossings_per_second: amp.zcr,
        pitch_hz: pitch,
        harmonicity,
        sustain_ratio: sustain,
        sustained: l.sustained,
        complexity: spec.complexity,
        spectral_centroid_hz: spec.centroid,
        spectral_rolloff_hz: spec.rolloff,
        spectral_flatness: spec.flatness,
        low_band_energy: spec.low,
        mid_band_energy: spec.mid,
        high_band_energy: spec.high,
        spectral_flux: flux,
        inharmonicity: parts.inharmonicity,
        partial_count: parts.count,
        mel_frequency_cepstral_coefficients: mfcc,
        spectral_centroid_mean_hz: centroid_mean,
        spectral_centroid_deviation_hz: centroid_std,
        total_harmonic_distortion: dist.thd,
        clipping_density: dist.clipping,
        distortion: dist.label.to_string(),
        envelope_attack_seconds: env.attack,
        envelope_decay_seconds: env.decay,
        envelope_sustain_level: env.sustain,
        envelope_release_seconds: env.release,
        envelope_temporal_centroid: env.centroid,
        envelope_skewness: env.skew,
        envelope_kurtosis: env.kurt,
        envelope_shape: env.shape.to_string(),
        acoustic_types: acoustic,
        sound_design_roles: sound_design,
        instrument_family: family,
        god_category: god_class,
        sample_rate: sr,
        bit_depth,
        channels,
        root_note_name: root_name,
        root_frequency_hz: root_hz,
        root_cents_offset: root_cents,
        beats_per_minute: bpm,
        root_midi_note: root_note,
        cluster: -1,
        principal_components: Vec::new(),
    })
}
