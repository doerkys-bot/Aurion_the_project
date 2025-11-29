<?php
$file = 'counter.txt';

// Datei erstellen, falls sie nicht existiert
if (!file_exists($file)) {
    file_put_contents($file, '0');
}

// Anzahl auslesen
$count = (int)file_get_contents($file);

// Erhöhen
$count++;
file_put_contents($file, $count);

// Ausgabe als JSON
header('Content-Type: application/json');
echo json_encode(['visitors' => $count]);
?>