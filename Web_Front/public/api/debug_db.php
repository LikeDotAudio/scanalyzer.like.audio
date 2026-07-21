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

    $sql = "
        SELECT a.filename, m.length_seconds, c.ucs_category, s.root_mean_square_level, mu.pitch_hz, e.transient_count
        FROM audio_files a
        LEFT JOIN metadata m ON a.id = m.file_id
        LEFT JOIN classification c ON a.id = c.file_id
        LEFT JOIN spectral_features s ON a.id = s.file_id
        LEFT JOIN musicality mu ON a.id = mu.file_id
        LEFT JOIN envelope e ON a.id = e.file_id
        LIMIT 1
    ";
    $stmt = $pdo->query($sql);
    print_r($stmt->fetch());
    
} catch (\PDOException $e) {
    echo "Error: " . $e->getMessage();
}
?>
