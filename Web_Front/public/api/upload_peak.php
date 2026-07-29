<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit(json_encode(['error' => 'Method Not Allowed']));
}

$raw = file_get_contents('php://input');
$data = json_decode($raw, true);
if (!$data || !is_array($data)) {
    // Distinguish "you sent nonsense" from "PHP threw your body away". A POST
    // larger than post_max_size arrives with an EMPTY body and no error, so the
    // old blanket "Invalid JSON payload" was the same message for a client bug
    // and for a server limit the client can do nothing about but must be told.
    http_response_code(400);
    $limit = ini_get('post_max_size');
    exit(json_encode([
        'error' => $raw === '' ? 'Empty body — the payload probably exceeded post_max_size' : 'Invalid JSON payload',
        'bytes_received' => strlen($raw),
        'post_max_size' => $limit,
    ]));
}

/** A column holds one string. Join a list into one; leave scalars alone.
 *  Passing the raw array into execute() made PDO stringify it to the literal
 *  "Array", which is what 1,000 rows in this database still say. */
function as_text($value) {
    if (is_array($value)) {
        $flat = array_filter($value, 'is_scalar');
        return $flat ? implode(', ', $flat) : null;
    }
    return $value;
}

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
    $pdo->beginTransaction();

    $stmtAudio = $pdo->prepare("INSERT INTO audio_files (filename, folder_path, analyzer_version) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE analyzer_version = VALUES(analyzer_version)");
    $stmtMeta = $pdo->prepare("REPLACE INTO metadata (file_id, length_seconds, sample_rate, bit_depth, channels, source_format, lossy_source, dc_offset) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    $stmtClass = $pdo->prepare("REPLACE INTO classification (file_id, ucs_category, ucs_subcategory, group_name, subgroup, timbre, acoustic_types, instrument_family, reason, alt_1_group, alt_1_sub, alt_2_group, alt_2_sub, alt_3_group, alt_3_sub) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $stmtSpec = $pdo->prepare("REPLACE INTO spectral_features (file_id, root_mean_square_level, crest_factor, complexity, spectral_centroid_hz, spectral_rolloff_hz, spectral_flatness, harmonicity, total_harmonic_distortion, clipping_density) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    $stmtMusic = $pdo->prepare("REPLACE INTO musicality (file_id, pitch_hz, root_note_name, root_midi_note, root_cents_offset, beats_per_minute) VALUES (?, ?, ?, ?, ?, ?)");
    $stmtEnv = $pdo->prepare("REPLACE INTO envelope (file_id, transient_count, attack_seconds, decay_seconds, sustain_level, release_seconds, temporal_centroid, shape) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");

    $idStmt = $pdo->prepare("SELECT id FROM audio_files WHERE filename = ? AND folder_path = ?");

    $stored = 0;
    $skipped = 0;

    foreach ($data as $record) {
        $meta = $record['metadata'] ?? [];
        if (!isset($meta['name'])) { $skipped++; continue; }

        // The folder comes from `metadata.folder`, which is what the analyzer
        // actually populates with it.
        //
        // This used to be dirname($meta['name']) — but `name` is a bare
        // filename, never a path, so dirname() returned "." for every record
        // ever uploaded. Combined with UNIQUE KEY (filename, folder_path) that
        // made every same-named file in the library overwrite every other one:
        // the row count tracked distinct FILENAMES, not files scanned, and a
        // library of 200k samples collapsed to 34k rows with no error anywhere.
        $filename = basename($meta['name']);
        $folder = $meta['folder'] ?? '';
        if ($folder === '' && !empty($meta['path'])) {
            $folder = dirname(str_replace('\\', '/', $meta['path']));
        }
        if ($folder === '' || $folder === '.') $folder = '(root)';
        $version = $meta['analyzer_version'] ?? null;

        $stmtAudio->execute([$filename, $folder, $version]);
        // Retrieve the ID. Since we used ON DUPLICATE KEY UPDATE, lastInsertId might be 0 if it was an update.
        // We can select it to be safe.
        //
        // closeCursor() is NOT optional. With ATTR_EMULATE_PREPARES => false these
        // are real server-side prepares, and fetchColumn() reads one value while
        // leaving the result set open. Re-executing the same handle on the next
        // record then fails with "Cannot execute queries while other unbuffered
        // queries are active", which aborts the transaction and loses the WHOLE
        // batch. This loop originally called prepare() per record, which sidestepped
        // it by handing every record a fresh cursor; hoisting the prepare for speed
        // without freeing the cursor is what broke multi-record uploads — a batch of
        // one worked, a batch of two did not.
        $idStmt->execute([$filename, $folder]);
        $file_id = $idStmt->fetchColumn();
        $idStmt->closeCursor();
        if (!$file_id) { $skipped++; continue; }

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
            as_text($cls['acoustic_types'] ?? null),
            as_text($cls['instrument_family'] ?? null),
            // `reason` is the three-part membership argument — store all of it,
            // not just clause 1. The column is TEXT.
            as_text($cls['reason'] ?? null),
            $ucs['alternatives'][0]['category'] ?? null,
            $ucs['alternatives'][0]['subcategory'] ?? null,
            $ucs['alternatives'][1]['category'] ?? null,
            $ucs['alternatives'][1]['subcategory'] ?? null,
            $ucs['alternatives'][2]['category'] ?? null,
            $ucs['alternatives'][2]['subcategory'] ?? null
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

        $stored++;
    }
    $pdo->commit();

    // `stored` is what actually reached a row. It used to report count($data) —
    // the number of records POSTed — which meant a batch that skipped every
    // record for want of a name still reported total success, and no client
    // could tell. The UI counter reads this field.
    echo json_encode([
        'status' => 'success',
        'stored' => $stored,
        'skipped' => $skipped,
        'received' => count($data),
        // Kept so an older client that reads `inserted` keeps working.
        'inserted' => $stored,
    ]);
} catch (\Throwable $e) {
    // \Throwable, not \PDOException. Anything this endpoint throws that is not a
    // PDOException used to escape as an uncaught fatal, and with display_errors
    // off on the host that means a 500 with a COMPLETELY EMPTY body — no message,
    // no line, nothing in the client's log but "HTTP 500". Every caller then
    // reported a generic failure and the real cause had to be bisected by hand.
    if (isset($pdo) && $pdo->inTransaction()) {
        try { $pdo->rollBack(); } catch (\Throwable $ignored) {}
    }
    http_response_code(500);
    echo json_encode([
        'error' => $e->getMessage(),
        'type' => get_class($e),
        'line' => $e->getLine(),
    ]);
}
?>
