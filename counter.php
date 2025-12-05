<?php
// Datei für den Counter
$counterFile = "global_counter.txt";

// Falls Datei nicht existiert → anlegen mit 0
if (!file_exists($counterFile)) {
    file_put_contents($counterFile, "0");
}

// aktuellen Wert lesen
$count = (int)file_get_contents($counterFile);

// um 1 erhöhen
$count++;

// neuen Wert zurückspeichern
file_put_contents($counterFile, $count);

// JSON-Ausgabe für JavaScript
header("Content-Type: application/json");
echo json_encode(["count" => $count]);
?>