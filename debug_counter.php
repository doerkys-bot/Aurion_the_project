<?php
header("Content-Type: text/plain; charset=utf-8");

echo "DEBUG START\n";
echo "PHP-Version: " . phpversion() . "\n";

$counterFile = "counter.txt";
$onlineFile  = "online.json";

echo "\n--- Datei-Checks ---\n";

echo "counter.txt existiert: ";
echo file_exists($counterFile) ? "JA\n" : "NEIN\n";

echo "online.json existiert: ";
echo file_exists($onlineFile) ? "JA\n" : "NEIN\n";

echo "counter.txt beschreibbar: ";
echo is_writable($counterFile) ? "JA\n" : "NEIN\n";

echo "online.json beschreibbar: ";
echo is_writable($onlineFile) ? "JA\n" : "NEIN\n";

echo "\n--- Inhalt counter.txt ---\n";
if (file_exists($counterFile)) {
    echo file_get_contents($counterFile) . "\n";
}

echo "\n--- Inhalt online.json ---\n";
if (file_exists($onlineFile)) {
    echo file_get_contents($onlineFile) . "\n";
}

echo "\n--- Versuch zu zählen ---\n";
try {
    $total = @file_get_contents($counterFile);
    $total = (int)$total + 1;
    @file_put_contents($counterFile, $total);
    echo "Neuer total: $total\n";
} catch (Exception $e) {
    echo "FEHLER beim Schreiben in counter.txt!\n";
}

echo "\n--- Fertig ---\n";

?>
