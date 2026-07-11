//! The streamed stdout protocol: one JSON line per analyzed (or skipped) file,
//! consumed live by the GUI. Keys match the .PEAK data model exactly — full
//! English, no abbreviations.
use crate::emit::emit;
use crate::peak::Peak;

/// Emit the "result" line for one successfully analyzed file.
pub fn emit_result(p: &Peak, done: usize, total: usize) {
    emit(&serde_json::json!({
        "type": "result", "done": done, "total": total,
        "name": p.name, "folder": p.folder, "group": p.group, "reason": p.reason,
        "timbre": p.timbre, "length_class": p.length_class, "subgroup": p.subgroup,
        "sustained": p.sustained, "sustain_ratio": p.sustain_ratio, "audit": p.audit,
        "pitch_hz": p.pitch_hz, "complexity": p.complexity, "length_seconds": p.length_seconds,
        "transient_count": p.transient_count, "spectral_centroid_hz": p.spectral_centroid_hz,
        "harmonicity": p.harmonicity, "high_band_energy": p.high_band_energy,
        "attack_seconds": p.attack_seconds, "beats_per_minute": p.beats_per_minute,
        "root_note_name": p.root_note_name, "root_frequency_hz": p.root_frequency_hz,
        "root_cents_offset": p.root_cents_offset,
        "sample_rate": p.sample_rate, "bit_depth": p.bit_depth, "channels": p.channels,
        "spectral_flux": p.spectral_flux, "inharmonicity": p.inharmonicity,
        "total_harmonic_distortion": p.total_harmonic_distortion,
        "clipping_density": p.clipping_density, "distortion": p.distortion,
        "envelope_shape": p.envelope_shape, "envelope_attack_seconds": p.envelope_attack_seconds,
        "envelope_sustain_level": p.envelope_sustain_level,
        "acoustic_types": p.acoustic_types, "sound_design_roles": p.sound_design_roles,
        "instrument_family": p.instrument_family, "god_category": p.god_category
    }));
}

/// Emit the "skip" line for a file that could not be analyzed.
pub fn emit_skip(name: &str, done: usize, total: usize) {
    emit(&serde_json::json!({ "type": "skip", "done": done, "total": total, "name": name }));
}
