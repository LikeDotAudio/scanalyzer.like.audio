use crate::normalize::normalize_name;

/// Categorize a sample by its (full-path) name, tolerant of the many spelling /
/// abbreviation conventions for drum elements. Phrases are matched as substrings
/// of the normalized name; ABBREVIATIONS are matched as whole tokens (so "bd"
/// hits "BD_01" but not "bird"). Order = most specific first.
/// Returns (group, subgroup, matched-token). `subgroup` is a curated instrument
/// level under a broader group ("Conga" under "Perc", "Synth" under "Keyboards")
/// or "" when the group has no deeper level (then the length tier is used).
pub fn categorize(name: &str) -> (&'static str, &'static str, &'static str) {
    let norm = normalize_name(name);
    let toks: Vec<&str> = norm.split_whitespace().collect();
    let tok = |t: &str| toks.iter().any(|x| *x == t);
    let ph = |p: &str| norm.contains(p);

    // Each rule: (group, subgroup, phrases[], abbrev-tokens[]). The GROUP is the
    // instrument (Kick, Crash, Conga, 808); the SUBGROUP is a curated variation of it
    // (a Snare's Rimshot, a Hi-Hat's Closed, a Tom's pitch). Phrases match as substrings,
    // abbrevs as whole tokens. Order = most specific first. The abbreviations are the
    // shorthand producers put in file names (BD, CHH, XSTK, CRSH, CNG, 808…).
    const RULES: &[(&str, &str, &[&str], &[&str])] = &[
        // --- impulse responses (convolution / cabinet / reverb) — checked early ---
        ("IR", "", &["impulse response", "impulse", "convolution", "convol", "cabinet", "guitar cab", "reverb ir"], &["ir", "cab", "conv"]),

        // === 1. CORE KIT ===
        // Kick before Bass: anything that says "bass drum" in any spelling is a Kick;
        // only a plain "bass" is Bass. 808 is handled separately (Electronic), not here.
        ("Kick", "", &["kick", "kik", "bass drum", "bassdrum", "bassdrm", "bass drm", "bdrum"],
                     &["bd", "kck", "kik", "kic", "kk", "bassd", "bdr"]),
        // Snare and its stick variations. Rimshot and cross-stick are the snare, played
        // differently — not separate instruments.
        ("Snare", "Rimshot", &["rimshot", "rim shot"], &["rim", "rs", "rimsh"]),
        ("Snare", "Cross-stick", &["cross stick", "crossstick", "side stick", "sidestick"], &["xstk", "xs", "xstick"]),
        ("Snare", "", &["snare"], &["sd", "sn", "snr"]),
        // Claps and finger snaps — the human layer over the snare.
        ("Clap", "", &["handclap", "hand clap", "clap"], &["cp", "clp"]),
        ("Snap", "", &["finger snap", "fingersnap", "snap"], &["fngr", "snp"]),
        // Hi-hats, split closed / open / pedal. Abbrev order matters: chh/ohh/phh before
        // the bare ch/oh/ph so a "CHH" is Closed, not ambiguous.
        ("Hi-Hat", "Closed", &["closed hat", "closed hi hat", "closed hihat"], &["chh", "ch"]),
        ("Hi-Hat", "Open", &["open hat", "open hi hat", "open hihat"], &["ohh", "oh"]),
        ("Hi-Hat", "Pedal", &["pedal hat", "foot hat", "pedal hi hat"], &["phh", "ph"]),
        // "hh" and "hat" as substrings too, so an embedded "ClosedHH1" or "808HH" still lands.
        ("Hi-Hat", "", &["hihat", "hi hat", "hats", "hat", "hh"], &[]),
        // Toms are one instrument at different pitches — the pitch is the variation.
        ("Tom", "Hi", &["high tom", "hi tom", "rack tom 1", "tom 1", "hitom"], &["ht", "t1", "hitom"]),
        ("Tom", "Mid", &["mid tom", "middle tom", "rack tom 2", "tom 2", "midtom"], &["mt", "t2", "midtom"]),
        ("Tom", "Floor", &["floor tom", "low tom", "tom 3", "lotom", "floortom"], &["ft", "lt", "t3", "lotom"]),
        ("Tom", "", &["tom"], &["tm"]),

        // === 2. CYMBALS & METALS ===
        // Each cymbal type is its own instrument. Crash before the generic cymbal rule.
        ("Crash", "", &["crash cymbal", "crash"], &["crsh", "cc"]),
        ("Ride Bell", "", &["ride bell", "bell cymbal"], &["rdb"]),
        ("Ride", "", &["ride cymbal", "ride"], &["rd", "rc"]),
        ("Splash", "", &["splash cymbal", "splash"], &["spl"]),
        ("China", "", &["china cymbal", "china"], &["chn"]),
        ("Cymbal", "Gong", &["gong", "tam tam", "tamtam"], &[]),
        // "cym" as a substring too, so an embedded "OHCYM" or "808_CYM" still lands.
        ("Cymbal", "", &["cymbal", "cym", "sizzle", "swish", "zildjian", "sabian", "paiste"], &["cy"]),

        // === 4. WORLD & REGIONAL (before generic Perc so they are not swallowed) ===
        ("Conga", "", &["conga", "tumba", "quinto"], &["cng", "cg", "con"]),
        ("Bongo", "", &["bongo"], &["bng"]),
        ("Timbale", "", &["timbale", "timbales"], &["timb"]),
        ("Djembe", "", &["djembe"], &["djm", "djb"]),
        ("Talking Drum", "", &["talking drum", "talkingdrum"], &[]),
        ("Darbuka", "", &["darbuka", "doumbek", "goblet drum"], &[]),
        ("Taiko", "", &["taiko"], &[]),
        ("Cajon", "", &["cajon"], &[]),
        ("Surdo", "", &["surdo"], &[]),
        ("Tabla", "", &["tabla"], &[]),

        // === 5. ORCHESTRAL & PITCHED ===
        ("Marimba", "", &["marimba"], &[]),
        ("Vibraphone", "", &["vibraphone", "vibes"], &["vib"]),
        ("Xylophone", "", &["xylophone"], &["xyl"]),
        ("Glockenspiel", "", &["glockenspiel", "glock"], &[]),
        ("Timpani", "", &["timpani", "kettledrum", "kettle drum"], &["timp"]),
        ("Steel Pan", "", &["steel pan", "steelpan", "steel drum", "steeldrum"], &[]),
        ("Kalimba", "", &["kalimba", "mbira", "thumb piano"], &[]),

        // === 3. HAND PERCUSSION & SHAKERS ===
        // Cowbell before Bell so "cowbell" never falls through to plain Bell.
        ("Cowbell", "", &["cowbell", "cow bell", "agogo"], &["cb", "cow", "cbell"]),
        ("Shaker", "", &["shaker", "maracas", "maraca", "cabasa", "caxixi", "egg shaker"], &["shkr", "shk", "shak"]),
        ("Tambourine", "", &["tambourine"], &["tamb", "tmb"]),
        ("Woodblock", "", &["woodblock", "wood block", "claves", "clave", "castanet", "block"], &["wb", "clv", "clav"]),
        ("Guiro", "", &["guiro", "scraper", "cuica"], &["gui"]),
        ("Triangle", "", &["triangle"], &[]),
        ("Chime", "", &["wind chime", "chime"], &[]),
        ("Bell", "", &["sleigh bell", "hand bell", "bell"], &[]),
        // Slap bass is a Bass technique — guard it before the Slap percussion rule.
        ("Bass", "", &["slap bass", "bass slap"], &[]),
        ("Perc", "Slap", &["slap"], &[]),
        ("Perc", "", &["percussion", "auxiliary", "perc"], &["prc", "perc"]),

        // === 6. ELECTRONIC & SOUND DESIGN ===
        // 808 is a drum machine / sub-bass hybrid — its own instrument, not Bass.
        ("808", "", &["808"], &["808"]),
        ("Vinyl", "", &["vinyl", "crackle", "atmosphere", "atmos", "record noise"], &["vnl"]),
        ("Scratch", "", &["scratches", "scratch"], &["scr"]),
        ("DJ", "", &["turntable", "deck", "transform scratch"], &["dj"]),
        ("Vocal", "", &["vocal", "voice", "chant", "shout", "adlib", "choir", "acapella", "acappella"], &["vox", "vx", "voc"]),
        ("FX", "Riser", &["riser", "uplifter", "sweep up"], &["ris", "swp"]),
        ("FX", "Impact", &["impact", "boom", "hit fx"], &["imp"]),
        ("FX", "", &["sound effect", "foley", "laser", "noise", "zap", "glitch", "drone",
                     "whoosh", "reverse", "downlifter", "sweep", "sfx", "fx"], &["fx", "sfx"]),

        // === MELODIC (not in the 6 drum families, but the library is full of it) ===
        ("Guitar", "", &["guitar", "gtr", "acoustic gt", "electric gt"], &["gtr", "gt"]),
        ("Strings", "", &["strings", "string", "violin", "viola", "cello", "orchestra", "ensemble", "pizz", "arco"], &[]),
        ("Horn", "", &["horn", "trumpet", "trombone", "tuba", "brass"], &["hrn"]),
        ("Sax", "", &["saxophone", "sax"], &[]),
        ("Bass", "", &["bass", "sub bass", "808 bass"], &["sub"]),
        ("Keyboards", "Electric Piano", &["electric piano", "rhodes", "wurlitzer", "wurli", "e-piano", "epiano"], &["ep"]),
        ("Keyboards", "Organ", &["organ", "hammond"], &["org"]),
        ("Keyboards", "Clav", &["clavinet", "clav"], &[]),
        ("Keyboards", "Piano", &["grand piano", "upright piano", "piano"], &["pno"]),
        ("Keyboards", "Synth", &["synthesizer", "synth"], &["syn"]),
        ("Keyboards", "", &["keyboard", "keys"], &["kb", "keyb"]),
        ("Note", "", &["note"], &[]),

        // Generic "drum" tag, last, so "Synth Drum" and bare "drum" land somewhere.
        ("Perc", "Drum", &["drum"], &["drm"]),
        ("Loops/Patterns", "", &["loop", "groove", "beat"], &["lp"]),
    ];

    for (cat, sub, phrases, abbrevs) in RULES {
        if let Some(p) = phrases.iter().find(|p| ph(p)) {
            return (cat, sub, p);
        }
        if let Some(a) = abbrevs.iter().find(|a| tok(a)) {
            return (cat, sub, a);
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
