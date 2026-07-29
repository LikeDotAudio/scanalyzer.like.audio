<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

/**
 * Add `metadata.region_count` to a live database, in place.
 *
 * Purely additive: one nullable column and one index. No row is rewritten and
 * nothing is dropped, so unlike the paths migration this one has no point of no
 * return. Existing rows keep NULL — the region count was never uploaded, so it
 * is not recoverable from the database and only a rescan can fill it. NULL is
 * the honest value for "never reported", and the app relies on being able to
 * tell that apart from a measured 1.
 *
 * Idempotent: checks for the column before adding it.
 *
 * POST confirm=ADD REGION COUNT
 */
if ($_SERVER['REQUEST_METHOD'] !== 'POST' || ($_POST['confirm'] ?? '') !== 'ADD REGION COUNT') {
    http_response_code(403);
    exit(json_encode([
        'status' => 'refused',
        'message' => 'POST with confirm=ADD REGION COUNT to proceed.',
    ]));
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

$steps = [];

try {
    $pdo = new PDO($dsn, $user, $pass, $options);

    $has = function (string $table, string $column) use ($pdo): bool {
        $s = $pdo->prepare("SELECT COUNT(*) FROM information_schema.COLUMNS
                            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?");
        $s->execute([$table, $column]);
        $n = (int)$s->fetchColumn();
        $s->closeCursor();
        return $n > 0;
    };
    $hasIndex = function (string $table, string $index) use ($pdo): bool {
        $s = $pdo->prepare("SELECT COUNT(*) FROM information_schema.STATISTICS
                            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?");
        $s->execute([$table, $index]);
        $n = (int)$s->fetchColumn();
        $s->closeCursor();
        return $n > 0;
    };

    if (!$has('metadata', 'region_count')) {
        $pdo->exec("ALTER TABLE metadata ADD COLUMN region_count INT DEFAULT NULL");
        $steps[] = 'added metadata.region_count';
    } else {
        $steps[] = 'metadata.region_count already present';
    }
    if (!$hasIndex('metadata', 'idx_region_count')) {
        $pdo->exec("ALTER TABLE metadata ADD KEY idx_region_count (region_count)");
        $steps[] = 'added idx_region_count';
    } else {
        $steps[] = 'idx_region_count already present';
    }

    $rows = (int)$pdo->query("SELECT COUNT(*) FROM metadata")->fetchColumn();
    $known = (int)$pdo->query("SELECT COUNT(*) FROM metadata WHERE region_count IS NOT NULL")->fetchColumn();
    $multi = (int)$pdo->query("SELECT COUNT(*) FROM metadata WHERE region_count > 1")->fetchColumn();

    echo json_encode([
        'status' => 'success',
        'steps' => $steps,
        'rows' => $rows,
        'with_region_count' => $known,
        'awaiting_rescan' => $rows - $known,
        'multi_region' => $multi,
    ]);
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
