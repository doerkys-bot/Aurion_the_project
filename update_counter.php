<?php
// Pfad zur JSON-Datei
$file = 'visitors.json';

// Lade aktuelle Besucherzahl
if (file_exists($file)) {
    $data = json_decode(file_get_contents($file), true);
} else {
    $data = ["count" => 0];
}

// Besucherzahl erhöhen
$data["count"] += 1;

// Speichere zurück
file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT));

// Gebe aktuelle Zahl zurück
header('Content-Type: application/json');
echo json_encode($data);
?>
