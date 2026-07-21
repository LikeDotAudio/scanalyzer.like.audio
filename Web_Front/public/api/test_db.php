<?php
$pass = 'GITHUB_SECRET_DB_PASSWORD';
echo "Password length: " . strlen($pass) . "\n";
echo "Password equals literal? " . ($pass === 'GITHUB_SECRET_DB_PASSWORD' ? 'Yes' : 'No') . "\n";
?>
