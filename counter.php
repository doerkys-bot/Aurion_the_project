<?php
// Datei, die den Zähler speichert
$file = "counter.txt";

// Wenn counter.txt nicht existiert → erstellen mit 0
if (!file_exists($file)) {
    file_put_contents($file, "0");
}

// Besucherzahl laden
$count = (int)file_get_contents($file);

// +1 Besucher
$count++;

// Neue Besucherzahl speichern
file_put_contents($file, $count);

// Als reine Zahl ausgeben
echo $count;
?>
