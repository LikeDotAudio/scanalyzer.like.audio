<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit(json_encode(['error' => 'Method Not Allowed']));
}

$data = json_decode(file_get_contents('php://input'), true);
if (!$data || !is_array($data)) {
    http_response_code(400);
    exit(json_encode(['error' => 'Invalid JSON payload']));
}

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
    $pdo->beginTransaction();

    $stmtAudio = $pdo->prepare("INSERT INTO audio_files (filename, folder_path, analyzer_version) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE analyzer_version = VALUES(analyzer_version)");
    $stmtMeta = $pdo->prepare("REPLACE INTO metadata (file_id, length_seconds, sample_rate, bit_depth, channels, source_format, lossy_source, dc_offset) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    $stmtClass = $pdo->prepare("REPLACE INTO classification (file_id, ucs_category, ucs_subcategory, group_name, subgroup, timbre, acoustic_types, instrument_family) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    $stmtSpec = $pdo->prepare("REPLACE INTO spectral_features (file_id, root_mean_square_level, crest_factor, complexity, spectral_centroid_hz, spectral_rolloff_hz, spectral_flatness, harmonicity, total_harmonic_distortion, clipping_density) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $stmtMusic = $pdo->prepare("REPLACE INTO musicality (file_id, pitch_hz, root_note_name, root_midi_note, root_cents_offset, beats_per_minute) VALUES (?, ?, ?, ?, ?, ?)");
    $stmtEnv = $pdo->prepare("REPLACE INTO envelope (file_id, transient_count, attack_seconds, decay_seconds, sustain_level, release_seconds, temporal_centroid, shape) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");

    foreach ($data as $record) {
        $meta = $record['metadata'] ?? [];
        if (!isset($meta['name'])) continue;
        
        $filePath = $meta['name'];
        $filename = basename($filePath);
        $folder = dirname($filePath);
        $version = $meta['analyzer_version'] ?? null;
        
        $stmtAudio->execute([$filename, $folder, $version]);
        // Retrieve the ID. Since we used ON DUPLICATE KEY UPDATE, lastInsertId might be 0 if it was an update.
        // We can select it to be safe.
        $idStmt = $pdo->prepare("SELECT id FROM audio_files WHERE filename = ? AND folder_path = ?");
        $idStmt->execute([$filename, $folder]);
        $file_id = $idStmt->fetchColumn();
        if (!$file_id) continue;

        $stmtMeta->execute([
            $file_id,
            $meta['length_seconds'] ?? null,
            $meta['sample_rate'] ?? null,
            $meta['bit_depth'] ?? null,
            $meta['channels'] ?? null,
            $meta['source_format'] ?? null,
            $meta['lossy_source'] ?? null,
            $meta['dc_offset'] ?? null
        ]);

        $cls = $record['classification'] ?? [];
        $ucs = $record['ucs'] ?? [];
        $stmtClass->execute([
            $file_id,
            $ucs['category'] ?? null,
            $ucs['subcategory'] ?? null,
            $cls['group'] ?? null,
            $cls['subgroup'] ?? null,
            $cls['timbre'] ?? null,
            $cls['acoustic_types'] ?? null,
            $cls['instrument_family'] ?? null
        ]);

        $spec = $record['spectral_features'] ?? [];
        $stmtSpec->execute([
            $file_id,
            $spec['root_mean_square_level'] ?? null,
            $spec['crest_factor'] ?? null,
            $spec['complexity'] ?? null,
            $spec['spectral_centroid_hz'] ?? null,
            $spec['spectral_rolloff_hz'] ?? null,
            $spec['spectral_flatness'] ?? null,
            $spec['harmonicity'] ?? null,
            $spec['total_harmonic_distortion'] ?? null,
            $spec['clipping_density'] ?? null
        ]);

        $music = $record['musicality'] ?? [];
        $stmtMusic->execute([
            $file_id,
            $music['pitch_hz'] ?? null,
            $music['root_note_name'] ?? null,
            $music['root_midi_note'] ?? null,
            $music['root_cents_offset'] ?? null,
            $music['beats_per_minute'] ?? null
        ]);

        $env = $record['envelope'] ?? [];
        $stmtEnv->execute([
            $file_id,
            $env['transient_count'] ?? null,
            $env['attack_seconds'] ?? null,
            $env['envelope_decay_seconds'] ?? null,
            $env['envelope_sustain_level'] ?? null,
            $env['envelope_release_seconds'] ?? null,
            $env['envelope_temporal_centroid'] ?? null,
            $env['envelope_shape'] ?? null
        ]);
    }
    $pdo->commit();
    
    echo json_encode(['status' => 'success', 'inserted' => count($data)]);
} catch (\PDOException $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>
