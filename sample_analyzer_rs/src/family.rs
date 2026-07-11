//! Hornbostel-Sachs instrument family — a best-effort guess at what is
//! physically vibrating: Membranophone (stretched skin), Idiophone (the body
//! itself), Chordophone (strings), Aerophone (air column), Electrophone
//! (oscillators/circuits), or Voice.
//!
//! A confident name/path match decides first; otherwise the acoustic tags are
//! consulted; "" when there is no honest basis for a guess.

/// Guess the family from the name-derived group/subgroup, falling back to the
/// acoustic signal types. Returns "" when unknown.
pub fn classify_family(group: &str, subgroup: &str, acoustic: &[String], flux: f64, sustained: bool) -> String {
    // --- name-derived (authoritative when the taxonomy matched) ---
    let by_name = match group {
        "Kick" | "Snare" | "Tom" => "Membranophone",
        "Cymbal" | "HiHat" | "Ride" | "Rim" | "Clap" => "Idiophone",
        "Perc" => match subgroup {
            "Conga" | "Bongo" => "Membranophone",
            "Cowbell" | "Clave" | "Block" | "Shaker" => "Idiophone",
            _ => "",
        },
        "Guitar" | "Strings" => "Chordophone",
        "Keyboards" => match subgroup {
            "Piano" | "Clav" => "Chordophone",
            // Rhodes/Wurli tines are struck metal, but the sound is electric.
            "Electric Piano" | "Organ" | "Synth" | _ => "Electrophone",
        },
        "Vocal" => "Voice",
        "Scratch" | "DJ" | "FX" => "Electrophone",
        _ => "",
    };
    if !by_name.is_empty() {
        return by_name.to_string();
    }

    // --- acoustic fallback (only where the signal type is telling) ---
    let has = |t: &str| acoustic.iter().any(|x| x == t);
    if has("Inharmonic") {
        return "Idiophone".to_string(); // detuned metallic partials
    }
    if has("Stochastic") && has("Impulsive") {
        return "Membranophone".to_string(); // noisy burst with a fast transient
    }
    if has("Harmonic") && sustained && flux < 0.05 {
        // A perfectly static harmonic spectrum held indefinitely — oscillator-like.
        return "Electrophone".to_string();
    }
    String::new()
}

#[cfg(test)]
mod tests {
    use super::classify_family;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn name_mapping_wins_then_acoustics() {
        assert_eq!(classify_family("Kick", "", &[], 0.5, false), "Membranophone");
        assert_eq!(classify_family("Cymbal", "", &[], 0.5, false), "Idiophone");
        assert_eq!(classify_family("Perc", "Conga", &[], 0.5, false), "Membranophone");
        assert_eq!(classify_family("Perc", "Shaker", &[], 0.5, false), "Idiophone");
        assert_eq!(classify_family("Guitar", "", &[], 0.5, false), "Chordophone");
        assert_eq!(classify_family("Keyboards", "Piano", &[], 0.5, false), "Chordophone");
        assert_eq!(classify_family("Keyboards", "Synth", &[], 0.5, false), "Electrophone");
        assert_eq!(classify_family("Vocal", "", &[], 0.5, false), "Voice");
        // Unnamed: acoustic tags decide.
        assert_eq!(classify_family("Unclassified", "", &s(&["Inharmonic"]), 0.5, false), "Idiophone");
        assert_eq!(
            classify_family("Unclassified", "", &s(&["Stochastic", "Impulsive"]), 0.5, false),
            "Membranophone"
        );
        assert_eq!(classify_family("Unclassified", "", &s(&["Harmonic"]), 0.01, true), "Electrophone");
        // No honest basis → unknown.
        assert_eq!(classify_family("Unclassified", "", &s(&["Harmonic"]), 0.3, false), "");
    }
}
