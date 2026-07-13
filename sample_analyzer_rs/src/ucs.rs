use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UcsCategory {
    pub category: String,
    pub subcategory: String,
    pub cat_id: String,
    pub cat_short: String,
    pub explanation: String,
    pub synonyms: Vec<String>,
}

/// Returns the complete official list of English UCS categories (v8.2.1)
pub fn get_all_ucs_categories() -> Vec<UcsCategory> {
    let json_data = include_str!("ucs_categories.json");
    serde_json::from_str(json_data).unwrap_or_else(|_| Vec::new())
}

pub fn map_to_ucs(god: &str, group: &str, subgroup: &str, family: &[String], is_loop: bool) -> (String, String, String) {
    let cat = "MUSICAL";
    let has = |t: &str| family.iter().any(|x| x == t);

    let (sub, id) = if is_loop {
        ("LOOP", "MUSCLoop")
    } else if god == "Vocal" {
        if group == "Choir" || has("Choir") || has("Voice") {
            ("CHORAL", "MUSCChor")
        } else {
            ("SONG & PHRASE", "MUSCSong")
        }
    } else if has("Brass") {
        ("BRASS", "MUSCBrass")
    } else if has("Woodwind") {
        ("WOODWIND", "MUSCWind")
    } else if has("String") || has("Chordophone") {
        if group == "Guitar" || group == "Bass" || group == "Harp" || has("Plucked Chordophone") {
            ("PLUCKED", "MUSCPluck")
        } else {
            ("STRINGED", "MUSCStr")
        }
    } else if has("Keyboard") {
        ("KEYED", "MUSCKeyd")
    } else if has("Electrophone") {
        ("SYNTHESIZED", "MUSCSynth")
    } else if has("Percussion") || has("Membranophone") || has("Idiophone") {
        if group == "Bell" || subgroup == "Bell" {
            ("BELLS", "MUSCBell")
        } else if group == "Chime" || subgroup == "Chime" || subgroup == "Triangle" {
            ("CHIME", "MUSCChim")
        } else if group == "Shaker" || group == "Tambourine" || subgroup == "Shaker" || has("Shaken Idiophone") {
            ("SHAKEN", "MUSCShake")
        } else if subgroup == "Mallet" || subgroup == "Marimba" || subgroup == "Xylophone" || has("Plucked Idiophone") {
            ("PERCUSSION TUNED", "MUSCTnprc")
        } else {
            ("PERCUSSION", "MUSCPerc")
        }
    } else {
        // Fallbacks if family is empty or unknown
        match group {
            "Kick" | "Snare" | "Tom" | "Hi-Hat" | "Cymbal" | "Ride" | "Clap" | "Rim" | "Perc" => ("PERCUSSION", "MUSCPerc"),
            "Bass" => {
                if subgroup == "Synth" {
                    ("SYNTHESIZED", "MUSCSynth")
                } else {
                    ("PLUCKED", "MUSCPluck")
                }
            },
            "Guitar" => ("PLUCKED", "MUSCPluck"),
            "Keyboards" => ("KEYED", "MUSCKeyd"),
            "Synth" => ("SYNTHESIZED", "MUSCSynth"),
            "FX" => ("EXPERIMENTAL", "MUSCExpr"),
            _ => {
                if god == "Percussive" {
                    ("PERCUSSION", "MUSCPerc")
                } else if god == "Tonal" {
                    ("SAMPLE", "MUSCSmpl")
                } else {
                    ("MISC", "MUSCMisc")
                }
            }
        }
    };

    (cat.to_string(), sub.to_string(), id.to_string())
}
