//! oa_sample_analyzer — fast, parallel audio-sample analyzer.
//!
//! Walks a directory for audio files and, across a pool of worker threads (30 by
//! default), computes for each: length, a pitch estimate (autocorrelation), and
//! a spectral "complexity" (centroid + spread). Streams one JSON line per file
//! to stdout so a GUI can graph progress live, then writes the aggregate
//! `sample_cloud_data.PEAK` (each record includes the file NAME and FOLDER).
//!
//! Usage: oa_sample_analyzer <dir> [--out <path>] [--workers <n>] [--max-len <s>]
//!
//! The code is split one-purpose-per-module:
//!   peak         — the streamed/serialized record struct
//!   normalize    — file-name tokenizer for keyword matching
//!   categorize   — name/path → group + subgroup taxonomy (+ tests)
//!   decode / wav — audio decode to mono f32 (WAV via hound; MP3/FLAC/AIFF/
//!                  OGG/M4A via symphonia), lossy sources flagged
//!   acid         — ACID loop metadata (BPM + root) from the WAV chunk
//!   amplitude / pitch / spectrum / transients / sustain — feature extractors
//!   stft / flux / mfcc / framestats — frame-based spectral features
//!   envelope     — measured ADSR (attack/decay/sustain/release) + moments + shape
//!   morphology   — the UCS morphology axis (spec §4b): stationarity, spectral
//!                  entropy/tilt/band-limit, centroid & pitch sweep slopes,
//!                  syllabic modulation
//!   partials     — overtone peak-picking → inharmonicity (harmonic vs metallic)
//!   distortion   — THD + clipping density → Clean / Dirty / Clipped
//!   moments      — mean / variance / skewness / kurtosis of a series
//!   timbre / label — feature+name → timbre and taxonomy labels
//!   tags / family / music_prod — multi-label acoustic types, sound-design roles,
//!                  Hornbostel-Sachs family, music-production role
//!   analyze      — orchestrates the extractors into one `Peak`
//!   feature_vec / sqdist / kmeans / cluster / pca — blind grouping + embedding
//!   args / discover / sidecar / stream / emit / run — CLI + orchestration

pub mod acid;
pub mod advanced_stats;
pub mod amplitude;
pub mod analyze;
pub mod args;
pub mod categorize;
pub mod cluster;
pub mod decode;
pub mod discover;
pub mod distortion;
pub mod emit;
pub mod envelope;
pub mod family;
pub mod feature_vec;
pub mod flux;
pub mod framestats;
pub mod music_prod;
pub mod kmeans;
pub mod label;
pub mod mfcc;
pub mod moments;
pub mod morphology;
pub mod normalize;
pub mod partials;
pub mod pca;
pub mod peak;
pub mod pitch;
pub mod root;
pub mod run;
pub mod sidecar;
pub mod spectrum;
pub mod sqdist;
pub mod stft;
pub mod stream;
pub mod sustain;
pub mod tags;
pub mod tempo;
pub mod timbre;
pub mod transients;
pub mod version;
pub mod vad;
pub mod wav;
pub mod ucs;
