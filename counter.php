<?php
header('Content-Type: application/json');

// Datei, in der die Besucher gespeichert werden
$file = 'visitors.txt';

// Falls Datei nicht existiert → mit 0 starten
if (!file_exists($file)) {
    file_put_contents($file, "0");
}

// aktuellen Zähler lesen
$count = intval(file_get_contents($file));

// bei jedem Aufruf +1
$count++;

// neuen Wert speichern
file_put_contents($file, $count);

// Rückgabe an die Webseite
echo json_encode(["visitors" => $count]);
