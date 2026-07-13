//! The per-file analysis record: streamed to the GUI (one JSON line each) and
//! written to the aggregate `sample_cloud_data.PEAK` / per-file sidecars.
//!
//! Field names are deliberately spelled out in full English — the .PEAK file
//! is a data model others read, so nothing is abbreviated or implied.
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct Peak {
    pub analyzer_version: String, // version that produced this record (crate version + source hash);
                                  // a sidecar whose version matches the running binary is reused, not re-analyzed
    pub name: String,   // file name
    pub folder: String, // sub-folder relative to the scanned root ("" = root)
    pub sub: String,    // alias of `folder` (SoundCloud view compatibility)
    pub path: String,   // absolute path
    pub group: String,        // path-derived category (Kick, Snare, Perc, Keyboards, DJ, … Unclassified) — or "Loops/Patterns"
    pub reason: Vec<String>,  // WHY it's in `group`: ["name evidence", "envelope evidence", "spectral evidence"]
    pub timbre: String,       // feature-derived class (Percussive/Tonal/Noise/Bass/Bright/Loop/Pad)
    pub length_class: String, // one-shot length tier: Short / Medium / Long (or "Loop")
    pub subgroup: String,     // curated instrument level (Perc→Conga, Tom→Hi/Mid/Lo), a "Drum" audit tag, or "group + length tier"
    pub audit: bool,          // generic "drum" tag, no specific type — flag for acoustic audit

    // --- time / envelope ---
    pub length_seconds: f64,
    pub transient_count: usize,          // onset count; >1 ⇒ multi-hit (loop) rather than a one-shot
    pub attack_seconds: f64,             // time from start to the loudest sample (small ⇒ percussive)
    pub root_mean_square_level: f64,     // overall loudness (linear RMS)
    pub crest_factor: f64,               // peak / RMS (high ⇒ spiky/transient, low ⇒ sustained/squashed)
    pub zero_crossings_per_second: f64,  // high ⇒ noisy/bright

    // --- pitch / harmonicity ---
    pub pitch_hz: f64,       // autocorrelation pitch estimate
    pub harmonicity: f64,    // 0 = atonal/noise … 1 = strongly pitched
    pub sustain_ratio: f64,  // fraction of the file held above 50% of peak level
    pub sustained: bool,     // a single fundamental note sustained the whole file

    // --- spectrum (single whole-file FFT) ---
    pub complexity: f64,             // spectral spread around the centroid (timbral richness)
    pub spectral_centroid_hz: f64,   // brightness
    pub spectral_rolloff_hz: f64,    // 85%-energy roll-off
    pub spectral_flatness: f64,      // 0 = tonal … 1 = noise-like
    pub low_band_energy: f64,        // fraction of energy < 200 Hz
    pub mid_band_energy: f64,        // fraction 200 Hz – 2 kHz
    pub high_band_energy: f64,       // fraction > 2 kHz

    // --- frame-based timbre (short-time Fourier transform) ---
    pub spectral_flux: f64,          // 0 = static spectrum … ~1 = churning
    pub inharmonicity: f64,          // partial detune from integer harmonics: 0 = harmonic … 1 = metallic
    pub partial_count: usize,        // detected spectral peaks above the fundamental
    pub mel_frequency_cepstral_coefficients: Vec<f64>, // 13-coefficient timbral fingerprint (mean over frames)
    pub spectral_centroid_mean_hz: f64,      // frame-wise centroid mean (brightness over time)
    pub spectral_centroid_deviation_hz: f64, // frame-wise centroid std-dev (brightness modulation)

    // --- distortion (crest_factor above is the third metric) ---
    pub total_harmonic_distortion: f64, // harmonic power / fundamental (0 = pure; gated to 0 when unmeasurable)
    pub clipping_density: f64,          // fraction of samples pinned at the ceiling in flat-top runs
    pub distortion: String,             // Clean / Dirty / Clipped

    // --- ADSR envelope (measured from the amplitude envelope) ---
    pub envelope_attack_seconds: f64,    // 10% → 90% rise time
    pub envelope_decay_seconds: f64,     // peak → sustain plateau
    pub envelope_sustain_level: f64,     // plateau level, fraction of peak (0..1)
    pub envelope_release_seconds: f64,   // final fade to silence
    pub envelope_temporal_centroid: f64, // where the energy sits in time, 0..1 (front-loaded ⇒ ~0)
    pub envelope_skewness: f64,          // 3rd moment; high positive ⇒ percussive front-load
    pub envelope_kurtosis: f64,          // 4th moment (excess); high ⇒ isolated bursts
    pub envelope_shape: String,          // Swell / Sustained / Plucky / Decaying / Multi / Silent

    // --- multi-label timbre taxonomy (a sound can carry several tags) ---
    pub acoustic_types: Vec<String>,     // Harmonic / Inharmonic / Stochastic / Impulsive
    pub sound_design_roles: Vec<String>, // Pad / Pluck / Lead / Bass ([] for drums/FX)
    pub instrument_family: Vec<String>,  // Hornbostel-Sachs and western family labels
    pub god_category: String,            // top-level envelope "god category"

    // --- raw file attributes ---
    pub sample_rate: u32,
    pub bit_depth: u16,
    pub channels: u16,

    // --- musical ROOT (note / key), FFT-derived (ACID takes precedence) ---
    pub root_note_name: String,   // e.g. "A3" ("" if unpitched/none)
    pub root_frequency_hz: f64,   // detected fundamental (0 if none)
    pub root_cents_offset: f64,   // cents off the equal-tempered note (−50..+50)

    // --- embedded metadata (ACID chunk, when present) ---
    pub beats_per_minute: f64,    // 0.0 if none
    pub root_midi_note: i32,      // MIDI root note from the ACID chunk, -1 if none

    // --- unsupervised grouping (assigned after all files are analyzed) ---
    pub cluster: i32,                     // K-Means cluster id, -1 until clustered
    pub principal_components: Vec<f64>,   // top-3 PCA coordinates of the feature space (2D/3D map)

    // --- advanced stats ---
    pub mid_rms: f64,
    pub side_rms: f64,
    pub lufs: f64,
    pub chromagram: [f64; 12],
    pub dc_offset: f64,
    pub trailing_silence_ms: f64,
    pub onset_envelope: Vec<f64>,

    // --- Universal Category System (UCS) ---
    pub ucs_category: String,
    pub ucs_subcategory: String,
    pub ucs_id: String,
}
