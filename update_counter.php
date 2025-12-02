<?php
header('Content-Type: application/json');

// Datei zur Speicherung der Besucherzahlen
$counterFile = 'room_counts.json';

// Räume definieren
$rooms = [
    "Bibliothek",
    "Resonanzraum",
    "Chi-Sternenübung",
    "Meditationsraum",
    "KI-Raum",
    "Gästebuch"
];

// Lade bestehende Zahlen oder initialisiere
if (file_exists($counterFile)) {
    $data = json_decode(file_get_contents($counterFile), true);
    if (!is_array($data)) $data = [];
} else {
    $data = [];
}

// Alle Räume sicherstellen
foreach ($rooms as $room) {
    if (!isset($data[$room])) $data[$room] = 0;
}

// Optional: Besucher pro Raum simulieren für Demo
// In Realität: Hier kannst du die Logik einbauen, z.B. pro Besuch
foreach ($rooms as $room) {
    $data[$room] = max(0, $data[$room]); // Keine negativen Werte
}

// Speichere die Zahlen zurück
file_put_contents($counterFile, json_encode($data, JSON_PRETTY_PRINT));

// Ausgabe als JSON
echo json_encode($data);
?>
