//! The per-file analysis record: streamed to the GUI (one JSON line each) and
//! written to the aggregate `sample_cloud_data.PEAK` / per-file sidecars.
//!
//! Field names are deliberately spelled out in full English — the .PEAK file
//! is a data model others read, so nothing is abbreviated or implied.
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct Metadata {
    pub analyzer_version: String,
    pub name: String,
    pub folder: String,
    pub sub: String,
    pub path: String,
    pub length_seconds: f64,
    pub sample_rate: u32,
    pub bit_depth: u16,
    pub channels: u16,
    pub source_format: String,
    pub lossy_source: bool,
    pub dc_offset: f64,
    pub trailing_silence_ms: f64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Classification {
    pub group: String,
    pub reason: Vec<String>,
    pub timbre: String,
    pub length_class: String,
    pub subgroup: String,
    pub audit: bool,
    pub acoustic_types: Vec<String>,
    pub sound_design_roles: Vec<String>,
    pub instrument_family: Vec<String>,
    pub god_category: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Ucs {
    pub category: String,
    pub subcategory: String,
    pub id: String,
    pub confidence: f64,
    pub alternatives: Vec<String>,
    pub reason: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Envelope {
    pub transient_count: usize,
    pub attack_seconds: f64,
    pub sustain_ratio: f64,
    pub sustained: bool,
    pub envelope_attack_seconds: f64,
    pub envelope_decay_seconds: f64,
    pub envelope_sustain_level: f64,
    pub envelope_release_seconds: f64,
    pub envelope_temporal_centroid: f64,
    pub envelope_skewness: f64,
    pub envelope_kurtosis: f64,
    pub envelope_shape: String,
    #[serde(default)]
    pub decay_time_seconds_60db: Option<f64>,
    #[serde(default)]
    pub onset_periodicity: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SpectralFeatures {
    pub root_mean_square_level: f64,
    pub crest_factor: f64,
    pub zero_crossings_per_second: f64,
    pub complexity: f64,
    pub spectral_centroid_hz: f64,
    pub spectral_rolloff_hz: f64,
    pub spectral_flatness: f64,
    pub low_band_energy: f64,
    pub mid_band_energy: f64,
    pub high_band_energy: f64,
    pub spectral_flux: f64,
    pub harmonicity: f64,
    pub inharmonicity: f64,
    pub partial_count: usize,
    pub mel_frequency_cepstral_coefficients: Vec<f64>,
    pub spectral_centroid_mean_hz: f64,
    pub spectral_centroid_deviation_hz: f64,
    pub total_harmonic_distortion: f64,
    pub clipping_density: f64,
    pub distortion: String,
    #[serde(default)]
    pub stationarity: Option<f64>,
    #[serde(default)]
    pub spectral_entropy: Option<f64>,
    #[serde(default)]
    pub spectral_slope_db_per_octave: Option<f64>,
    #[serde(default)]
    pub band_limit_high_hz: Option<f64>,
    #[serde(default)]
    pub spectral_centroid_slope_hz_per_second: Option<f64>,
    #[serde(default)]
    pub syllabic_modulation_energy: Option<f64>,
    #[serde(default)]
    pub voicing_ratio: Option<f64>,
    pub mid_rms: f64,
    pub side_rms: f64,
    pub lufs: f64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Musicality {
    pub pitch_hz: f64,
    #[serde(default)]
    pub pitch_slope_semitones_per_second: Option<f64>,
    pub root_note_name: String,
    pub root_frequency_hz: f64,
    pub root_cents_offset: f64,
    pub beats_per_minute: f64,
    pub root_midi_note: i32,
    pub chromagram: [f64; 12],
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Unsupervised {
    pub cluster: i32,
    pub principal_components: Vec<f64>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Peak {
    pub metadata: Metadata,
    pub classification: Classification,
    pub envelope: Envelope,
    pub spectral_features: SpectralFeatures,
    pub musicality: Musicality,
    pub unsupervised: Unsupervised,
    pub ucs: Ucs,
}
