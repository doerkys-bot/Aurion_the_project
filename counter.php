<?php
$counterFile = "counter.txt";

// Datei anlegen, falls nicht vorhanden
if (!file_exists($counterFile)) {
    file_put_contents($counterFile, "0");
}

// aktuellen Stand lesen
$count = (int) file_get_contents($counterFile);

// +1 erhöhen
$count++;

// sicher speichern
file_put_contents($counterFile, $count, LOCK_EX);

// für JavaScript ausgeben
echo $count;
?>
