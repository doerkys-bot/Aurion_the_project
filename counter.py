<?php
header("Content-Type: application/json; charset=utf-8");

// Dateien
$counterFile = "counter.txt";
$onlineFile  = "online.json";

// Datei für Gesamtzähler anlegen
if (!file_exists($counterFile)) {
    file_put_contents($counterFile, "0");
}

// Datei für Online-IPs anlegen
if (!file_exists($onlineFile)) {
    file_put_contents($onlineFile, json_encode([]));
}

// --- Gesamtzähler ---
$total = (int)file_get_contents($counterFile);
$total++;
file_put_contents($counterFile, $total);

// --- Online-Besucherlogik ---
$onlineData = json_decode(file_get_contents($onlineFile), true);
if (!is_array($onlineData)) $onlineData = [];

// IP des aktuellen Besuchers
$ip = $_SERVER['REMOTE_ADDR'];

// aktueller Zeitstempel
$onlineData[$ip] = time();

// alte Einträge entfernen (nach 60 Sekunden)
$now = time();
foreach ($onlineData as $key => $stamp) {
    if ($now - $stamp > 60) {
        unset($onlineData[$key]);
    }
}

// speichern
file_put_contents($onlineFile, json_encode($onlineData));

// Ausgabe an Browser
echo json_encode([
    "total"  => $total,
    "online" => count($onlineData)
]);
$now = time();
$timeout = 20; // 20 Sekunden gilt als "online"

// Alte Einträge entfernen
$onlineList = [];
if (file_exists($onlineFile)) {
    $lines = file($onlineFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        list($oldIp, $oldTime) = explode("|", $line);
        if ($now - (int)$oldTime <= $timeout) {
            $onlineList[$oldIp] = (int)$oldTime;
        }
    }
}

// Aktuellen Benutzer eintragen/update
$onlineList[$ip] = $now;

// Neue Liste speichern
$data = "";
foreach ($onlineList as $userIp => $timestamp) {
    $data .= $userIp . "|" . $timestamp . "\n";
}
file_put_contents($onlineFile, $data);

// Anzahl online bestimmen
$onlineCount = count($onlineList);

// Ausgabe an Browser
echo json_encode([
    "total" => $total,
    "online" => $onlineCount
]);
?>}

// Aktuelle Zahl einlesen
$count = (int)file_get_contents($counterFile);

// Besucherzahl +1
$count++;

// Neue Zahl wieder speichern
file_put_contents($counterFile, $count);

// JSON-Ausgabe (kann auch im HTML genutzt werden)
<?php
// Dateien
$counterFile = "counter.txt";
$onlineFile = "online.txt";

// --- Besucher gesamt zählen ---
if (!file_exists($counterFile)) {
    file_put_contents($counterFile, "0");
}
$total = (int)file_get_contents($counterFile);
$total++;
file_put_contents($counterFile, $total);

// --- Online-Liste führen ---
$ip = $_SERVER['REMOTE_ADDR'];
$now = time();
$timeout = 20; // 20 Sekunden gilt als "online"

// Alte Einträge entfernen
$onlineList = [];
if (file_exists($onlineFile)) {
    $lines = file($onlineFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        list($oldIp, $oldTime) = explode("|", $line);
        if ($now - (int)$oldTime <= $timeout) {
            $onlineList[$oldIp] = (int)$oldTime;
        }
    }
}

// Aktuellen Benutzer eintragen/update
$onlineList[$ip] = $now;

// Neue Liste speichern
$data = "";
foreach ($onlineList as $userIp => $timestamp) {
    $data .= $userIp . "|" . $timestamp . "\n";
}
file_put_contents($onlineFile, $data);

// Anzahl online bestimmen
$onlineCount = count($onlineList);

// Ausgabe an den Browser
echo json_encode([
    "total" => $total,
    "online" => $onlineCount
]);
?>header("Content-Type: application/json");
echo json_encode(["visitors" => $count]);
?>
