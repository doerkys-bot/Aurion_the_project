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

// Optional: Besucher pro Raum erhöhen, wenn `room` als GET-Parameter kommt
if (isset($_GET['room']) && in_array($_GET['room'], $rooms)) {
    $data[$_GET['room']]++;
}

// Speichere die Zahlen zurück
file_put_contents($counterFile, json_encode($data, JSON_PRETTY_PRINT));

// Gesamtanzahl berechnen
$totalVisitors = array_sum($data);

// Ausgabe als JSON
echo json_encode([
    'rooms' => $data,
    'total' => $totalVisitors
]);
?>
