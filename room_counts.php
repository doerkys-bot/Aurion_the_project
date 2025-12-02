<?php
// room_counts.php
header('Content-Type: application/json');

// Pfad zur JSON-Datei, in der die Besucherstände gespeichert sind
$watchFile = __DIR__ . '/visitors.json';

// Beispiel-Datenstruktur, falls Datei nicht existiert
if(!file_exists($watchFile)) {
    $data = [
        "rooms" => [
            "Bibliothek" => 0,
            "Resonanzraum" => 0,
            "Chi-Sternenübung" => 0,
            "Meditationsraum" => 0,
            "KI-Raum" => 0,
            "Gästebuch" => 0
        ],
        "visitors" => []
    ];
    file_put_contents($watchFile, json_encode($data, JSON_PRETTY_PRINT));
} else {
    $data = json_decode(file_get_contents($watchFile), true);
}

// Optional: Besucher simulieren oder zählen
// Hier einfach Besucher pro Raum aus der Datei lesen
$rooms = $data['rooms'] ?? [];

echo json_encode($rooms);rooms' => $rooms
]);
