//! The MUSICPROD taxonomy: the role a sample plays in a music production.
//!
//! This replaces the old "god categories" (Percussive / Tonal / Keyboards /
//! Complex / Impulsive with Tail), which were a coarse ADSR guess and had gone
//! stale in two ways:
//!
//!   * `"Vocal"` was a dead match arm — `categorize()` returns `"Voice"`, so it
//!     never once fired.
//!   * The map only ever looked at the GROUP, so every tuned or bell-like
//!     percussion (Bell, Cowbell, Chime, Kalimba, Triangle, Shaker, Gong) landed
//!     in one undifferentiated bucket, and a synth — a Keyboards SUBGROUP — was
//!     indistinguishable from a piano.
//!
//! The subcategory names come from UCS/categories/MUSICPROD.json, which reuses
//! UCS MUSICAL's names and signatures but is excluded from the UCS matcher index
//! (`"matchable": false`): it answers "what role does this play", not "what is
//! this sound". The two axes are carried side by side on every record.
use crate::envelope::Envelope;

// The six producer families a drum sampler is organized around, plus the families the
// rest of a real library needs: MELODIC for tuned instruments, LOOP, IMPULSE_RESPONSE,
// and MISC for what nothing could place.
pub const CORE_KIT: &str = "CORE KIT";
pub const CYMBALS: &str = "CYMBALS & METALS";
pub const HAND_PERCUSSION: &str = "HAND PERCUSSION";
pub const WORLD: &str = "WORLD & REGIONAL";
pub const ORCHESTRAL: &str = "ORCHESTRAL & PITCHED";
pub const ELECTRONIC: &str = "ELECTRONIC & DESIGN";
pub const MELODIC: &str = "MELODIC";
pub const LOOP: &str = "LOOP";
pub const IMPULSE_RESPONSE: &str = "IMPULSE RESPONSE";
pub const MISC: &str = "MISC";

/// Assign the production FAMILY from the instrument group. A loop is a LOOP whatever it
/// contains; a recognized instrument maps to its family; anything the name taxonomy
/// could not place is classified by its measured envelope.
///
/// `subgroup` is unused now — the family is decided by the instrument alone — but kept in
/// the signature so the call site and the record schema do not have to change.
pub fn music_prod_category(
    group: &str,
    _subgroup: &str,
    is_loop: bool,
    env: &Envelope,
) -> &'static str {
    if is_loop {
        return LOOP;
    }
    // The instrument→family membership lives in MUSICPROD.json, read by categorize.rs.
    // A name the taxonomy could not place has no family; the envelope decides.
    crate::categorize::family_of(group).unwrap_or_else(|| from_envelope(env))
}

/// A struck / hit family, where a root note is usually meaningless noise.
pub fn is_percussive_family(family: &str) -> bool {
    matches!(family, CORE_KIT | CYMBALS | HAND_PERCUSSION | WORLD)
}

/// Family for a file whose name told us nothing.
fn from_envelope(env: &Envelope) -> &'static str {
    match env.shape {
        "Multi" => LOOP,
        "Sustained" | "Swell" => MELODIC,
        "Plucky" => CORE_KIT,
        "Decaying" => {
            // Fast attack, no plateau: the length of the die-off separates a hit
            // from a ringing wash (a reverb-like tail rings well past half a second).
            if env.decay + env.release > 0.5 {
                IMPULSE_RESPONSE
            } else {
                CORE_KIT
            }
        }
        _ => MISC, // "Silent" or unmeasurable
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::envelope::Envelope;

    fn env(shape: &'static str, decay: f64, release: f64) -> Envelope {
        Envelope {
            attack: 0.005,
            decay,
            sustain: 0.05,
            release,
            centroid: 0.2,
            skew: 0.0,
            kurt: 0.0,
            shape,
            decay_time_60db: None,
        }
    }

    #[test]
    fn instruments_map_to_their_families() {
        let e = env("Plucky", 0.05, 0.05);
        // 1. Core kit.
        assert_eq!(music_prod_category("Kick", "", false, &e), CORE_KIT);
        assert_eq!(music_prod_category("Snare", "Rimshot", false, &e), CORE_KIT);
        assert_eq!(music_prod_category("Hi-Hat", "Closed", false, &e), CORE_KIT);
        assert_eq!(music_prod_category("Clap", "", false, &e), CORE_KIT);
        // 2. Cymbals & metals — each cymbal is its own instrument now.
        assert_eq!(music_prod_category("Crash", "", false, &e), CYMBALS);
        assert_eq!(music_prod_category("Ride", "", false, &e), CYMBALS);
        assert_eq!(music_prod_category("China", "", false, &e), CYMBALS);
        // 3. Hand percussion.
        assert_eq!(music_prod_category("Shaker", "", false, &e), HAND_PERCUSSION);
        assert_eq!(music_prod_category("Cowbell", "", false, &e), HAND_PERCUSSION);
        assert_eq!(music_prod_category("Perc", "", false, &e), HAND_PERCUSSION);
        // 4. World & regional.
        assert_eq!(music_prod_category("Conga", "", false, &e), WORLD);
        assert_eq!(music_prod_category("Djembe", "", false, &e), WORLD);
        assert_eq!(music_prod_category("Cajon", "", false, &e), WORLD);
        // 5. Orchestral & pitched.
        assert_eq!(music_prod_category("Marimba", "", false, &e), ORCHESTRAL);
        assert_eq!(music_prod_category("Timpani", "", false, &e), ORCHESTRAL);
        // 6. Electronic & design.
        assert_eq!(music_prod_category("808", "", false, &e), ELECTRONIC);
        assert_eq!(music_prod_category("Vocal", "", false, &e), ELECTRONIC);
        assert_eq!(music_prod_category("FX", "Riser", false, &e), ELECTRONIC);
        // Melodic content the drum families do not cover.
        assert_eq!(music_prod_category("Guitar", "", false, &e), MELODIC);
        assert_eq!(music_prod_category("Bass", "", false, &e), MELODIC);
        assert_eq!(music_prod_category("Keyboards", "Synth", false, &e), MELODIC);
        // IR keeps its own family.
        assert_eq!(music_prod_category("IR", "", false, &e), IMPULSE_RESPONSE);
    }

    #[test]
    fn loop_wins_and_envelope_fallback() {
        let e = env("Plucky", 0.05, 0.05);
        // A loop is a LOOP whatever its name says.
        assert_eq!(music_prod_category("Kick", "", true, &e), LOOP);
        assert_eq!(music_prod_category("Loops/Patterns", "", false, &e), LOOP);
        // Unrecognized name → the measured envelope decides.
        assert_eq!(music_prod_category("Unclassified", "", false, &env("Plucky", 0.05, 0.05)), CORE_KIT);
        assert_eq!(music_prod_category("Unclassified", "", false, &env("Decaying", 1.2, 0.8)), IMPULSE_RESPONSE);
        assert_eq!(music_prod_category("Unclassified", "", false, &env("Decaying", 0.1, 0.1)), CORE_KIT);
        assert_eq!(music_prod_category("Unclassified", "", false, &env("Sustained", 0.1, 0.4)), MELODIC);
        assert_eq!(music_prod_category("Unclassified", "", false, &env("Multi", 0.1, 0.1)), LOOP);
        assert_eq!(music_prod_category("Unclassified", "", false, &env("Silent", 0.0, 0.0)), MISC);
    }

    #[test]
    fn percussive_families_are_flagged_for_root_suppression() {
        assert!(is_percussive_family(CORE_KIT));
        assert!(is_percussive_family(CYMBALS));
        assert!(is_percussive_family(WORLD));
        assert!(!is_percussive_family(MELODIC));
        assert!(!is_percussive_family(ELECTRONIC));
    }
}
