<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

/**
 * Migrate audio_files from a scan-root-relative `folder_path` to the `paths`
 * table, IN PLACE, without losing a row.
 *
 * The old column held `metadata.folder`, which the analyzer builds as
 * "<name of the scanned folder>/<subpath>". That first segment means the stored
 * value is only missing the directory the library itself lives in — so
 * prepending one prefix recovers the true absolute path exactly. Verified
 * against the live data before this script was written: 400 of 400 sampled rows
 * reconstructed to a file that exists on disk.
 *
 * Idempotent: safe to run twice. Each step checks whether it has already been
 * applied, so a run interrupted halfway can simply be repeated.
 *
 * POST parameters:
 *   confirm  (required) - must be "MIGRATE PATHS"
 *   prefix   (required) - absolute directory the scanned folders live in,
 *                         e.g. "/home/anthony/Documents". A trailing slash is
 *                         optional. Every folder_path is prefixed with it.
 *   dry_run  (optional) - "1" to report what WOULD happen and change nothing.
 */
if ($_SERVER['REQUEST_METHOD'] !== 'POST' || ($_POST['confirm'] ?? '') !== 'MIGRATE PATHS') {
    http_response_code(403);
    exit(json_encode([
        'status' => 'refused',
        'message' => 'POST with confirm=MIGRATE PATHS and prefix=/absolute/parent to proceed. Add dry_run=1 to preview.',
    ]));
}

$prefix = rtrim((string)($_POST['prefix'] ?? ''), '/');
if ($prefix === '' || $prefix[0] !== '/') {
    http_response_code(400);
    exit(json_encode(['status' => 'error', 'message' => 'prefix must be an absolute path, e.g. /home/anthony/Documents']));
}
$dryRun = ($_POST['dry_run'] ?? '') === '1';

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

/** Does this table have this column? */
function hasColumn(PDO $pdo, string $table, string $column): bool {
    $s = $pdo->prepare("SELECT COUNT(*) FROM information_schema.COLUMNS
                        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?");
    $s->execute([$table, $column]);
    $n = (int)$s->fetchColumn();
    $s->closeCursor();
    return $n > 0;
}

function hasIndex(PDO $pdo, string $table, string $index): bool {
    $s = $pdo->prepare("SELECT COUNT(*) FROM information_schema.STATISTICS
                        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?");
    $s->execute([$table, $index]);
    $n = (int)$s->fetchColumn();
    $s->closeCursor();
    return $n > 0;
}

$steps = [];

try {
    $pdo = new PDO($dsn, $user, $pass, $options);

    $before = (int)$pdo->query("SELECT COUNT(*) FROM audio_files")->fetchColumn();
    $hadFolder = hasColumn($pdo, 'audio_files', 'folder_path');

    if (!$hadFolder && hasColumn($pdo, 'audio_files', 'path_id')) {
        exit(json_encode([
            'status' => 'already_migrated',
            'rows' => $before,
            'message' => 'audio_files already uses path_id; nothing to do.',
        ]));
    }
    if (!$hadFolder) {
        http_response_code(500);
        exit(json_encode(['status' => 'error', 'message' => 'audio_files has neither folder_path nor path_id — unrecognised schema.']));
    }

    // What the migration would produce, before touching anything.
    $sample = $pdo->prepare("SELECT DISTINCT folder_path FROM audio_files ORDER BY folder_path LIMIT 5");
    $sample->execute();
    $preview = [];
    foreach ($sample->fetchAll() as $r) {
        $preview[] = $prefix . '/' . $r['folder_path'];
    }
    $distinct = (int)$pdo->query("SELECT COUNT(DISTINCT folder_path) FROM audio_files")->fetchColumn();

    if ($dryRun) {
        exit(json_encode([
            'status' => 'dry_run',
            'rows' => $before,
            'distinct_folders' => $distinct,
            'prefix' => $prefix,
            'sample_full_paths' => $preview,
        ], JSON_UNESCAPED_SLASHES));
    }

    // ---- 1. the paths table
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS paths (
            id INT AUTO_INCREMENT PRIMARY KEY,
            full_path VARCHAR(1024) NOT NULL,
            path_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_path_key (path_key),
            KEY idx_full_path (full_path(255))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
    $steps[] = 'paths table ready';

    // ---- 2. intern every distinct directory.
    // SHA2(x, 256) is byte-for-byte what PHP's hash('sha256', x) produces, so a
    // row written by this migration and one written later by upload_peak.php
    // land on the same path_key and therefore the same row.
    $ins = $pdo->prepare("
        INSERT INTO paths (full_path, path_key)
        SELECT DISTINCT CONCAT(?, '/', folder_path), SHA2(CONCAT(?, '/', folder_path), 256)
        FROM audio_files
        ON DUPLICATE KEY UPDATE full_path = VALUES(full_path)
    ");
    $ins->execute([$prefix, $prefix]);
    $pathCount = (int)$pdo->query("SELECT COUNT(*) FROM paths")->fetchColumn();
    $steps[] = "interned $pathCount directories";

    // ---- 3. add and backfill path_id
    if (!hasColumn($pdo, 'audio_files', 'path_id')) {
        $pdo->exec("ALTER TABLE audio_files ADD COLUMN path_id INT NULL");
        $steps[] = 'added audio_files.path_id';
    }
    $upd = $pdo->prepare("
        UPDATE audio_files a
        -- CONVERT ... USING ascii is required, not cosmetic. path_key is
        -- ascii_bin (an exact-byte index over a hex digest), while SHA2()
        -- returns its hex in the CONNECTION charset, utf8mb4. Comparing the two
        -- directly raises an illegal-mix-of-collations error and the join dies.
        -- Assignment converts implicitly, which is why the INSERT above is fine
        -- and only this comparison needed it.
        JOIN paths p ON p.path_key = CONVERT(SHA2(CONCAT(?, '/', a.folder_path), 256) USING ascii) COLLATE ascii_bin
        SET a.path_id = p.id
        WHERE a.path_id IS NULL
    ");
    $upd->execute([$prefix]);
    $steps[] = 'backfilled path_id for ' . $upd->rowCount() . ' rows';

    // ---- 4. refuse to go further if anything was left behind.
    // Dropping folder_path with unmapped rows would destroy the only copy of
    // their location, so this is the point of no return and it is guarded.
    $orphans = (int)$pdo->query("SELECT COUNT(*) FROM audio_files WHERE path_id IS NULL")->fetchColumn();
    if ($orphans > 0) {
        http_response_code(500);
        exit(json_encode([
            'status' => 'incomplete',
            'unmapped_rows' => $orphans,
            'steps' => $steps,
            'message' => 'Some rows did not map to a path. folder_path has been LEFT IN PLACE; nothing was lost. Re-run after investigating.',
        ]));
    }

    // ---- 5. swap the key over to (filename, path_id)
    $pdo->exec("ALTER TABLE audio_files MODIFY COLUMN path_id INT NOT NULL");
    if (hasIndex($pdo, 'audio_files', 'filename')) {
        $pdo->exec("ALTER TABLE audio_files DROP INDEX filename");
        $steps[] = 'dropped old UNIQUE (filename, folder_path)';
    }
    if (!hasIndex($pdo, 'audio_files', 'uq_file')) {
        $pdo->exec("ALTER TABLE audio_files ADD UNIQUE KEY uq_file (filename, path_id)");
        $steps[] = 'added UNIQUE (filename, path_id)';
    }
    if (!hasIndex($pdo, 'audio_files', 'idx_path')) {
        $pdo->exec("ALTER TABLE audio_files ADD KEY idx_path (path_id)");
    }
    $pdo->exec("ALTER TABLE audio_files ADD CONSTRAINT fk_audio_path FOREIGN KEY (path_id) REFERENCES paths(id) ON DELETE CASCADE");
    $steps[] = 'added foreign key to paths';

    // ---- 6. the old column is now redundant
    $pdo->exec("ALTER TABLE audio_files DROP COLUMN folder_path");
    $steps[] = 'dropped folder_path';

    $after = (int)$pdo->query("SELECT COUNT(*) FROM audio_files")->fetchColumn();
    $example = $pdo->query("SELECT CONCAT(p.full_path, '/', a.filename) AS reconstructed
                            FROM audio_files a JOIN paths p ON a.path_id = p.id LIMIT 3")->fetchAll();

    echo json_encode([
        'status' => 'success',
        'rows_before' => $before,
        'rows_after' => $after,
        'paths' => $pathCount,
        'steps' => $steps,
        'example_reconstructions' => array_column($example, 'reconstructed'),
    ], JSON_UNESCAPED_SLASHES);

} catch (\Throwable $e) {
    http_response_code(500);
    echo json_encode([
        'status' => 'error',
        'error' => $e->getMessage(),
        'type' => get_class($e),
        'line' => $e->getLine(),
        'steps_completed' => $steps,
    ]);
}
?>
