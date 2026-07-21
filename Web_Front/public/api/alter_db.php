<?php
header('Content-Type: application/json');

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
    
    // Check if the columns already exist
    $stmt = $pdo->query("SHOW COLUMNS FROM classification LIKE 'reason'");
    if (count($stmt->fetchAll()) == 0) {
        $pdo->exec("
            ALTER TABLE classification 
            ADD COLUMN reason TEXT,
            ADD COLUMN alt_1_group VARCHAR(100),
            ADD COLUMN alt_1_sub VARCHAR(100),
            ADD COLUMN alt_2_group VARCHAR(100),
            ADD COLUMN alt_2_sub VARCHAR(100),
            ADD COLUMN alt_3_group VARCHAR(100),
            ADD COLUMN alt_3_sub VARCHAR(100)
        ");
        echo json_encode(['status' => 'success', 'message' => 'Added missing columns to classification table.']);
    } else {
        echo json_encode(['status' => 'success', 'message' => 'Columns already exist.']);
    }
} catch (\Throwable $e) {
    echo json_encode(['error' => $e->getMessage()]);
}
?>
