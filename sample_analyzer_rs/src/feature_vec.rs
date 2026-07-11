use crate::peak::Peak;

/// How many MFCC coefficients join the feature vector (c1…c5 — c0 is overall
/// log-energy, i.e. loudness, which the RMS level already covers).
const MFCC_IN_VEC: usize = 5;

/// The acoustic feature vector used for blind clustering and the PCA map
/// (name-independent): envelope, spectral, and timbral-fingerprint features.
pub fn feature_vec(p: &Peak) -> Vec<f64> {
    let mut v = vec![
        (1.0 + p.length_seconds).ln(),
        p.root_mean_square_level,
        p.zero_crossings_per_second,
        p.spectral_centroid_hz,
        p.harmonicity,
        p.low_band_energy,
        p.high_band_energy,
        p.crest_factor,
        p.attack_seconds,
        p.envelope_sustain_level,
        p.envelope_skewness,
        p.spectral_flux,
        p.inharmonicity,
        p.spectral_centroid_deviation_hz,
        // Distortion metrics: pull "clean vs dirty" versions of otherwise
        // identical sounds (clean guitar vs fuzz guitar) into separate clusters.
        p.total_harmonic_distortion,
        p.clipping_density,
    ];
    for j in 1..=MFCC_IN_VEC {
        v.push(p.mel_frequency_cepstral_coefficients.get(j).copied().unwrap_or(0.0));
    }
    v
}
