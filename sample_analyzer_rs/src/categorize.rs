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

    // "cym" anywhere ⇒ definitely a cymbal (highest priority); a "crash" or
    // "gong" alongside it still picks the curated subgroup.
    if norm.contains("cym") {
        let sub = if norm.contains("crash") {
            "Crash"
        } else if norm.contains("gong") {
            "Gong"
        } else {
            ""
        };
        return ("Cymbal", sub, "cym");
    }

    // "hh" or "hat" anywhere ⇒ strongly a hi-hat ("ClosedHH1", "808HH",
    // "OpenHat", …).
    if norm.contains("hh") {
        return ("Hi-Hat", "", "hh");
    }
    if norm.contains("hat") {
        return ("Hi-Hat", "", "hat");
    }

    // "sfx" anywhere ⇒ strongly a sound effect.
    if norm.contains("sfx") {
        return ("FX", "", "sfx");
    }

    // Each rule: (group, subgroup, phrases[], abbrev-tokens[]). subgroup "" ⇒
    // no curated instrument level (the length tier fills the subgroup instead).
    // Order = most specific first.
    const RULES: &[(&str, &str, &[&str], &[&str])] = &[
        // Impulse responses (convolution / cabinet / reverb IRs) — checked early.
        ("IR", "", &["impulse response", "impulse", "convolution", "convol", "cabinet", "guitar cab", "reverb ir"], &["ir", "cab", "conv"]),
        // Kick before Bass: ANYTHING that says "bass drum" (in any spelling —
        // BassDrum, Bass_Drm, BDrum, …) is a Kick; only a plain "bass" is Bass.
        ("Kick", "", &["kick", "kik", "bass drum", "bassdrum", "bassdrm", "bass drm", "bdrum"],
                     &["bd", "kk", "kik", "kic", "kck", "bassd", "bdr"]),
        ("Snare", "", &["snare"], &["sd", "sn", "snr"]),
        // Hi-hat variants (closed/open/pedal).
        ("Hi-Hat", "", &["hihat", "hi hat", "closed hat", "open hat", "pedal hat", "hats", "hat"], &["hh", "chh", "ohh", "ch", "oh", "ph"]),
        ("Ride", "", &["ride bell", "ride cymbal", "ride"], &["rd", "rdcym"]),
        // Cymbals: crashes and gongs are curated subgroups; the rest stay plain.
        // China/sizzle/swish and the big cymbal brands count too, so those
        // packs don't fall through to Unclassified.
        ("Cymbal", "Crash", &["crash cymbal", "crash"], &["crsh"]),
        ("Cymbal", "Gong", &["gong", "tam tam", "tamtam"], &[]),
        ("Cymbal", "", &["splash cymbal", "cymbal", "splash", "china", "sizzle", "swish",
                         "zildjian", "sabian", "paiste"], &["cy", "cym"]),
        ("Clap", "", &["handclap", "hand clap", "clap"], &["cp", "clp"]),
        ("Rim", "", &["rimshot", "rim shot", "cross stick", "crossstick", "rim"], &["rs", "rm"]),
        // Toms are ONE instrument at different pitches — one group, with the
        // pitch position (Hi / Mid / Lo) as the curated subgroup.
        ("Tom", "Hi", &["high tom", "hi tom", "rack tom 1", "tom 1", "hitom"], &["ht", "hitom"]),
        ("Tom", "Mid", &["mid tom", "middle tom", "rack tom 2", "tom 2", "midtom"], &["mt", "midtom"]),
        ("Tom", "Lo", &["low tom", "floor tom", "tom 3", "lotom"], &["lt", "ft", "lotom"]),
        ("Tom", "Disco", &["disco tom", "discotom", "disco"], &[]),
        ("Tom", "", &["tom"], &["tm"]),
        // Auxiliary percussion — all under "Perc" with a curated subgroup.
        // Cowbell before Bell so "cowbell" never falls through to plain Bell.
        ("Perc", "Cowbell", &["cowbell", "cow bell", "cow"], &["cb", "cow", "cowb"]),
        ("Perc", "Conga", &["conga", "tumba", "quinto"], &["cg", "con", "cng"]),
        ("Perc", "Bongo", &["bongo"], &["bng"]),
        ("Perc", "Clave", &["claves", "clave"], &["cv", "clv"]),
        ("Perc", "Shaker", &["shaker", "maracas", "cabasa"], &["shk", "sh"]),
        ("Perc", "Block", &["woodblock", "wood block", "block"], &["wb"]),
        ("Perc", "Bell", &["bell"], &[]),
        ("Perc", "Chime", &["chime"], &[]),
        ("Perc", "Kalimba", &["kalimba", "mbira", "thumb piano"], &[]),
        ("Perc", "Taiko", &["taiko"], &[]),
        ("Perc", "Tabla", &["tabla"], &[]),
        ("Perc", "Triangle", &["triangle"], &[]),
        // Slap bass is a Bass technique — guard it before the Slap percussion rule.
        ("Bass", "", &["slap bass", "bass slap"], &[]),
        ("Perc", "Slap", &["slap"], &[]),
        ("Perc", "", &["percussion", "auxiliary", "perc"], &["prc"]),
        ("Guitar", "", &["guitar", "gtr", "acoustic gt", "electric gt"], &["gtr", "gt"]),
        ("Strings", "", &["strings", "string", "violin", "viola", "cello", "orchestra", "ensemble", "pizz", "arco"], &[]),
        // Horns and saxes — Tonal wind groups.
        ("Horn", "", &["horn"], &["hrn"]),
        ("Sax", "", &["saxophone", "sax"], &[]),
        // 808 is a drum machine, NOT bass — so it is intentionally not a Bass keyword.
        ("Bass", "", &["bass", "sub bass"], &["sub"]),
        ("Vocal", "", &["vocal", "voice", "vox"], &["vx"]),
        // Generic "drum" tag catches things before they fall through to Keyboards (e.g. "Synth Drum")
        ("Perc", "Drum", &["drum"], &["drm"]),
        // Keyboards — new group with curated subgroups (Electric Piano before
        // Piano so "epiano" doesn't fall through to plain Piano).
        ("Keyboards", "Electric Piano", &["electric piano", "rhodes", "wurlitzer", "wurli", "e-piano", "epiano"], &["ep"]),
        ("Keyboards", "Organ", &["organ", "hammond"], &["org"]),
        ("Keyboards", "Clav", &["clavinet", "clav"], &[]),
        ("Keyboards", "Piano", &["grand piano", "upright piano", "piano"], &["pno"]),
        ("Keyboards", "Synth", &["synthesizer", "synth"], &["syn"]),
        ("Keyboards", "", &["keyboard", "keys"], &["kb", "keyb"]),
        // Generic single tonal notes — after every named instrument, so
        // "Piano Note C3" stays a Piano.
        ("Note", "", &["note"], &[]),
        // Turntablism: scratches are their own group; DJ = turntable / decks.
        ("Scratch", "", &["scratches", "scratch"], &["scr"]),
        ("DJ", "", &["turntable", "deck"], &["dj"]),
        ("FX", "", &["sound effect", "foley", "atmosphere", "atmos", "riser", "sweep", "laser", "noise",
                 "impact", "boom", "zap", "glitch", "drone", "whoosh", "reverse", "downlifter",
                 "uplifter", "riser", "sfx", "fx"], &["fx", "sfx"]),
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
        // (name, want_group, want_subgroup)
        let cases: &[(&str, &str, &str)] = &[
            ("Kick_01.wav", "Kick", ""), ("BD_808.wav", "Kick", ""), ("Bass Drum 3.wav", "Kick", ""),
            ("Kk-tight.wav", "Kick", ""), ("Kik_punchy.wav", "Kick", ""),
            // Every "bass drum" spelling is a Kick — never a Bass.
            ("BassDrum.wav", "Kick", ""), ("BASSDRUM2.wav", "Kick", ""), ("Bass-Drum.wav", "Kick", ""),
            ("Bassdrums_08.wav", "Kick", ""), ("BassDrm_03.wav", "Kick", ""), ("Bass Drm 1.wav", "Kick", ""),
            ("BDrum_7.wav", "Kick", ""), ("BassD_2.wav", "Kick", ""), ("BDR_4.wav", "Kick", ""),
            // …but a plain "bass" stays Bass.
            ("Bass_808.wav", "Bass", ""), ("Bassline_A.wav", "Bass", ""),
            ("Snare_Acoustic.wav", "Snare", ""), ("SD_04.wav", "Snare", ""), ("Snr_rimmy.wav", "Snare", ""),
            ("HiHat_closed.wav", "Hi-Hat", ""), ("HH_01.wav", "Hi-Hat", ""), ("OH_open.wav", "Hi-Hat", ""),
            ("CH_tight.wav", "Hi-Hat", ""), ("Pedal Hat.wav", "Hi-Hat", ""), ("808_HH.wav", "Hi-Hat", ""),
            ("Perc_shot.wav", "Perc", ""), ("PRC_02.wav", "Perc", ""),
            ("Clap_big.wav", "Clap", ""), ("CP_room.wav", "Clap", ""), ("Handclap.wav", "Clap", ""),
            ("Rimshot.wav", "Rim", ""), ("RS_dry.wav", "Rim", ""), ("Cross-stick.wav", "Rim", ""),
            // Toms: one group, pitch position as the subgroup.
            ("Low Tom.wav", "Tom", "Lo"), ("FT_floor.wav", "Tom", "Lo"), ("Tom3.wav", "Tom", "Lo"),
            ("Mid Tom.wav", "Tom", "Mid"), ("Tom2.wav", "Tom", "Mid"),
            ("High Tom.wav", "Tom", "Hi"), ("HT_rack.wav", "Tom", "Hi"), ("Tom1.wav", "Tom", "Hi"),
            ("Tom_generic.wav", "Tom", ""),
            // Cymbals: crashes and gongs get their own curated subgroup.
            ("Crash Cymbal.wav", "Cymbal", "Crash"), ("Crash_01.wav", "Cymbal", "Crash"), ("Crsh.wav", "Cymbal", "Crash"),
            ("Gong_low.wav", "Cymbal", "Gong"), ("TamTam.wav", "Cymbal", "Gong"), ("Gong Cymbal.wav", "Cymbal", "Gong"),
            ("CY_splash.wav", "Cymbal", ""),
            ("OHCYM.wav", "Cymbal", ""), ("808_CYM.wav", "Cymbal", ""), ("Tom_cym_hit.wav", "Cymbal", ""),
            // "hh" anywhere is strongly a hi-hat, even embedded.
            ("ClosedHH1.wav", "Hi-Hat", ""), ("808HH.wav", "Hi-Hat", ""),
            ("Hats_02.wav", "Hi-Hat", ""),
            // "sfx" anywhere is strongly a sound effect.
            ("Snare_SFX.wav", "FX", ""), ("GameSFX7.wav", "FX", ""),
            ("Laser_zap.wav", "FX", ""),
            ("China.wav", "Cymbal", ""), ("Zildjian_18.wav", "Cymbal", ""), ("Sizzle.wav", "Cymbal", ""),
            ("Hall_IR.wav", "IR", ""), ("guitar_cab.wav", "IR", ""), ("Impulse_room.wav", "IR", ""),
            ("Convolution 01.wav", "IR", ""),
            ("Ride Bell.wav", "Ride", ""), ("RD_ping.wav", "Ride", ""),
            // Auxiliary percussion — now Perc with a curated subgroup.
            ("Cowbell.wav", "Perc", "Cowbell"), ("CB_hi.wav", "Perc", "Cowbell"),
            ("Conga_open.wav", "Perc", "Conga"), ("Tumba.wav", "Perc", "Conga"), ("Quinto.wav", "Perc", "Conga"),
            ("Bongo_hi.wav", "Perc", "Bongo"),
            ("Claves.wav", "Perc", "Clave"), ("CV_01.wav", "Perc", "Clave"),
            ("Shaker.wav", "Perc", "Shaker"), ("Maracas.wav", "Perc", "Shaker"), ("Cabasa.wav", "Perc", "Shaker"),
            ("Woodblock.wav", "Perc", "Block"), ("Wood Block 2.wav", "Perc", "Block"),
            ("Cow_1.wav", "Perc", "Cowbell"),
            ("Bell_C4.wav", "Perc", "Bell"), ("Sleigh Bells.wav", "Perc", "Bell"),
            ("Chimes.wav", "Perc", "Chime"), ("Wind Chime.wav", "Perc", "Chime"),
            ("Kalimba_A.wav", "Perc", "Kalimba"), ("Mbira.wav", "Perc", "Kalimba"), ("Thumb Piano.wav", "Perc", "Kalimba"),
            ("Taiko_hit.wav", "Perc", "Taiko"),
            ("Tabla_na.wav", "Perc", "Tabla"),
            ("Triangle_open.wav", "Perc", "Triangle"),
            ("Slap_01.wav", "Perc", "Slap"),
            // …but slap bass is a Bass technique, not percussion.
            ("Slap Bass G.wav", "Bass", ""),
            // Disco toms are toms.
            ("Disco Tom.wav", "Tom", "Disco"), ("Disco_hi.wav", "Tom", "Disco"),
            // Ride bells stay Rides; cowbells stay Cowbells — never plain Bell.
            ("Horn_stab.wav", "Horn", ""), ("French Horn.wav", "Horn", ""),
            ("Sax_riff.wav", "Sax", ""), ("Saxophone_A2.wav", "Sax", ""),
            ("Note_C3.wav", "Note", ""),
            // A named instrument's note stays with the instrument.
            ("Piano Note C3.wav", "Keyboards", "Piano"),
            ("FX_riser.wav", "FX", ""), ("SFX_boom.wav", "FX", ""), ("Foley_door.wav", "FX", ""),
            ("Sub_808.wav", "Bass", ""), ("Bassline.wav", "Bass", ""),
            ("Vox_chop.wav", "Vocal", ""), ("Vocal_ah.wav", "Vocal", ""),
            // Keyboards — new group with curated subgroups.
            ("SynthLead.wav", "Keyboards", "Synth"), ("Analog Synth.wav", "Keyboards", "Synth"),
            ("Grand Piano C3.wav", "Keyboards", "Piano"), ("Rhodes_ep.wav", "Keyboards", "Electric Piano"),
            ("Hammond_organ.wav", "Keyboards", "Organ"), ("Clavinet.wav", "Keyboards", "Clav"),
            ("Keyboard_pad.wav", "Keyboards", ""),
            // Turntablism (Scratch is its own group) + DJ + Loops/Patterns.
            ("Scratch_01.wav", "Scratch", ""), ("Vinyl_scratches.wav", "Scratch", ""),
            ("DJ_scratch.wav", "Scratch", ""), ("Turntable_stop.wav", "DJ", ""), ("DJ_fx.wav", "DJ", ""),
            ("Beat_01.wav", "Loops/Patterns", ""), ("Groove.wav", "Loops/Patterns", ""), ("Loop_120.wav", "Loops/Patterns", ""),
            ("Synth Drum.wav", "Perc", "Drum"), ("Synthesized Drums.wav", "Perc", "Drum"),
            ("randomthing.wav", "Unclassified", ""),
        ];
        for (name, want_g, want_sg) in cases {
            let (got, sub, why) = categorize(name);
            assert_eq!(got, *want_g, "categorize({:?}) group = {:?} (why {:?}), want {:?}", name, got, why, want_g);
            assert_eq!(sub, *want_sg, "categorize({:?}) subgroup = {:?}, want {:?}", name, sub, want_sg);
        }
    }
}
