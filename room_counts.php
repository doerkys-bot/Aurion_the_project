<?php
header('Content-Type: application/json');

// Pfad zu deiner visitors.json
$jsonFile = __DIR__ . '/visitors.json';

if(!file_exists($jsonFile)){
    echo json_encode([
        'total' => 0,
        'rooms' => [
            "Bibliothek" => 0,
            "Resonanzraum" => 0,
            "Chi-Sternenübung" => 0,
            "Meditationsraum" => 0,
            "KI-Raum" => 0,
            "Gästebuch" => 0
        ]
    ]);
    exit;
}

$data = json_decode(file_get_contents($jsonFile), true);

$rooms = [
    "Bibliothek" => 0,
    "Resonanzraum" => 0,
    "Chi-Sternenübung" => 0,
    "Meditationsraum" => 0,
    "KI-Raum" => 0,
    "Gästebuch" => 0
];

$total = 0;

// Zählen der Besucher pro Raum
if(isset($data['visitors']) && is_array($data['visitors'])){
    foreach($data['visitors'] as $visitor){
        if(isset($visitor['room']) && isset($rooms[$visitor['room']])){
            $rooms[$visitor['room']]++;
            $total++;
        }
    }
}

echo json_encode([
    'total' => $total,
    'rooms' => $rooms
]);
