<?php
// Datei: update_counter.php
// Speicherort des Zählers
$counterFile = __DIR__ . '/counter.json';

// Lade aktuelle Daten oder initialisiere
if (file_exists($counterFile)) {
    $data = json_decode(file_get_contents($counterFile), true);
} else {
    $data = ['count' => 0];
}

// Jeden Aufruf als neuen Besuch zählen
$data['count'] += 1;

// Speichere die aktualisierte Zahl
file_put_contents($counterFile, json_encode($data, JSON_PRETTY_PRINT));

// Gib die aktuelle Zahl als JSON zurück
header('Content-Type: application/json');
echo json_encode(['count' => $data['count']]);
?>
