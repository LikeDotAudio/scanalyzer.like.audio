//! oa_sample_analyzer — fast, parallel audio-sample analyzer.
//!
//! Walks a directory for WAV files and, across a pool of worker threads (30 by
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
//!   wav / acid   — WAV decode (mono f32) and ACID loop metadata
//!   amplitude / pitch / spectrum / transients / sustain — feature extractors
//!   stft / flux / mfcc / framestats — frame-based spectral features
//!   envelope     — measured ADSR (attack/decay/sustain/release) + moments + shape
//!   partials     — overtone peak-picking → inharmonicity (harmonic vs metallic)
//!   distortion   — THD + clipping density → Clean / Dirty / Clipped
//!   moments      — mean / variance / skewness / kurtosis of a series
//!   timbre / label — feature+name → timbre and taxonomy labels
//!   tags / family / god — multi-label acoustic types, sound-design roles,
//!                  Hornbostel-Sachs family, envelope god category
//!   analyze      — orchestrates the extractors into one `Peak`
//!   feature_vec / sqdist / kmeans / cluster / pca — blind grouping + embedding
//!   args / discover / sidecar / stream / emit / run — CLI + orchestration

mod acid;
mod amplitude;
mod analyze;
mod args;
mod categorize;
mod cluster;
mod discover;
mod distortion;
mod emit;
mod envelope;
mod family;
mod feature_vec;
mod flux;
mod framestats;
mod god;
mod kmeans;
mod label;
mod mfcc;
mod moments;
mod normalize;
mod partials;
mod pca;
mod peak;
mod pitch;
mod root;
mod run;
mod sidecar;
mod spectrum;
mod sqdist;
mod stft;
mod stream;
mod sustain;
mod tags;
mod timbre;
mod transients;
mod version;
mod wav;

fn main() {
    // Per-file panics are caught during the run; keep their default messages off stderr.
    std::panic::set_hook(Box::new(|_| {}));

    match args::Config::parse(std::env::args().collect()) {
        Some(cfg) => run::run(&cfg),
        None => {
            eprintln!("usage: oa_sample_analyzer <dir> [--out <path>] [--workers <n>] [--max-len <s>] [--clusters <k>] [--no-per-file] [--force]");
            std::process::exit(2);
        }
    }
}
