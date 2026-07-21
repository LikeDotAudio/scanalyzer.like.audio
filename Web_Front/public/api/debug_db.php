<?php
$host = 'scanalyzer.like.audio';
$db   = 'tandapho_scanalyzer';
$user = 'tandapho_scanalyzer';
$pass = 'GITHUB_SECRET_DB_PASSWORD';
$charset = 'utf8mb4';

$dsn = "mysql:host=$host;dbname=$db;charset=$charset";
$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
];

try {
    $pdo = new PDO($dsn, $user, $pass, $options);
    
    // Check table sizes
    $stmt = $pdo->query("SELECT COUNT(*) as c FROM audio_files");
    print_r($stmt->fetch());
    
    $stmt = $pdo->query("SELECT COUNT(*) as c FROM metadata");
    print_r($stmt->fetch());

    $sql = "
        SELECT 
            a.filename, a.folder_path, a.analyzer_version,
            m.length_seconds, m.sample_rate, m.bit_depth, m.channels, m.source_format, m.lossy_source, m.dc_offset,
            c.ucs_category, c.ucs_subcategory, c.group_name, c.subgroup, c.timbre, c.acoustic_types, c.instrument_family,
            s.root_mean_square_level, s.crest_factor, s.complexity, s.spectral_centroid_hz, s.spectral_rolloff_hz, s.spectral_flatness, s.harmonicity, s.total_harmonic_distortion, s.clipping_density,
            mu.pitch_hz, mu.root_note_name, mu.root_midi_note, mu.root_cents_offset, mu.beats_per_minute,
            e.transient_count, e.attack_seconds, e.decay_seconds, e.sustain_level, e.release_seconds, e.temporal_centroid, e.shape
        FROM audio_files a
        LEFT JOIN metadata m ON a.id = m.file_id
        LEFT JOIN classification c ON a.id = c.file_id
        LEFT JOIN spectral_features s ON a.id = s.file_id
        LEFT JOIN musicality mu ON a.id = mu.file_id
        LEFT JOIN envelope e ON a.id = e.file_id
        LIMIT 1
    ";
    $stmt = $pdo->query($sql);
    print_r($stmt->fetch());
    
} catch (\PDOException $e) {
    echo "Error: " . $e->getMessage();
}
?>
