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
    
    $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 50000;
    
    // Check if the peaks table exists
    $stmt = $pdo->query("SHOW TABLES LIKE 'peaks'");
    if (count($stmt->fetchAll()) == 0) {
        echo "[]";
        exit;
    }
    $stmt->closeCursor();

    // Strip heavy arrays on the database side to keep the payload small
    $sql = "
        SELECT JSON_REMOVE(json_data, 
            '$.unsupervised.principal_components',
            '$.spectral_features.mel_frequency_cepstral_coefficients',
            '$.preview',
            '$.regions'
        ) as stripped_json
        FROM peaks
        WHERE json_data IS NOT NULL
        LIMIT $limit
    ";

    $stmt = $pdo->query($sql);
    
    echo "[";
    $first = true;
    while ($row = $stmt->fetch()) {
        if (!$first) echo ",\n";
        echo $row['stripped_json'];
        $first = false;
    }
    echo "]";
    
} catch (\Throwable $e) {
    // http_response_code(500); // Commented out to prevent host 503 intercept
    echo json_encode(['error' => $e->getMessage(), 'line' => $e->getLine()]);
}
?>
