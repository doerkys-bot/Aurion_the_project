<?php
header("Content-Type: application/json");

// Pfad zur JSON-Datei
$file = __DIR__ . "/visitors.json";

// Wenn Datei nicht existiert -> neu erstellen
if (!file_exists($file)) {
    file_put_contents($file, json_encode(["total" => 0, "unique" => []], JSON_PRETTY_PRINT));
}

$data = json_decode(file_get_contents($file), true);

// Falls korrupt: reparieren
if (!is_array($data)) {
    $data = ["total" => 0, "unique" => []];
}

// Besucher-IP
$ip = $_SERVER["REMOTE_ADDR"];

// Gesamtbesuche +1
$data["total"] += 1;

// Wenn IP neu → zu unique hinzufügen
if (!in_array($ip, $data["unique"])) {
    $data["unique"][] = $ip;
}

// Speichern
file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT));

// Rückgabe an JavaScript
echo json_encode([
    "visits" => $data["total"],
    "unique" => count($data["unique"])
]);
