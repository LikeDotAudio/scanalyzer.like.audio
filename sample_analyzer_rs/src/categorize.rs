//! The music-production taxonomy, read from UCS/categories/MUSICPROD.json.
//!
//! Like ucs.rs reads the UCS categories, this reads MUSICPROD — but a production role is
//! a FILE-NAME lookup, not an acoustic guess, so the data is synonyms and abbreviations
//! rather than priors and gates. The taxonomy used to be hardcoded here as a RULES table;
//! it now lives in the JSON, the single source of truth the frontend is generated from too.
use std::collections::HashMap;
use std::sync::OnceLock;

use serde::Deserialize;

use crate::normalize::normalize_name;

#[derive(Deserialize)]
struct Variation {
    name: String,
    #[serde(default)]
    phrases: Vec<String>,
    #[serde(default)]
    abbrevs: Vec<String>,
}

#[derive(Deserialize)]
struct Instrument {
    instrument: String,
    family: String,
    #[serde(default)]
    phrases: Vec<String>,
    #[serde(default)]
    abbrevs: Vec<String>,
    #[serde(default)]
    variations: Vec<Variation>,
}

#[derive(Deserialize)]
struct MusicProd {
    instruments: Vec<Instrument>,
}

pub struct Taxonomy {
    doc: MusicProd,
    /// instrument name -> its family. First wins, so a duplicated instrument (the
    /// generic-drum Perc rule appears twice) keeps the family of its first entry.
    family_of: HashMap<String, String>,
}

/// The non-matchable UCS files bundled by build.rs — MUSICPROD is the only one.
const ROLE_BUNDLE: &str = include_str!(concat!(env!("OUT_DIR"), "/ucs_roles.json"));

fn load() -> Taxonomy {
    let arr: Vec<serde_json::Value> = serde_json::from_str(ROLE_BUNDLE)
        .expect("bundled ucs_roles.json is not valid JSON — check build.rs");
    let mp = arr
        .into_iter()
        .find(|v| v.get("category").and_then(|c| c.as_str()) == Some("MUSICPROD"))
        .expect("MUSICPROD.json missing from the role bundle");
    let doc: MusicProd =
        serde_json::from_value(mp).expect("MUSICPROD.json does not match the taxonomy schema");

    let mut family_of = HashMap::new();
    for inst in &doc.instruments {
        family_of
            .entry(inst.instrument.clone())
            .or_insert_with(|| inst.family.clone());
    }
    Taxonomy { doc, family_of }
}

pub fn taxonomy() -> &'static Taxonomy {
    static T: OnceLock<Taxonomy> = OnceLock::new();
    T.get_or_init(load)
}

/// The family an instrument belongs to, or None if the name is unknown (the caller
/// falls back to the measured envelope). References into the 'static taxonomy.
pub fn family_of(group: &str) -> Option<&'static str> {
    taxonomy().family_of.get(group).map(String::as_str)
}

/// Categorize a sample by its (full-path) name, tolerant of the many spelling /
/// abbreviation conventions for drum elements. Phrases match as substrings of the
/// normalized name; ABBREVIATIONS match as whole tokens (so "bd" hits "BD_01" but not
/// "bird"). Instruments are tried in file order (most specific first); a variation is
/// tried before its instrument's base.
///
/// Returns (instrument, variation, matched-token), all borrowed from the 'static
/// taxonomy. `variation` is "" when only the base matched.
pub fn categorize(name: &str) -> (&'static str, &'static str, &'static str) {
    let t = taxonomy();
    let norm = normalize_name(name);
    let toks: Vec<&str> = norm.split_whitespace().collect();
    let tok = |s: &str| toks.iter().any(|x| *x == s);
    let ph = |p: &str| norm.contains(p);

    let hit = |phrases: &'static [String], abbrevs: &'static [String]| -> Option<&'static str> {
        if let Some(p) = phrases.iter().find(|p| ph(p)) {
            return Some(p.as_str());
        }
        if let Some(a) = abbrevs.iter().find(|a| tok(a)) {
            return Some(a.as_str());
        }
        None
    };

    for inst in &t.doc.instruments {
        for v in &inst.variations {
            if let Some(why) = hit(&v.phrases, &v.abbrevs) {
                return (inst.instrument.as_str(), v.name.as_str(), why);
            }
        }
        if let Some(why) = hit(&inst.phrases, &inst.abbrevs) {
            return (inst.instrument.as_str(), "", why);
        }
    }
    ("Unclassified", "", "")
}

#[cfg(test)]
mod tests {
    use super::categorize;

    #[test]
    fn naming_conventions() {
        // (name, want_group, want_subgroup) — the producer's drum-sampler taxonomy.
        let cases: &[(&str, &str, &str)] = &[
            // === 1. Core kit ===
            ("Kick_01.wav", "Kick", ""), ("BD_808.wav", "Kick", ""), ("Bass Drum 3.wav", "Kick", ""),
            ("Kk-tight.wav", "Kick", ""), ("BassDrum.wav", "Kick", ""), ("BDrum_7.wav", "Kick", ""),
            ("BassD_2.wav", "Kick", ""), ("BDR_4.wav", "Kick", ""),
            ("Snare_Acoustic.wav", "Snare", ""), ("SD_04.wav", "Snare", ""), ("Snr_dry.wav", "Snare", ""),
            ("Rimshot.wav", "Snare", "Rimshot"), ("RS_dry.wav", "Snare", "Rimshot"),
            ("Cross-stick.wav", "Snare", "Cross-stick"), ("XSTK_01.wav", "Snare", "Cross-stick"),
            ("Clap_big.wav", "Clap", ""), ("Handclap.wav", "Clap", ""), ("CP_room.wav", "Clap", ""),
            ("Snap_01.wav", "Snap", ""), ("Finger Snap.wav", "Snap", ""),
            ("CHH_tight.wav", "Hi-Hat", "Closed"), ("OHH_01.wav", "Hi-Hat", "Open"),
            ("Pedal Hat.wav", "Hi-Hat", "Pedal"), ("HH_01.wav", "Hi-Hat", ""),
            ("ClosedHH1.wav", "Hi-Hat", ""), ("808HH.wav", "Hi-Hat", ""),
            ("High Tom.wav", "Tom", "Hi"), ("HT_rack.wav", "Tom", "Hi"), ("Tom1.wav", "Tom", "Hi"),
            ("Mid Tom.wav", "Tom", "Mid"), ("Tom2.wav", "Tom", "Mid"),
            ("Floor Tom.wav", "Tom", "Floor"), ("FT_low.wav", "Tom", "Floor"), ("Tom3.wav", "Tom", "Floor"),
            ("Tom_generic.wav", "Tom", ""),
            // === 2. Cymbals & metals — each its own instrument ===
            ("Crash_01.wav", "Crash", ""), ("CRSH.wav", "Crash", ""), ("CC_loud.wav", "Crash", ""),
            ("Ride_01.wav", "Ride", ""), ("RD_ping.wav", "Ride", ""), ("RC_jazz.wav", "Ride", ""),
            ("Ride Bell.wav", "Ride Bell", ""), ("RDB.wav", "Ride Bell", ""),
            ("Splash.wav", "Splash", ""), ("SPL_fast.wav", "Splash", ""),
            ("China.wav", "China", ""), ("CHN_trash.wav", "China", ""),
            ("Gong_low.wav", "Cymbal", "Gong"), ("OHCYM.wav", "Cymbal", ""), ("Zildjian_18.wav", "Cymbal", ""),
            // === 3. Hand percussion & shakers ===
            ("Cowbell.wav", "Cowbell", ""), ("CB_hi.wav", "Cowbell", ""), ("Cow_1.wav", "Cowbell", ""),
            ("Shaker.wav", "Shaker", ""), ("Maracas.wav", "Shaker", ""), ("SHKR_loop.wav", "Shaker", ""),
            ("Tambourine.wav", "Tambourine", ""), ("TAMB.wav", "Tambourine", ""),
            ("Woodblock.wav", "Woodblock", ""), ("Claves.wav", "Woodblock", ""), ("Castanet.wav", "Woodblock", ""),
            ("Guiro.wav", "Guiro", ""), ("Scraper.wav", "Guiro", ""),
            ("Triangle_open.wav", "Triangle", ""),
            ("Perc_shot.wav", "Perc", ""), ("PRC_02.wav", "Perc", ""),
            // === 4. World & regional ===
            ("Conga_open.wav", "Conga", ""), ("CNG_hi.wav", "Conga", ""), ("Tumba.wav", "Conga", ""),
            ("Bongo_hi.wav", "Bongo", ""), ("BNG.wav", "Bongo", ""),
            ("Timbale.wav", "Timbale", ""), ("Djembe.wav", "Djembe", ""), ("DJM_slap.wav", "Djembe", ""),
            ("Talking Drum.wav", "Talking Drum", ""), ("Darbuka.wav", "Darbuka", ""),
            ("Taiko_hit.wav", "Taiko", ""), ("Cajon.wav", "Cajon", ""), ("Surdo.wav", "Surdo", ""),
            ("Tabla_na.wav", "Tabla", ""),
            // === 5. Orchestral & pitched ===
            ("Marimba_A.wav", "Marimba", ""), ("Vibraphone.wav", "Vibraphone", ""),
            ("Xylophone.wav", "Xylophone", ""), ("Glockenspiel.wav", "Glockenspiel", ""),
            ("Timpani_roll.wav", "Timpani", ""), ("Steel Pan.wav", "Steel Pan", ""),
            ("Kalimba_A.wav", "Kalimba", ""), ("Mbira.wav", "Kalimba", ""),
            // === 6. Electronic & sound design ===
            ("808.wav", "808", ""), ("808_sub.wav", "808", ""),
            ("Vinyl_crackle.wav", "Vinyl", ""), ("Crackle.wav", "Vinyl", ""),
            ("Scratch_01.wav", "Scratch", ""), ("Turntable_stop.wav", "DJ", ""),
            ("Vox_chop.wav", "Vocal", ""), ("Chant.wav", "Vocal", ""),
            ("FX_riser.wav", "FX", "Riser"), ("Impact_hit.wav", "FX", "Impact"), ("Laser_zap.wav", "FX", ""),
            // === Melodic (not a drum family, but the library is full of it) ===
            ("Guitar_riff.wav", "Guitar", ""), ("Strings_A.wav", "Strings", ""), ("Violin.wav", "Strings", ""),
            ("Horn_stab.wav", "Horn", ""), ("Trumpet.wav", "Horn", ""), ("Saxophone_A2.wav", "Sax", ""),
            ("Bassline_A.wav", "Bass", ""), ("Slap Bass G.wav", "Bass", ""),
            ("SynthLead.wav", "Keyboards", "Synth"), ("Grand Piano C3.wav", "Keyboards", "Piano"),
            ("Rhodes_ep.wav", "Keyboards", "Electric Piano"), ("Hammond_organ.wav", "Keyboards", "Organ"),
            ("Piano Note C3.wav", "Keyboards", "Piano"), ("Note_C3.wav", "Note", ""),
            // === IR + loops + fallthrough ===
            ("Hall_IR.wav", "IR", ""), ("guitar_cab.wav", "IR", ""), ("Convolution 01.wav", "IR", ""),
            ("Loop_120.wav", "Loops/Patterns", ""), ("Groove.wav", "Loops/Patterns", ""),
            ("randomthing.wav", "Unclassified", ""),
        ];
        for (name, want_g, want_sg) in cases {
            let (got, sub, why) = categorize(name);
            assert_eq!(got, *want_g, "categorize({:?}) group = {:?} (why {:?}), want {:?}", name, got, why, want_g);
            assert_eq!(sub, *want_sg, "categorize({:?}) subgroup = {:?}, want {:?}", name, sub, want_sg);
        }
    }
}
