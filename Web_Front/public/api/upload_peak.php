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

    $stmtPeaks = $pdo->prepare("INSERT INTO peaks (path, name, folder, json_data) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), folder = VALUES(folder), json_data = VALUES(json_data)");

    foreach ($data as $record) {
        $meta = $record['metadata'] ?? [];
        if (!isset($meta['name'])) continue;
        
        $filePath = $meta['name'];
        $filename = basename($filePath);
        $folder = dirname($filePath);
        $path = $meta['path'] ?? '';
        
        $stmtPeaks->execute([$path, $filename, $folder, json_encode($record)]);
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
