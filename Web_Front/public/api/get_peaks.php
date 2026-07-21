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
    
    // Check if table exists
    $stmt = $pdo->query("SHOW TABLES LIKE 'peaks'");
    if ($stmt->rowCount() == 0) {
        echo "[]";
        exit;
    }

    // Instead of loading 36k records into PHP memory (which triggers PHP memory exhaustion limits),
    // we stream the raw JSON directly from MySQL to the browser!
    $stmt = $pdo->query("SELECT peak_data FROM peaks");
    
    echo "[";
    $first = true;
    while ($row = $stmt->fetch()) {
        if (!$first) echo ",";
        echo $row['peak_data'];
        $first = false;
    }
    echo "]";
    
} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>
