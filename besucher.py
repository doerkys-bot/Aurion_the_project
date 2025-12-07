<?php
header('Content-Type: application/json');

// Datei, in der die Zahl gespeichert wird
$file = 'counter.txt';

// Wenn Datei nicht existiert, erstellen
if(!file_exists($file)) {
    file_put_contents($file, "0");
}

// Aktuelle Zahl laden
$count = intval(file_get_contents($file));

// Erhöhen um +1
$count++;

// Zahl speichern
file_put_contents($file, strval($count));

// Ausgabe an Browser/JS
echo json_encode([
    "success" => true,
    "visitors" => $count
]);
?>