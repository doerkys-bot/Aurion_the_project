<?php
header("Content-Type: application/json");

// Pfad zur JSON
$file = "visitors.json";

if (!file_exists($file)) {
    file_put_contents($file, json_encode(["total" => 0], JSON_PRETTY_PRINT));
}

$data = json_decode(file_get_contents($file), true);

if (!isset($data["total"])) {
    $data["total"] = 0;
}

$data["total"]++;

file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT));

echo json_encode($data);
?>
