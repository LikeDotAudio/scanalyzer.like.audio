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

pub const BELLS: &str = "BELLS";
pub const BRASS: &str = "BRASS";
pub const CHIME: &str = "CHIME";
pub const EXPERIMENTAL: &str = "EXPERIMENTAL";
pub const IMPULSE_RESPONSE: &str = "IMPULSE RESPONSE";
pub const INSTRUMENT: &str = "INSTRUMENT";
pub const KEYED: &str = "KEYED";
pub const LOOP: &str = "LOOP";
pub const MISC: &str = "MISC";
pub const PERCUSSION: &str = "PERCUSSION";
pub const PERCUSSION_TUNED: &str = "PERCUSSION TUNED";
pub const PERFORMANCE: &str = "PERFORMANCE";
pub const PLUCKED: &str = "PLUCKED";
pub const SHAKEN: &str = "SHAKEN";
pub const STRINGED: &str = "STRINGED";
pub const SYNTHESIZED: &str = "SYNTHESIZED";
pub const WOODWIND: &str = "WOODWIND";

/// Assign the music-production role. A loop is a LOOP whatever it contains; a
/// recognized (group, subgroup) uses the curated map; anything the name taxonomy
/// could not place is classified by its measured envelope.
pub fn music_prod_category(
    group: &str,
    subgroup: &str,
    is_loop: bool,
    env: &Envelope,
) -> &'static str {
    if is_loop {
        return LOOP;
    }
    match (group, subgroup) {
        // A convolution IR is not a musical part, but it is in the library, so it
        // gets a role of its own rather than falling into MISC.
        ("IR", _) => IMPULSE_RESPONSE,

        // Keyboards split on the subgroup: a synth is a synth, not a piano.
        ("Keyboards", "Synth") => SYNTHESIZED,
        ("Keyboards", _) => KEYED,

        // Tuned / bell-like percussion, routed by subgroup. These all used to
        // collapse into the same bucket as a kick drum.
        ("Perc", "Bell") | ("Perc", "Cowbell") | ("Cymbal", "Gong") => BELLS,
        ("Perc", "Chime") => CHIME,
        ("Perc", "Shaker") => SHAKEN,
        ("Perc", "Kalimba") | ("Perc", "Triangle") => PERCUSSION_TUNED,

        // The drum kit and the rest of auxiliary percussion.
        ("Kick", _) | ("Snare", _) | ("Hi-Hat", _) | ("Ride", _) | ("Cymbal", _)
        | ("Clap", _) | ("Rim", _) | ("Tom", _) | ("Perc", _) => PERCUSSION,

        ("Guitar", _) => PLUCKED,
        ("Strings", _) => STRINGED,
        ("Horn", _) => BRASS,
        ("Sax", _) => WOODWIND,

        // Bass is an instrument: the name matcher only sees the word "bass" and
        // cannot tell a sub from an upright, so it is not forced into a family.
        ("Bass", _) | ("Note", _) => INSTRUMENT,

        // A vocal take, a scratch and a turntable are all captured performances.
        ("Voice", _) | ("Scratch", _) | ("DJ", _) => PERFORMANCE,

        ("FX", _) => EXPERIMENTAL,
        ("Loops/Patterns", _) => LOOP,

        // Name taxonomy failed — classify by the measured envelope.
        _ => from_envelope(env),
    }
}

/// Role for a file whose name told us nothing.
fn from_envelope(env: &Envelope) -> &'static str {
    match env.shape {
        "Multi" => LOOP,
        "Sustained" | "Swell" => INSTRUMENT,
        "Plucky" => PERCUSSION,
        "Decaying" => {
            // Fast attack, no plateau: the length of the die-off separates a hit
            // from a ringing wash (a reverb-like tail rings well past half a second).
            if env.decay + env.release > 0.5 {
                IMPULSE_RESPONSE
            } else {
                PERCUSSION
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
    fn curated_map() {
        let e = env("Plucky", 0.05, 0.05);
        assert_eq!(music_prod_category("Kick", "", false, &e), PERCUSSION);
        assert_eq!(music_prod_category("Cymbal", "Crash", false, &e), PERCUSSION);
        assert_eq!(music_prod_category("IR", "", false, &e), IMPULSE_RESPONSE);
        assert_eq!(music_prod_category("Guitar", "", false, &e), PLUCKED);
        assert_eq!(music_prod_category("Strings", "", false, &e), STRINGED);
        assert_eq!(music_prod_category("Horn", "", false, &e), BRASS);
        assert_eq!(music_prod_category("Sax", "", false, &e), WOODWIND);
        assert_eq!(music_prod_category("FX", "", false, &e), EXPERIMENTAL);
    }

    #[test]
    fn subgroup_routing_the_old_map_could_not_do() {
        let e = env("Plucky", 0.05, 0.05);
        // A synth is a Keyboards SUBGROUP — the old map made it a plain keyboard.
        assert_eq!(music_prod_category("Keyboards", "Synth", false, &e), SYNTHESIZED);
        assert_eq!(music_prod_category("Keyboards", "Piano", false, &e), KEYED);
        assert_eq!(music_prod_category("Keyboards", "Clav", false, &e), KEYED);
        // Clave is Perc, clavinet is Keyboards — categorize() already separates them.
        assert_eq!(music_prod_category("Perc", "Clave", false, &e), PERCUSSION);
        // Tuned and bell-like percussion no longer collapse into PERCUSSION.
        assert_eq!(music_prod_category("Perc", "Bell", false, &e), BELLS);
        assert_eq!(music_prod_category("Perc", "Cowbell", false, &e), BELLS);
        assert_eq!(music_prod_category("Cymbal", "Gong", false, &e), BELLS);
        assert_eq!(music_prod_category("Perc", "Chime", false, &e), CHIME);
        assert_eq!(music_prod_category("Perc", "Shaker", false, &e), SHAKEN);
        assert_eq!(music_prod_category("Perc", "Kalimba", false, &e), PERCUSSION_TUNED);
        assert_eq!(music_prod_category("Perc", "Triangle", false, &e), PERCUSSION_TUNED);
        // Bass is an instrument; a vocal take is a performance ("Vocal" was a dead
        // arm in the old map — categorize() emits "Voice").
        assert_eq!(music_prod_category("Bass", "", false, &e), INSTRUMENT);
        assert_eq!(music_prod_category("Voice", "", false, &e), PERFORMANCE);
        assert_eq!(music_prod_category("Scratch", "", false, &e), PERFORMANCE);
    }

    #[test]
    fn loop_wins_and_envelope_fallback() {
        let e = env("Plucky", 0.05, 0.05);
        // A loop is a LOOP whatever its name says.
        assert_eq!(music_prod_category("Kick", "", true, &e), LOOP);
        assert_eq!(music_prod_category("Loops/Patterns", "", false, &e), LOOP);
        // Unrecognized name → the measured envelope decides.
        assert_eq!(music_prod_category("Unclassified", "", false, &env("Plucky", 0.05, 0.05)), PERCUSSION);
        assert_eq!(music_prod_category("Unclassified", "", false, &env("Decaying", 1.2, 0.8)), IMPULSE_RESPONSE);
        assert_eq!(music_prod_category("Unclassified", "", false, &env("Decaying", 0.1, 0.1)), PERCUSSION);
        assert_eq!(music_prod_category("Unclassified", "", false, &env("Sustained", 0.1, 0.4)), INSTRUMENT);
        assert_eq!(music_prod_category("Unclassified", "", false, &env("Multi", 0.1, 0.1)), LOOP);
        assert_eq!(music_prod_category("Unclassified", "", false, &env("Silent", 0.0, 0.0)), MISC);
    }
}
