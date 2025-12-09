<?php
$file = "counter.txt";
$ua = strtolower($_SERVER['HTTP_USER_AGENT']);
$bots = ["bot", "crawl", "spider", "slurp", "curl", "wget", "python", "headless"];

// Bots nicht zählen
foreach ($bots as $b) {
    if (strpos($ua, $b) !== false) {
        echo file_exists($file) ? file_get_contents($file) : "0";
        exit;
    }
}

if (!file_exists($file)) {
    file_put_contents($file, "0");
}

$count = (int) file_get_contents($file);
$count++;
file_put_contents($file, $count, LOCK_EX);

echo $count;
?>
