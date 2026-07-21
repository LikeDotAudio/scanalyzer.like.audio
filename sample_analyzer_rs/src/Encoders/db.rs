use crate::peak::Peak;
use mysql::prelude::*;
use mysql::*;

pub fn get_pool(db_url: &str) -> Result<Pool> {
    let opts = Opts::from_url(db_url)?;
    Pool::new(opts)
}

pub fn init_db(pool: &Pool) -> Result<()> {
    let mut conn = pool.get_conn()?;
    conn.query_drop("CREATE TABLE IF NOT EXISTS audio_files (id INT AUTO_INCREMENT PRIMARY KEY, filename VARCHAR(255) NOT NULL, folder_path VARCHAR(1024) NOT NULL, analyzer_version VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY (filename, folder_path(255))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;")?;
    conn.query_drop("CREATE TABLE IF NOT EXISTS metadata (file_id INT PRIMARY KEY, length_seconds FLOAT, sample_rate INT, bit_depth INT, channels INT, source_format VARCHAR(50), lossy_source BOOLEAN, dc_offset FLOAT, FOREIGN KEY (file_id) REFERENCES audio_files(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;")?;
    conn.query_drop("CREATE TABLE IF NOT EXISTS classification (file_id INT PRIMARY KEY, ucs_category VARCHAR(100), ucs_subcategory VARCHAR(100), group_name VARCHAR(100), subgroup VARCHAR(100), timbre VARCHAR(100), acoustic_types VARCHAR(255), instrument_family VARCHAR(255), reason TEXT, alt_1_group VARCHAR(100), alt_1_sub VARCHAR(100), alt_2_group VARCHAR(100), alt_2_sub VARCHAR(100), alt_3_group VARCHAR(100), alt_3_sub VARCHAR(100), FOREIGN KEY (file_id) REFERENCES audio_files(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;")?;
    conn.query_drop("CREATE TABLE IF NOT EXISTS spectral_features (file_id INT PRIMARY KEY, root_mean_square_level FLOAT, crest_factor FLOAT, complexity FLOAT, spectral_centroid_hz FLOAT, spectral_rolloff_hz FLOAT, spectral_flatness FLOAT, harmonicity FLOAT, total_harmonic_distortion FLOAT, clipping_density FLOAT, FOREIGN KEY (file_id) REFERENCES audio_files(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;")?;
    conn.query_drop("CREATE TABLE IF NOT EXISTS musicality (file_id INT PRIMARY KEY, pitch_hz FLOAT, root_note_name VARCHAR(10), root_midi_note INT, root_cents_offset FLOAT, beats_per_minute FLOAT, FOREIGN KEY (file_id) REFERENCES audio_files(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;")?;
    conn.query_drop("CREATE TABLE IF NOT EXISTS envelope (file_id INT PRIMARY KEY, transient_count INT, attack_seconds FLOAT, decay_seconds FLOAT, sustain_level FLOAT, release_seconds FLOAT, temporal_centroid FLOAT, shape VARCHAR(50), FOREIGN KEY (file_id) REFERENCES audio_files(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;")?;
    Ok(())
}

pub fn write_peaks(pool: &Pool, peaks: &[Peak]) -> Result<()> {
    let mut conn = pool.get_conn()?;
    
    let mut tx = conn.start_transaction(TxOpts::default())?;

    for p in peaks {
        let filename = std::path::Path::new(&p.metadata.name)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();

        // 1. audio_files
        tx.exec_drop(
            "INSERT INTO audio_files (filename, folder_path, analyzer_version) VALUES (:f, :dir, :ver) ON DUPLICATE KEY UPDATE analyzer_version = VALUES(analyzer_version)",
            params! { "f" => &filename, "dir" => &p.metadata.folder, "ver" => &p.metadata.analyzer_version }
        )?;
        
        let file_id: i32 = tx.query_first(format!("SELECT id FROM audio_files WHERE filename = '{}' AND folder_path = '{}'", filename.replace("'", "''"), p.metadata.folder.replace("'", "''")))?.unwrap_or(0);
        if file_id == 0 { continue; }

        // 2. metadata
        tx.exec_drop(
            "REPLACE INTO metadata (file_id, length_seconds, sample_rate, bit_depth, channels, source_format, lossy_source, dc_offset) VALUES (:id, :len, :sr, :bd, :ch, :sf, :ls, :dc)",
            params! { "id" => file_id, "len" => p.metadata.length_seconds, "sr" => p.metadata.sample_rate, "bd" => p.metadata.bit_depth, "ch" => p.metadata.channels, "sf" => &p.metadata.source_format, "ls" => p.metadata.lossy_source, "dc" => p.metadata.dc_offset }
        )?;

        // 3. classification
        let reason = p.classification.reason.first().cloned();
        let alt1 = p.ucs.alternatives.get(0);
        let alt2 = p.ucs.alternatives.get(1);
        let alt3 = p.ucs.alternatives.get(2);
        
        tx.exec_drop(
            "REPLACE INTO classification (file_id, ucs_category, ucs_subcategory, group_name, subgroup, timbre, acoustic_types, instrument_family, reason, alt_1_group, alt_1_sub, alt_2_group, alt_2_sub, alt_3_group, alt_3_sub) VALUES (:id, :cat, :subcat, :grp, :subgrp, :tmb, :ac, :inst, :rsn, :a1g, :a1s, :a2g, :a2s, :a3g, :a3s)",
            params! { 
                "id" => file_id, "cat" => &p.ucs.category, "subcat" => &p.ucs.subcategory, "grp" => &p.classification.group, "subgrp" => &p.classification.subgroup, "tmb" => &p.classification.timbre, "ac" => p.classification.acoustic_types.join(","), "inst" => p.classification.instrument_family.join(","), "rsn" => reason,
                "a1g" => alt1.map(|a| &a.category), "a1s" => alt1.map(|a| &a.subcategory),
                "a2g" => alt2.map(|a| &a.category), "a2s" => alt2.map(|a| &a.subcategory),
                "a3g" => alt3.map(|a| &a.category), "a3s" => alt3.map(|a| &a.subcategory)
            }
        )?;

        // 4. spectral_features
        tx.exec_drop(
            "REPLACE INTO spectral_features (file_id, root_mean_square_level, crest_factor, complexity, spectral_centroid_hz, spectral_rolloff_hz, spectral_flatness, harmonicity, total_harmonic_distortion, clipping_density) VALUES (:id, :rms, :cf, :cx, :sc, :sr, :sf, :hm, :thd, :cd)",
            params! { "id" => file_id, "rms" => p.spectral_features.root_mean_square_level, "cf" => p.spectral_features.crest_factor, "cx" => p.spectral_features.complexity, "sc" => p.spectral_features.spectral_centroid_hz, "sr" => p.spectral_features.spectral_rolloff_hz, "sf" => p.spectral_features.spectral_flatness, "hm" => p.spectral_features.harmonicity, "thd" => p.spectral_features.total_harmonic_distortion, "cd" => p.spectral_features.clipping_density }
        )?;

        // 5. musicality
        tx.exec_drop(
            "REPLACE INTO musicality (file_id, pitch_hz, root_note_name, root_midi_note, root_cents_offset, beats_per_minute) VALUES (:id, :ph, :rnn, :rmn, :rco, :bpm)",
            params! { "id" => file_id, "ph" => p.musicality.pitch_hz, "rnn" => &p.musicality.root_note_name, "rmn" => p.musicality.root_midi_note, "rco" => p.musicality.root_cents_offset, "bpm" => p.musicality.beats_per_minute }
        )?;

        // 6. envelope
        tx.exec_drop(
            "REPLACE INTO envelope (file_id, transient_count, attack_seconds, decay_seconds, sustain_level, release_seconds, temporal_centroid, shape) VALUES (:id, :tc, :as, :ds, :sl, :rs, :tcen, :sh)",
            params! { "id" => file_id, "tc" => p.envelope.transient_count, "as" => p.envelope.envelope_attack_seconds, "ds" => p.envelope.envelope_decay_seconds, "sl" => p.envelope.envelope_sustain_level, "rs" => p.envelope.envelope_release_seconds, "tcen" => p.envelope.envelope_temporal_centroid, "sh" => &p.envelope.envelope_shape }
        )?;
    }
    tx.commit()?;
    
    Ok(())
}
