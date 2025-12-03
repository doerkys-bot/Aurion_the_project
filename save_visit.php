<?php
$data = file_get_contents("php://input");
file_put_contents("aurion_visits.json", $data);
?>
