<?php
// room_counts.php
header('Content-Type: application/json');

// Räume definieren
$rooms = [
    'Bibliothek' => 'bibliothek',
    'Resonanzraum' => 'resonanzraum',
    'Chi-Sternenübung' => 'sternenuebung',
    'Meditationsraum' => 'meditationsraum',
    'KI-Raum' => 'ki-raum',
    'Gästebuch' => 'gaestebuch'
];

$file = 'visitor_data.json';

// Daten laden
if(file_exists($file)){
    $data = json_decode(file_get_contents($file), true);
}else{
    $data = ['rooms'=>[], 'total'=>0];
}

// Jeden Raum, falls nicht vorhanden, initialisieren
foreach($rooms as $name => $slug){
    if(!isset($data['rooms'][$slug])){
        $data['rooms'][$slug] = 0;
    }
}

// Neuer Besuch zählt für alle Räume, die aktuell angezeigt werden
foreach($rooms as $name => $slug){
    $data['rooms'][$slug] += 1;
}
$data['total'] += 1;

// Speichern
file_put_contents($file, json_encode($data));

// Ausgabe
echo json_encode($data);
?>
