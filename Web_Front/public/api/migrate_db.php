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
    
    // Add columns to classification
    $queries = [
        "ALTER TABLE classification ADD COLUMN reason TEXT",
        "ALTER TABLE classification ADD COLUMN alt_1_group VARCHAR(100)",
        "ALTER TABLE classification ADD COLUMN alt_1_sub VARCHAR(100)",
        "ALTER TABLE classification ADD COLUMN alt_2_group VARCHAR(100)",
        "ALTER TABLE classification ADD COLUMN alt_2_sub VARCHAR(100)",
        "ALTER TABLE classification ADD COLUMN alt_3_group VARCHAR(100)",
        "ALTER TABLE classification ADD COLUMN alt_3_sub VARCHAR(100)"
    ];
    
    $results = [];
    foreach ($queries as $q) {
        try {
            $pdo->exec($q);
            $results[] = ["query" => $q, "status" => "success"];
        } catch (\PDOException $e) {
            // Ignore error if column already exists (SQLSTATE 42S21)
            if ($e->getCode() == '42S21' || str_contains($e->getMessage(), 'Duplicate column name')) {
                 $results[] = ["query" => $q, "status" => "already exists"];
            } else {
                 $results[] = ["query" => $q, "status" => "error", "message" => $e->getMessage()];
            }
        }
    }

    echo json_encode(["status" => "completed", "results" => $results]);
} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => $e->getMessage()]);
}
?>
