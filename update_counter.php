<?php
$file = 'visitors.json'; // lokale Datei zur Speicherung
if(!file_exists($file)) {
    file_put_contents($file, json_encode([
        "Bibliothek"=>0,
        "Resonanzraum"=>0,
        "Chi-Sternenübung"=>0,
        "Meditationsraum"=>0,
        "KI-Raum"=>0,
        "Gästebuch"=>0
    ]));
}

$data = json_decode(file_get_contents($file), true);

// Beispiel: aktuelle Seite aus GET-Parameter
$room = $_GET['room'] ?? null;
if($room && isset($data[$room])){
    $data[$room]++;
    file_put_contents($file, json_encode($data));
}

// Rückgabe aller Räume als JSON
header('Content-Type: application/json');
echo json_encode($data);
