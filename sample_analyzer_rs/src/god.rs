//! Top-level envelope "god categories" — the coarsest useful taxonomy of a
//! sample library, based on fundamental ADSR shapes:
//!
//!   Percussive          — instant attack, fast decay, zero sustain
//!                         (rhythmic anchors, drive, sharp impacts — all drums
//!                         including cymbals and rides)
//!   Impulsive with Tail — instant attack, long decay/release, zero sustain
//!                         (impulse responses; measured ringing washes)
//!   Tonal      — variable attack, high sustain
//!                            (melody, harmony, continuous bass foundations)
//!   Complex   — multiple transients or looping sustain
//!                            (texture, rhythm beds, specialized FX)
//!
//! A recognized name group is assigned by the curated map below; files the
//! name taxonomy could not place are classified by their measured envelope.
use crate::envelope::Envelope;

pub const PERCUSSIVE: &str = "Percussive";
pub const IMPULSIVE_TAIL: &str = "Impulsive with Tail";
pub const TONAL: &str = "Tonal";
// Keyboards are their own top-level container: a keyboard with no BPM tag is
// tonal by nature and never falls through to the envelope guess.
pub const KEYBOARDS: &str = "Keyboards";
pub const COMPLEX: &str = "Complex";
pub const VOCAL: &str = "Vocal";
pub const UNASSIGNED: &str = "Unassigned";

/// Assign the god category. `is_loop` (from the loop detector) forces
/// Complex; a matched name group uses the curated map; otherwise
/// the measured ADSR envelope decides.
pub fn god_category(group: &str, is_loop: bool, env: &Envelope) -> &'static str {
    if is_loop {
        return COMPLEX;
    }
    match group {
        // Cymbals and rides are drums — percussive, tail and all.
        "Clap" | "Cymbal" | "Hi-Hat" | "Kick" | "Perc" | "Ride" | "Rim" | "Snare" | "Tom" => PERCUSSIVE,
        "IR" => IMPULSIVE_TAIL,
        "Bass" | "Guitar" | "Horn" | "Note" | "Sax" | "Strings" | "Vocal" => TONAL,
        // A named keyboard with no BPM can never be flagged a loop (the name
        // match blocks the transient fallback), so this always lands here.
        "Keyboards" => KEYBOARDS,
        "DJ" | "FX" | "Loops/Patterns" | "Scratch" => COMPLEX,
        // Name taxonomy failed — classify by the measured envelope.
        _ => god_from_envelope(env),
    }
}

/// Envelope-measured category for files without a recognized name.
fn god_from_envelope(env: &Envelope) -> &'static str {
    match env.shape {
        "Multi" => COMPLEX,
        "Sustained" | "Swell" => TONAL,
        "Plucky" => PERCUSSIVE,
        "Decaying" => {
            // Fast attack, no plateau: length of the die-off tells hits apart
            // from washes (reverb-like tails ring well past half a second).
            if env.decay + env.release > 0.5 {
                IMPULSIVE_TAIL
            } else {
                PERCUSSIVE
            }
        }
        _ => UNASSIGNED, // "Silent" or unmeasurable
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::envelope::Envelope;

    fn env(shape: &'static str, decay: f64, release: f64) -> Envelope {
        Envelope { attack: 0.005, decay, sustain: 0.05, release, centroid: 0.2, skew: 0.0, kurt: 0.0, shape, decay_time_60db: None }
    }

    #[test]
    fn name_map_and_envelope_fallback() {
        let e = env("Plucky", 0.05, 0.05);
        // The curated map wins for recognized groups; cymbals/rides are drums.
        assert_eq!(god_category("Kick", false, &e), PERCUSSIVE);
        assert_eq!(god_category("Cymbal", false, &e), PERCUSSIVE);
        assert_eq!(god_category("Ride", false, &e), PERCUSSIVE);
        assert_eq!(god_category("IR", false, &e), IMPULSIVE_TAIL);
        assert_eq!(god_category("Guitar", false, &e), TONAL);
        // Keyboards are their own category; no BPM (is_loop=false) keeps them there.
        assert_eq!(god_category("Keyboards", false, &e), KEYBOARDS);
        assert_eq!(god_category("FX", false, &e), COMPLEX);
        // A loop is Complex regardless of its name.
        assert_eq!(god_category("Kick", true, &e), COMPLEX);
        // Unclassified: the measured envelope decides.
        assert_eq!(god_category("Unclassified", false, &env("Plucky", 0.05, 0.05)), PERCUSSIVE);
        assert_eq!(god_category("Unclassified", false, &env("Decaying", 1.2, 0.8)), IMPULSIVE_TAIL);
        assert_eq!(god_category("Unclassified", false, &env("Decaying", 0.1, 0.1)), PERCUSSIVE);
        assert_eq!(god_category("Unclassified", false, &env("Sustained", 0.1, 0.4)), TONAL);
        assert_eq!(god_category("Unclassified", false, &env("Multi", 0.1, 0.1)), COMPLEX);
        assert_eq!(god_category("Unclassified", false, &env("Silent", 0.0, 0.0)), UNASSIGNED);
    }
}
