<?php
// Datei: counter.php

$counterFile = "counter.txt";

// Falls counter.txt nicht existiert → neu anlegen
if (!file_exists($counterFile)) {
    file_put_contents($counterFile, "1");
    echo "1";
    exit;
}

// Lesen
$count = (int) file_get_contents($counterFile);

// Erhöhen
$count++;

// Schreiben (mit LOCK, damit nichts zerstört wird)
file_put_contents($counterFile, $count, LOCK_EX);

// Ausgabe zurück an JavaScript
echo $count;
?>
