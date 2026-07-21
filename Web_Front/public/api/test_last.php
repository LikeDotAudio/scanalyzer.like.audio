<?php
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
    
    // Find the row with the problem!
    $stmt = $pdo->query("SELECT name, LENGTH(json_data) as len, RIGHT(json_data, 100) as tail, JSON_VALID(json_data) as is_valid FROM peaks ORDER BY len ASC LIMIT 5");
    print_r($stmt->fetchAll());
    
    $stmt = $pdo->query("SELECT name, LENGTH(json_data) as len, RIGHT(json_data, 100) as tail, JSON_VALID(json_data) as is_valid FROM peaks WHERE json_data LIKE '%low_band_energ%' AND json_data NOT LIKE '%low_band_energy%' LIMIT 5");
    print_r($stmt->fetchAll());
    
} catch (\PDOException $e) {
    echo "Error: " . $e->getMessage();
}
?>
