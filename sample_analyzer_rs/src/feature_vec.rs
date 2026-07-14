use crate::peak::Peak;

/// How many MFCC coefficients join the feature vector (c1…c5 — c0 is overall
/// log-energy, i.e. loudness, which the RMS level already covers).
const MFCC_IN_VEC: usize = 5;

/// The acoustic feature vector used for blind clustering and the PCA map
/// (name-independent): envelope, spectral, and timbral-fingerprint features.
pub fn feature_vec(p: &Peak) -> Vec<f64> {
    let mut v = vec![
        (1.0 + p.metadata.length_seconds).ln(),
        p.spectral_features.root_mean_square_level,
        p.spectral_features.zero_crossings_per_second,
        p.spectral_features.spectral_centroid_hz,
        p.spectral_features.harmonicity,
        p.spectral_features.low_band_energy,
        p.spectral_features.high_band_energy,
        p.spectral_features.crest_factor,
        p.envelope.attack_seconds,
        p.envelope.envelope_sustain_level,
        p.envelope.envelope_skewness,
        p.spectral_features.spectral_flux,
        p.spectral_features.inharmonicity,
        p.spectral_features.spectral_centroid_deviation_hz,
        // Distortion metrics: pull "clean vs dirty" versions of otherwise
        // identical sounds (clean guitar vs fuzz guitar) into separate clusters.
        p.spectral_features.total_harmonic_distortion,
        p.spectral_features.clipping_density,
    ];
    for j in 1..=MFCC_IN_VEC {
        v.push(p.spectral_features.mel_frequency_cepstral_coefficients.get(j).copied().unwrap_or(0.0));
    }
    v
}
