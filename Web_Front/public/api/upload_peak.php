<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

// Only allow POST
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
$pass = 'z7hGhX)x)?UXtuo]';
$charset = 'utf8mb4';

$dsn = "mysql:host=$host;dbname=$db;charset=$charset";
$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
];

try {
    $pdo = new PDO($dsn, $user, $pass, $options);
    
    // Ensure table exists
    $pdo->exec("CREATE TABLE IF NOT EXISTS peaks (
        file_path VARCHAR(1024) PRIMARY KEY,
        peak_data JSON NOT NULL
    )");

    $stmt = $pdo->prepare("INSERT INTO peaks (file_path, peak_data) VALUES (?, ?) ON DUPLICATE KEY UPDATE peak_data = VALUES(peak_data)");
    
    $pdo->beginTransaction();
    foreach ($data as $record) {
        if (!isset($record['metadata']['name'])) continue;
        
        $filePath = $record['metadata']['name'];
        $peakData = json_encode($record);
        $stmt->execute([$filePath, $peakData]);
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
