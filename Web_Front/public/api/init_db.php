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
    
    // 1. Drop existing tables
    $pdo->exec("DROP TABLE IF EXISTS envelope");
    $pdo->exec("DROP TABLE IF EXISTS musicality");
    $pdo->exec("DROP TABLE IF EXISTS spectral_features");
    $pdo->exec("DROP TABLE IF EXISTS classification");
    $pdo->exec("DROP TABLE IF EXISTS metadata");
    $pdo->exec("DROP TABLE IF EXISTS audio_files");
    $pdo->exec("DROP TABLE IF EXISTS peaks"); // the old table
    
    // 2. Create the audio_files table (parent)
    $pdo->exec("
        CREATE TABLE audio_files (
            id INT AUTO_INCREMENT PRIMARY KEY,
            filename VARCHAR(255) NOT NULL,
            folder_path VARCHAR(1024) NOT NULL,
            analyzer_version VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY (filename, folder_path(255))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    ");

    // 3. Create metadata table
    $pdo->exec("
        CREATE TABLE metadata (
            file_id INT PRIMARY KEY,
            length_seconds FLOAT,
            sample_rate INT,
            bit_depth INT,
            channels INT,
            source_format VARCHAR(50),
            lossy_source BOOLEAN,
            dc_offset FLOAT,
            FOREIGN KEY (file_id) REFERENCES audio_files(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    ");

    // 4. Create classification table
    $pdo->exec("
        CREATE TABLE classification (
            file_id INT PRIMARY KEY,
            ucs_category VARCHAR(100),
            ucs_subcategory VARCHAR(100),
            group_name VARCHAR(100),
            subgroup VARCHAR(100),
            timbre VARCHAR(100),
            acoustic_types VARCHAR(255),
            instrument_family VARCHAR(255),
            reason TEXT,
            alt_1_group VARCHAR(100),
            alt_1_sub VARCHAR(100),
            alt_2_group VARCHAR(100),
            alt_2_sub VARCHAR(100),
            alt_3_group VARCHAR(100),
            alt_3_sub VARCHAR(100),
            FOREIGN KEY (file_id) REFERENCES audio_files(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    ");

    // 5. Create spectral_features table
    $pdo->exec("
        CREATE TABLE spectral_features (
            file_id INT PRIMARY KEY,
            root_mean_square_level FLOAT,
            crest_factor FLOAT,
            complexity FLOAT,
            spectral_centroid_hz FLOAT,
            spectral_rolloff_hz FLOAT,
            spectral_flatness FLOAT,
            harmonicity FLOAT,
            total_harmonic_distortion FLOAT,
            clipping_density FLOAT,
            FOREIGN KEY (file_id) REFERENCES audio_files(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    ");

    // 6. Create musicality table
    $pdo->exec("
        CREATE TABLE musicality (
            file_id INT PRIMARY KEY,
            pitch_hz FLOAT,
            root_note_name VARCHAR(20),
            root_midi_note INT,
            root_cents_offset FLOAT,
            beats_per_minute FLOAT,
            FOREIGN KEY (file_id) REFERENCES audio_files(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    ");

    // 7. Create envelope table
    $pdo->exec("
        CREATE TABLE envelope (
            file_id INT PRIMARY KEY,
            transient_count INT,
            attack_seconds FLOAT,
            decay_seconds FLOAT,
            sustain_level FLOAT,
            release_seconds FLOAT,
            temporal_centroid FLOAT,
            shape VARCHAR(100),
            FOREIGN KEY (file_id) REFERENCES audio_files(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    ");

    echo json_encode(["status" => "success", "message" => "All tables created successfully"]);
} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => $e->getMessage()]);
}
?>
