<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

// THIS ENDPOINT DESTROYS THE DATABASE. It drops and recreates every table.
//
// It used to do that for anyone who typed the URL into a browser — one GET from
// a crawler, a link preview, or a mistyped tab and 34,000 contributed records
// were gone with no confirmation and no backup. Require an explicit POST plus a
// spelled-out confirmation phrase, so it cannot happen by accident or by
// drive-by.
if ($_SERVER['REQUEST_METHOD'] !== 'POST' || ($_POST['confirm'] ?? '') !== 'DROP ALL TABLES') {
    http_response_code(403);
    exit(json_encode([
        'status' => 'refused',
        'message' => 'Destructive. POST with confirm=DROP ALL TABLES to proceed.',
    ]));
}

// localhost, not the public hostname: the DB user is only granted access from
// the local socket, so connecting via the domain is refused by the server.
$host = 'localhost';
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
    $pdo->exec("DROP TABLE IF EXISTS paths");
    $pdo->exec("DROP TABLE IF EXISTS peaks"); // the old table

    // 2. Create the paths table.
    //
    // One row per DIRECTORY, holding the full path as the analyzer saw it, so a
    // player can reconstruct exactly where a sound lives:
    // CONCAT(paths.full_path, '/', audio_files.filename).
    //
    // It is its own table because a library stores thousands of files per
    // folder, and repeating a 200-character directory string on every one of
    // them is most of the row. Interning it once also makes "everything under
    // this folder" an indexed lookup instead of a LIKE over the whole set.
    //
    // path_key is a SHA-256 of full_path and is what carries the UNIQUE index.
    // InnoDB caps an index key at 3072 bytes and utf8mb4 costs 4 bytes per
    // character, so a VARCHAR(1024) column cannot be indexed whole; a 255-char
    // PREFIX index would silently treat two paths agreeing in their first 255
    // characters as the same folder, which is exactly what deep sample-library
    // trees look like. Hashing compares the path in full at 64 ascii bytes.
    $pdo->exec("
        CREATE TABLE paths (
            id INT AUTO_INCREMENT PRIMARY KEY,
            full_path VARCHAR(1024) NOT NULL,
            path_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_path_key (path_key),
            KEY idx_full_path (full_path(255))
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    ");

    // 3. Create the audio_files table (parent)
    //
    // Identity is (filename, path_id) against the FULL path. It used to be
    // (filename, folder_path) where folder_path was relative to whatever
    // directory the scan started from — so the same file scanned from a
    // different root was a different row, and one library scanned twice from
    // two levels produced two complete sets of rows.
    $pdo->exec("
        CREATE TABLE audio_files (
            id INT AUTO_INCREMENT PRIMARY KEY,
            filename VARCHAR(255) NOT NULL,
            path_id INT NOT NULL,
            analyzer_version VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_file (filename, path_id),
            KEY idx_path (path_id),
            FOREIGN KEY (path_id) REFERENCES paths(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    ");

    // 4. Create metadata table
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

    // 5. Create classification table
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

    // 6. Create spectral_features table
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

    // 7. Create musicality table
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

    // 8. Create envelope table
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
