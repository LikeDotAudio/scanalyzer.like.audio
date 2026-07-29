<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$host = 'localhost';
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
    
    // Check if table exists
    $stmt = $pdo->query("SHOW TABLES LIKE 'audio_files'");
    if (count($stmt->fetchAll()) == 0) {
        echo "[]";
        exit;
    }
    $stmt->closeCursor();

    $sql = "
        SELECT
            a.filename, p.full_path, a.analyzer_version,
            m.length_seconds, m.sample_rate, m.bit_depth, m.channels, m.source_format, m.lossy_source, m.dc_offset, m.region_count,
            c.ucs_category, c.ucs_subcategory, c.group_name, c.subgroup, c.timbre, c.acoustic_types, c.instrument_family,
            c.reason, c.alt_1_group, c.alt_1_sub, c.alt_2_group, c.alt_2_sub, c.alt_3_group, c.alt_3_sub,
            s.root_mean_square_level, s.crest_factor, s.complexity, s.spectral_centroid_hz, s.spectral_rolloff_hz, s.spectral_flatness, s.harmonicity, s.total_harmonic_distortion, s.clipping_density,
            mu.pitch_hz, mu.root_note_name, mu.root_midi_note, mu.root_cents_offset, mu.beats_per_minute,
            e.transient_count, e.attack_seconds, e.decay_seconds, e.sustain_level, e.release_seconds, e.temporal_centroid, e.shape
        FROM audio_files a
        LEFT JOIN paths p ON a.path_id = p.id
        LEFT JOIN metadata m ON a.id = m.file_id
        LEFT JOIN classification c ON a.id = c.file_id
        LEFT JOIN spectral_features s ON a.id = s.file_id
        LEFT JOIN musicality mu ON a.id = mu.file_id
        LEFT JOIN envelope e ON a.id = e.file_id
    ";

    $stmt = $pdo->query($sql);
    
    echo "[";
    $first = true;
    while ($row = $stmt->fetch()) {
        if (!$first) echo ",";
        
        $record = [
            "metadata" => [
                // `name` is the bare filename, matching what the analyzer writes
                // into a .PEAK — it used to be folder+'/'+filename glued
                // together, so a record read back from the cloud disagreed with
                // the same record read from disk.
                "name" => $row['filename'],
                // The directory, and the full reconstruction of where the sound
                // lives. This is the point of the paths table: a player can walk
                // straight back to the file rather than guessing from a folder
                // fragment that was only ever relative to somebody's scan root.
                "folder" => $row['full_path'],
                "path" => $row['full_path'] === null || $row['full_path'] === ''
                    ? $row['filename']
                    : rtrim($row['full_path'], '/') . '/' . $row['filename'],
                "analyzer_version" => $row['analyzer_version'],
                "length_seconds" => (float)$row['length_seconds'],
                "sample_rate" => (int)$row['sample_rate'],
                "bit_depth" => (int)$row['bit_depth'],
                "channels" => (int)$row['channels'],
                "source_format" => $row['source_format'],
                "lossy_source" => $row['lossy_source'] ? true : false,
                "dc_offset" => (float)$row['dc_offset']
            ],
            // Region count travels as the `regions` group the rest of the app
            // already reads (item.regions?.count). NULL stays absent rather than
            // becoming 0, so a pre-column record is distinguishable from a file
            // genuinely measured as having no regions.
            "regions" => $row['region_count'] === null ? null : ["count" => (int)$row['region_count']],
            "classification" => [
                "group" => $row['group_name'],
                "subgroup" => $row['subgroup'],
                "timbre" => $row['timbre'],
                "acoustic_types" => $row['acoustic_types'],
                "instrument_family" => $row['instrument_family'],
                "reason" => $row['reason'] ? [$row['reason']] : []
            ],
            "ucs" => [
                "category" => $row['ucs_category'],
                "subcategory" => $row['ucs_subcategory'],
                "alternatives" => [
                    ["category" => $row['alt_1_group'], "subcategory" => $row['alt_1_sub']],
                    ["category" => $row['alt_2_group'], "subcategory" => $row['alt_2_sub']],
                    ["category" => $row['alt_3_group'], "subcategory" => $row['alt_3_sub']]
                ]
            ],
            "spectral_features" => [
                "root_mean_square_level" => (float)$row['root_mean_square_level'],
                "crest_factor" => (float)$row['crest_factor'],
                "complexity" => (float)$row['complexity'],
                "spectral_centroid_hz" => (float)$row['spectral_centroid_hz'],
                "spectral_rolloff_hz" => (float)$row['spectral_rolloff_hz'],
                "spectral_flatness" => (float)$row['spectral_flatness'],
                "harmonicity" => (float)$row['harmonicity'],
                "total_harmonic_distortion" => (float)$row['total_harmonic_distortion'],
                "clipping_density" => (float)$row['clipping_density']
            ],
            "musicality" => [
                "pitch_hz" => (float)$row['pitch_hz'],
                "root_note_name" => $row['root_note_name'],
                "root_midi_note" => (int)$row['root_midi_note'],
                "root_cents_offset" => (float)$row['root_cents_offset'],
                "beats_per_minute" => (float)$row['beats_per_minute']
            ],
            // The peak-relative ADSR columns are NULL for a multi-event file:
            // there is no single peak to measure against, so the analyzer stores
            // nothing rather than a number describing the loudest edit point.
            // (float)NULL is 0.0, which would turn "not measurable" into the
            // positive claim "this sound has no sustain" — so keep the null.
            "envelope" => [
                "transient_count" => (int)$row['transient_count'],
                "attack_seconds" => (float)$row['attack_seconds'],
                "envelope_decay_seconds" => $row['decay_seconds'] === null ? null : (float)$row['decay_seconds'],
                "envelope_sustain_level" => $row['sustain_level'] === null ? null : (float)$row['sustain_level'],
                "envelope_release_seconds" => $row['release_seconds'] === null ? null : (float)$row['release_seconds'],
                "envelope_temporal_centroid" => $row['temporal_centroid'] === null ? null : (float)$row['temporal_centroid'],
                "envelope_shape" => $row['shape']
            ],
            "unsupervised" => [
                "cluster" => -1,
                "tsne_x" => 0,
                "tsne_y" => 0,
                "tsne_z" => 0,
                "umap_x" => 0,
                "umap_y" => 0,
                "umap_z" => 0
            ]
        ];
        
        echo json_encode($record);
        $first = false;
    }
    echo "]";
    
} catch (\Throwable $e) {
    // http_response_code(500); // Commented out to prevent host 503 intercept
    echo json_encode(['error' => $e->getMessage(), 'line' => $e->getLine()]);
}
?>
