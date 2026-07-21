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
];

try {
    $pdo = new PDO($dsn, $user, $pass, $options);
    // test connection and get record count
    $stmt = $pdo->query("SELECT COUNT(*) FROM audio_files");
    $records = (int)$stmt->fetchColumn();
    echo json_encode(['status' => 'online', 'records' => $records]);
} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(['status' => 'offline', 'error' => $e->getMessage()]);
}
?>
