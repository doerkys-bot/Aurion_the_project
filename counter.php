<?php
// Datei mit aktuellem Stand
$file = "counter.txt";

// Falls Datei nicht existiert → neu erstellen
if (!file_exists($file)) {
    file_put_contents($file, "0");
}

// Zahl lesen
$count = (int)file_get_contents($file);

// +1 erhöhen
$count++;

// Zahl speichern
file_put_contents($file, $count);

// Zahl ausgeben
echo $count;
?>
