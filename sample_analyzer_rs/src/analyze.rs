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
use crate::music_prod::music_prod_category;
use crate::label::label_sample;
use crate::mfcc::mfcc_mean;
use crate::morphology::morphology;
use crate::partials::partial_analysis;
use crate::peak::Peak;
use crate::pitch::pitch_features;
use crate::root::{extract_root, midi_to_name};
use crate::spectrum::spectral_features;
use crate::sustain::sustain_ratio;
use crate::tags::{acoustic_tags, sound_design_tags};
use crate::transients::count_transients;
use crate::version::ANALYZER_VERSION;

/// STFT geometry for the frame-based features (flux, MFCC, centroid stats).
const N_FFT: usize = 2048;
const HOP: usize = 512;

pub fn analyze(path: &Path, root: &Path, max_len: f64) -> Option<Peak> {
    let dec = crate::decode::read_audio(path)?;
    let (data, raw_data, sr, bit_depth, channels) =
        (dec.mono, dec.raw, dec.sample_rate, dec.bit_depth, dec.channels);
    let (source_format, lossy_source) = (dec.source_format, dec.lossy);
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
    let (mut bpm, root_note) = read_acid(path);

    // Frame-based features: one STFT shared by flux, MFCC, and centroid stats.
    let frames = crate::stft::stft_mags(&data, N_FFT, HOP);
    let flux = spectral_flux(&frames);
    let mfcc = mfcc_mean(&frames, sr_f, N_FFT);
    let (centroid_mean, centroid_std) = centroid_stats(&frames, sr_f, N_FFT);

    // Measured ADSR envelope + its statistical moments and shape.
    let env = envelope_analysis(&data, sr, transients);

    // The morphology axis (spec §4b): stationarity, entropy, spectral tilt, band
    // limit, the two sweep slopes, and syllabic modulation. These ride on the
    // STFT and the amplitude envelope already computed above.
    let (amplitude_track, envelope_rate_hz) = crate::envelope::amplitude_envelope(&data, sr);
    let morph = morphology(&frames, sr_f, N_FFT, HOP, &amplitude_track, envelope_rate_hz);
    // One pass answers both "how voiced is this" and "is this a vocal".
    let voicing = crate::vad::voice_activity(&data, sr);
    let (voicing_ratio, is_vocal) = (voicing.ratio, voicing.is_speech);

    // Advanced Stats
    let (mid_rms, side_rms) = crate::advanced_stats::analyze_stereo_width(&raw_data, channels);
    let lufs = crate::advanced_stats::get_integrated_lufs(&raw_data, channels, sr);
    // The envelope is thousands of floats; the record wants one. Reduce it here
    // and let the raw series go out of scope.
    let onset_periodicity = crate::advanced_stats::onset_periodicity(
        &crate::advanced_stats::detect_transient_onsets(&data, 512),
    );
    let (dc_offset, trailing_silence_ms) = crate::advanced_stats::calculate_qa_metrics(&data, sr);

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
    // taxonomy (group / subgroup / family / music-production role) on top of the
    // acoustic evidence.
    let name = path.file_name().and_then(|x| x.to_str()).unwrap_or("").to_string();
    let parent = path.parent().unwrap_or(root);
    let mut folder = parent
        .strip_prefix(root)
        .ok()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();

    if let Some(root_name) = root.file_name().and_then(|n| n.to_str()) {
        if folder.is_empty() || folder == "." {
            folder = root_name.to_string();
        } else {
            folder = format!("{}/{}", root_name, folder);
        }
    }

    // Taxonomy labels (group / subgroup / reason / timbre / length tier / audit).
    let mut l = label_sample(
        &folder, &name, length, transients, bpm, harmonicity, sustain,
        amp.attack, amp.crest, spec.centroid, spec.low, spec.high,
    );
    let family = classify_family(&l.group, &l.subgroup, &acoustic, flux, l.sustained);

    if l.group == "Unclassified" {
        if family.contains(&"Membranophone".to_string()) || family.contains(&"Idiophone".to_string()) {
            l.group = "Perc".to_string();
            l.subgroup = "Acoustic Guess".to_string();
            l.reason = "Acoustic ML Fallback (ZCR/Inharmonicity)".to_string();
        } else if family.contains(&"Electrophone".to_string()) {
            l.group = "Keyboards".to_string();
            l.subgroup = "Synth".to_string();
            l.reason = "Acoustic ML Fallback (Sustained Harmonic)".to_string();
        } else if family.contains(&"Chordophone".to_string()) {
            l.group = "Strings".to_string();
            l.reason = "Acoustic ML Fallback (Plucked Harmonic)".to_string();
        }
    }

    let is_loop = l.group == "Loops/Patterns";
    // If it reads as a loop but carries no ACID tempo, estimate BPM from the
    // onset-envelope autocorrelation.
    if bpm == 0.0 && (is_loop || l.timbre == "Loop" || l.length_class == "Loop") {
        bpm = crate::tempo::estimate_bpm(&frames, sr_f, HOP);
    }
    bpm = bpm.round();
    let mut music_class =
        music_prod_category(&l.group, &l.subgroup, is_loop, &env).to_string();

    // The voice detector overrides the NAME — but not a loop. A vocal loop is
    // still a loop: what it is made of does not change the role it plays. (The
    // old god map let the vocal flag clobber Complex here, so every vocal-ish
    // loop lost its loop-ness.)
    if is_vocal && !is_loop {
        music_class = crate::music_prod::PERFORMANCE.to_string();
    }

    // Percussive hits rarely carry a meaningful root note. Unless an embedded
    // ACID root says otherwise or the pitch evidence is strong (clearly
    // harmonic, e.g. an 808 or a pitched tom), report none — nil is fine.
    let (root_name, root_hz, root_cents) =
        if (music_class == crate::music_prod::PERCUSSION
            || music_class == crate::music_prod::SHAKEN)
            && root_note < 0
            && harmonicity < 0.6
        {
            (String::new(), 0.0, 0.0)
        } else {
            (root_name, root_hz, root_cents)
        };

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
    let reason = vec![
        format!("1) {}", l.reason),
        format!("2) envelope {} (attack {:.0} ms, sustain {:.0}%, {} transient{})",
            env.shape, env.attack * 1000.0, env.sustain * 100.0,
            transients, if transients == 1 { "" } else { "s" }
        ),
        format!("3) {} · {}-band {:.0}%{}", acoustic.join("+"), band.0, band.1 * 100.0, root_part),
    ];

    Some(finish(Peak {
        metadata: crate::peak::Metadata {
            analyzer_version: ANALYZER_VERSION.to_string(),
            name,
            folder: folder.clone(),
            sub: folder,
            path: path.to_string_lossy().to_string(),
            length_seconds: length,
            sample_rate: sr,
            bit_depth,
            channels,
            source_format,
            lossy_source,
            dc_offset,
            trailing_silence_ms,
        },
        classification: crate::peak::Classification {
            group: l.group,
            reason,
            timbre: l.timbre,
            length_class: l.length_class,
            subgroup: l.subgroup,
            audit: l.audit,
            acoustic_types: acoustic,
            sound_design_roles: sound_design,
            instrument_family: family,
            music_production_category: music_class,
        },
        envelope: crate::peak::Envelope {
            transient_count: transients,
            attack_seconds: amp.attack,
            sustain_ratio: sustain,
            sustained: l.sustained,
            envelope_attack_seconds: env.attack,
            envelope_decay_seconds: env.decay,
            envelope_sustain_level: env.sustain,
            envelope_release_seconds: env.release,
            envelope_temporal_centroid: env.centroid,
            envelope_skewness: env.skew,
            envelope_kurtosis: env.kurt,
            envelope_shape: env.shape.to_string(),
            decay_time_seconds_60db: env.decay_time_60db,
            onset_periodicity,
        },
        spectral_features: crate::peak::SpectralFeatures {
            root_mean_square_level: amp.rms,
            crest_factor: amp.crest,
            zero_crossings_per_second: amp.zcr,
            complexity: spec.complexity,
            spectral_centroid_hz: spec.centroid,
            spectral_rolloff_hz: spec.rolloff,
            spectral_flatness: spec.flatness,
            low_band_energy: spec.low,
            mid_band_energy: spec.mid,
            high_band_energy: spec.high,
            spectral_flux: flux,
            harmonicity,
            inharmonicity: parts.inharmonicity,
            partial_count: parts.count,
            mel_frequency_cepstral_coefficients: mfcc,
            spectral_centroid_mean_hz: centroid_mean,
            spectral_centroid_deviation_hz: centroid_std,
            total_harmonic_distortion: dist.thd,
            clipping_density: dist.clipping,
            distortion: dist.label.to_string(),
            stationarity: morph.stationarity,
            spectral_entropy: morph.spectral_entropy,
            spectral_slope_db_per_octave: morph.spectral_slope_db_per_octave,
            band_limit_high_hz: morph.band_limit_high_hz,
            spectral_centroid_slope_hz_per_second: morph.spectral_centroid_slope_hz_per_second,
            syllabic_modulation_energy: morph.syllabic_modulation_energy,
            voicing_ratio,
            mid_rms,
            side_rms,
            lufs,
        },
        musicality: crate::peak::Musicality {
            pitch_hz: pitch,
            pitch_slope_semitones_per_second: morph.pitch_slope_semitones_per_second,
            root_note_name: root_name,
            root_frequency_hz: root_hz,
            root_cents_offset: root_cents,
            beats_per_minute: (bpm * 10.0).round() / 10.0,
            root_midi_note: root_note,
            chromagram: spec.chromagram,
        },
        unsupervised: crate::peak::Unsupervised {
            cluster: -1,
            principal_components: Vec::new(),
        },
        ucs: crate::peak::Ucs::default(),
    }))
}

/// Classify a finished record. UCS scoring runs LAST, against the completed
/// `Peak`, so the classifier can read every extracted feature by its spec name
/// rather than being handed a curated few.
fn finish(mut p: Peak) -> Peak {
    let v = crate::ucs::classify(&p);
    p.ucs.category = v.category;
    p.ucs.subcategory = v.subcategory;
    p.ucs.id = v.id;
    p.ucs.confidence = v.confidence;
    p.ucs.alternatives = v.alternatives;
    p.ucs.synonyms = v.synonyms;
    p.ucs.reason = v.reason;
    p
}

pub fn analyze_buffer(buffer: &[u8], name: &str, folder: &str, max_len: f64) -> Option<Peak> {
    let (data, raw_data, sr, bit_depth, channels) = crate::wav::read_wav_buffer(buffer)?;
    let (source_format, lossy_source) = ("WAV".to_string(), false);
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
    // Read the embedded ACID chunk from the raw bytes (BPM + root note).
    let (mut bpm, root_note) = crate::acid::read_acid_buffer(buffer);

    // Frame-based features: one STFT shared by flux, MFCC, and centroid stats.
    let frames = crate::stft::stft_mags(&data, N_FFT, HOP);
    let flux = spectral_flux(&frames);
    let mfcc = mfcc_mean(&frames, sr_f, N_FFT);
    let (centroid_mean, centroid_std) = centroid_stats(&frames, sr_f, N_FFT);

    // Measured ADSR envelope + its statistical moments and shape.
    let env = envelope_analysis(&data, sr, transients);

    // The morphology axis (spec §4b): stationarity, entropy, spectral tilt, band
    // limit, the two sweep slopes, and syllabic modulation. These ride on the
    // STFT and the amplitude envelope already computed above.
    let (amplitude_track, envelope_rate_hz) = crate::envelope::amplitude_envelope(&data, sr);
    let morph = morphology(&frames, sr_f, N_FFT, HOP, &amplitude_track, envelope_rate_hz);
    // One pass answers both "how voiced is this" and "is this a vocal".
    let voicing = crate::vad::voice_activity(&data, sr);
    let (voicing_ratio, is_vocal) = (voicing.ratio, voicing.is_speech);

    // Advanced Stats
    let (mid_rms, side_rms) = crate::advanced_stats::analyze_stereo_width(&raw_data, channels);
    let lufs = crate::advanced_stats::get_integrated_lufs(&raw_data, channels, sr);
    // The envelope is thousands of floats; the record wants one. Reduce it here
    // and let the raw series go out of scope.
    let onset_periodicity = crate::advanced_stats::onset_periodicity(
        &crate::advanced_stats::detect_transient_onsets(&data, 512),
    );
    let (dc_offset, trailing_silence_ms) = crate::advanced_stats::calculate_qa_metrics(&data, sr);

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
    // taxonomy (group / subgroup / family / music-production role) on top of the
    // acoustic evidence.
    let name = name.to_string();
    let folder = folder.to_string();

    // Taxonomy labels (group / subgroup / reason / timbre / length tier / audit).
    let mut l = label_sample(
        &folder, &name, length, transients, bpm, harmonicity, sustain,
        amp.attack, amp.crest, spec.centroid, spec.low, spec.high,
    );
    let family = classify_family(&l.group, &l.subgroup, &acoustic, flux, l.sustained);

    if l.group == "Unclassified" {
        if family.contains(&"Membranophone".to_string()) || family.contains(&"Idiophone".to_string()) {
            l.group = "Perc".to_string();
            l.subgroup = "Acoustic Guess".to_string();
            l.reason = "Acoustic ML Fallback (ZCR/Inharmonicity)".to_string();
        } else if family.contains(&"Electrophone".to_string()) {
            l.group = "Keyboards".to_string();
            l.subgroup = "Synth".to_string();
            l.reason = "Acoustic ML Fallback (Sustained Harmonic)".to_string();
        } else if family.contains(&"Chordophone".to_string()) {
            l.group = "Strings".to_string();
            l.reason = "Acoustic ML Fallback (Plucked Harmonic)".to_string();
        }
    }

    let is_loop = l.group == "Loops/Patterns";
    // If it reads as a loop but carries no ACID tempo, estimate BPM from the
    // onset-envelope autocorrelation.
    if bpm == 0.0 && (is_loop || l.timbre == "Loop" || l.length_class == "Loop") {
        bpm = crate::tempo::estimate_bpm(&frames, sr_f, HOP);
    }
    bpm = bpm.round();
    let mut music_class =
        music_prod_category(&l.group, &l.subgroup, is_loop, &env).to_string();

    // The voice detector overrides the NAME — but not a loop. A vocal loop is
    // still a loop: what it is made of does not change the role it plays. (The
    // old god map let the vocal flag clobber Complex here, so every vocal-ish
    // loop lost its loop-ness.)
    if is_vocal && !is_loop {
        music_class = crate::music_prod::PERFORMANCE.to_string();
    }

    // Percussive hits rarely carry a meaningful root note. Unless an embedded
    // ACID root says otherwise or the pitch evidence is strong (clearly
    // harmonic, e.g. an 808 or a pitched tom), report none — nil is fine.
    let (root_name, root_hz, root_cents) =
        if (music_class == crate::music_prod::PERCUSSION
            || music_class == crate::music_prod::SHAKEN)
            && root_note < 0
            && harmonicity < 0.6
        {
            (String::new(), 0.0, 0.0)
        } else {
            (root_name, root_hz, root_cents)
        };

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
    let reason = vec![
        format!("1) {}", l.reason),
        format!("2) envelope {} (attack {:.0} ms, sustain {:.0}%, {} transient{})",
            env.shape, env.attack * 1000.0, env.sustain * 100.0,
            transients, if transients == 1 { "" } else { "s" }
        ),
        format!("3) {} · {}-band {:.0}%{}", acoustic.join("+"), band.0, band.1 * 100.0, root_part),
    ];

    let path = format!("{}/{}", folder, name);

    Some(finish(Peak {
        metadata: crate::peak::Metadata {
            analyzer_version: ANALYZER_VERSION.to_string(),
            name,
            folder: folder.clone(),
            sub: folder,
            path,
            length_seconds: length,
            sample_rate: sr,
            bit_depth,
            channels,
            source_format,
            lossy_source,
            dc_offset,
            trailing_silence_ms,
        },
        classification: crate::peak::Classification {
            group: l.group,
            reason,
            timbre: l.timbre,
            length_class: l.length_class,
            subgroup: l.subgroup,
            audit: l.audit,
            acoustic_types: acoustic,
            sound_design_roles: sound_design,
            instrument_family: family,
            music_production_category: music_class,
        },
        envelope: crate::peak::Envelope {
            transient_count: transients,
            attack_seconds: amp.attack,
            sustain_ratio: sustain,
            sustained: l.sustained,
            envelope_attack_seconds: env.attack,
            envelope_decay_seconds: env.decay,
            envelope_sustain_level: env.sustain,
            envelope_release_seconds: env.release,
            envelope_temporal_centroid: env.centroid,
            envelope_skewness: env.skew,
            envelope_kurtosis: env.kurt,
            envelope_shape: env.shape.to_string(),
            decay_time_seconds_60db: env.decay_time_60db,
            onset_periodicity,
        },
        spectral_features: crate::peak::SpectralFeatures {
            root_mean_square_level: amp.rms,
            crest_factor: amp.crest,
            zero_crossings_per_second: amp.zcr,
            complexity: spec.complexity,
            spectral_centroid_hz: spec.centroid,
            spectral_rolloff_hz: spec.rolloff,
            spectral_flatness: spec.flatness,
            low_band_energy: spec.low,
            mid_band_energy: spec.mid,
            high_band_energy: spec.high,
            spectral_flux: flux,
            harmonicity,
            inharmonicity: parts.inharmonicity,
            partial_count: parts.count,
            mel_frequency_cepstral_coefficients: mfcc,
            spectral_centroid_mean_hz: centroid_mean,
            spectral_centroid_deviation_hz: centroid_std,
            total_harmonic_distortion: dist.thd,
            clipping_density: dist.clipping,
            distortion: dist.label.to_string(),
            stationarity: morph.stationarity,
            spectral_entropy: morph.spectral_entropy,
            spectral_slope_db_per_octave: morph.spectral_slope_db_per_octave,
            band_limit_high_hz: morph.band_limit_high_hz,
            spectral_centroid_slope_hz_per_second: morph.spectral_centroid_slope_hz_per_second,
            syllabic_modulation_energy: morph.syllabic_modulation_energy,
            voicing_ratio,
            mid_rms,
            side_rms,
            lufs,
        },
        musicality: crate::peak::Musicality {
            pitch_hz: pitch,
            pitch_slope_semitones_per_second: morph.pitch_slope_semitones_per_second,
            root_note_name: root_name,
            root_frequency_hz: root_hz,
            root_cents_offset: root_cents,
            beats_per_minute: (bpm * 10.0).round() / 10.0,
            root_midi_note: root_note,
            chromagram: spec.chromagram,
        },
        unsupervised: crate::peak::Unsupervised {
            cluster: -1,
            principal_components: Vec::new(),
        },
        ucs: crate::peak::Ucs::default(),
    }))
}
