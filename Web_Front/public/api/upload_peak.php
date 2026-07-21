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
    
    $stmt = $pdo->prepare("INSERT INTO peaks (path, name, folder, json_data) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE json_data = VALUES(json_data), name = VALUES(name), folder = VALUES(folder)");
    
    $pdo->beginTransaction();
    foreach ($data as $record) {
        if (!isset($record['metadata']['name'])) continue;
        
        $filePath = $record['metadata']['name'];
        $name = basename($filePath);
        $folder = dirname($filePath);
        $peakData = json_encode($record);
        $stmt->execute([$filePath, $name, $folder, $peakData]);
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
