<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

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
    
    // Check if table exists and get record count
    $stmt = $pdo->query("SHOW TABLES LIKE 'peaks'");
    if ($stmt->rowCount() > 0) {
        $countStmt = $pdo->query("SELECT COUNT(*) FROM peaks");
        $count = $countStmt->fetchColumn();
        echo json_encode(['status' => 'online', 'records' => (int)$count]);
    } else {
        echo json_encode(['status' => 'online', 'records' => 0]);
    }
} catch (\PDOException $e) {
    echo json_encode(['status' => 'offline', 'error' => $e->getMessage()]);
}
?>
