<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

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
    PDO::MYSQL_ATTR_USE_BUFFERED_QUERY => false,
];

try {
    $pdo = new PDO($dsn, $user, $pass, $options);
    
    // Check if table exists
    $stmt = $pdo->query("SHOW TABLES LIKE 'audio_files'");
    if (count($stmt->fetchAll()) == 0) {
        echo "[]";
        exit;
    }

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
        LIMIT 10
    ";

    $stmt = $pdo->query($sql);
    
    echo "[";
    $first = true;
    while ($row = $stmt->fetch()) {
        if (!$first) echo ",";
        
        $record = [
            "metadata" => [
                "name" => $row['folder_path'] . '/' . $row['filename'],
                "analyzer_version" => $row['analyzer_version'],
                "length_seconds" => $row['length_seconds'],
                "sample_rate" => $row['sample_rate'],
                "bit_depth" => $row['bit_depth'],
                "channels" => $row['channels'],
                "source_format" => $row['source_format'],
                "lossy_source" => $row['lossy_source'] ? true : false,
                "dc_offset" => $row['dc_offset']
            ],
            "classification" => [
                "group" => $row['group_name'],
                "subgroup" => $row['subgroup'],
                "timbre" => $row['timbre'],
                "acoustic_types" => $row['acoustic_types'],
                "instrument_family" => $row['instrument_family']
            ],
            "ucs" => [
                "category" => $row['ucs_category'],
                "subcategory" => $row['ucs_subcategory']
            ],
            "spectral_features" => [
                "root_mean_square_level" => $row['root_mean_square_level'],
                "crest_factor" => $row['crest_factor'],
                "complexity" => $row['complexity'],
                "spectral_centroid_hz" => $row['spectral_centroid_hz'],
                "spectral_rolloff_hz" => $row['spectral_rolloff_hz'],
                "spectral_flatness" => $row['spectral_flatness'],
                "harmonicity" => $row['harmonicity'],
                "total_harmonic_distortion" => $row['total_harmonic_distortion'],
                "clipping_density" => $row['clipping_density']
            ],
            "musicality" => [
                "pitch_hz" => $row['pitch_hz'],
                "root_note_name" => $row['root_note_name'],
                "root_midi_note" => $row['root_midi_note'],
                "root_cents_offset" => $row['root_cents_offset'],
                "beats_per_minute" => $row['beats_per_minute']
            ],
            "envelope" => [
                "transient_count" => $row['transient_count'],
                "attack_seconds" => $row['attack_seconds'],
                "envelope_decay_seconds" => $row['decay_seconds'],
                "envelope_sustain_level" => $row['sustain_level'],
                "envelope_release_seconds" => $row['release_seconds'],
                "envelope_temporal_centroid" => $row['temporal_centroid'],
                "envelope_shape" => $row['shape']
            ]
        ];
        
        echo json_encode($record);
        $first = false;
    }
    echo "]";
    
} catch (\PDOException $e) {
    // http_response_code(500); // Commented out to prevent host 503 intercept
    echo json_encode(['error' => $e->getMessage()]);
}
?>
