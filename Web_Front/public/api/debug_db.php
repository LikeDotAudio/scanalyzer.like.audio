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
    
    // Find all rows where json_data is not valid JSON
    $stmt = $pdo->query("SELECT name, LENGTH(json_data) as len, RIGHT(json_data, 20) as tail FROM peaks WHERE json_data NOT LIKE '%}'");
    $rows = $stmt->fetchAll();
    echo "Rows not ending in '}': " . count($rows) . "<br>";
    print_r($rows);
    
    $stmt = $pdo->query("SELECT COUNT(*) as c, MAX(LENGTH(json_data)) as m FROM peaks");
    print_r($stmt->fetch());
    
} catch (\PDOException $e) {
    echo "Error: " . $e->getMessage();
}
?>
