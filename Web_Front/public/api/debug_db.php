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
    
    // Check table sizes
    $stmt = $pdo->query("SELECT COUNT(*) as c FROM audio_files");
    print_r($stmt->fetch());
    
    $stmt = $pdo->query("SELECT COUNT(*) as c FROM metadata");
    print_r($stmt->fetch());
    
} catch (\PDOException $e) {
    echo "Error: " . $e->getMessage();
}
?>
