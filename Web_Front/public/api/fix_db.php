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
    
    // 1. Upgrade the column to handle large JSON payloads
    $pdo->exec("ALTER TABLE peaks MODIFY COLUMN json_data MEDIUMTEXT");
    echo "Column json_data upgraded to MEDIUMTEXT.<br>";
    
    // 2. Delete any corrupted/truncated rows using MySQL's native JSON validator
    $deleted = $pdo->exec("DELETE FROM peaks WHERE NOT JSON_VALID(json_data)");
    echo "Deleted $deleted corrupted rows.<br>";
    
    echo "Database fix applied successfully!";
} catch (\PDOException $e) {
    echo "Error: " . $e->getMessage();
}
?>
