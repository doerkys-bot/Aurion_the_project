<?php
// room_counts.php
header('Content-Type: application/json');

// Datei mit Besucher-Infos
$filename = 'visitors.json';

// Prüfen, ob Datei existiert
if(!file_exists($filename)){
    $data = [
        'total' => 0,
        'rooms' => [
            'Bibliothek'=>0,
            'Resonanzraum'=>0,
            'Chi-Sternenübung'=>0,
            'Meditationsraum'=>0,
            'KI-Raum'=>0,
            'Gästebuch'=>0
        ]
    ];
    file_put_contents($filename, json_encode($data));
    echo json_encode($data);
    exit;
}

// Besucher-Daten laden
$data = json_decode(file_get_contents($filename), true);
$total = 0;
$rooms_count = [
    'Bibliothek'=>0,
    'Resonanzraum'=>0,
    'Chi-Sternenübung'=>0,
    'Meditationsraum'=>0,
    'KI-Raum'=>0,
    'Gästebuch'=>0
];

// Besucher zählen
if(isset($data['visitors']) && is_array($data['visitors'])){
    foreach($data['visitors'] as $v){
        if(isset($v['room']) && isset($rooms_count[$v['room']])){
            $rooms_count[$v['room']]++;
            $total++;
        }
    }
}

// Antwort als JSON
echo json_encode([
    'total' => $total,
    'rooms' => $rooms_count
]);
