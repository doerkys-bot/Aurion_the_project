<?php
// Pfad zur Token-Datei
$tokenFile = '/storage/emulated/0/aurion/token.json';

// JSON-Datei laden
if(!file_exists($tokenFile)){
    die("Fehler: Token-Datei nicht gefunden.");
}
$tokenData = json_decode(file_get_contents($tokenFile), true);
if(!$tokenData || !isset($tokenData['telegram']['chat_id']) || !isset($tokenData['telegram']['t3'])){
    die("Fehler: Ungültige Token-Datei.");
}

$chat_id = $tokenData['telegram']['chat_id'];
$bot_token = $tokenData['telegram']['t3'];

// Formulardaten abholen
$name = htmlspecialchars($_POST['name'] ?? '');
$email = htmlspecialchars($_POST['email'] ?? '');
$message = htmlspecialchars($_POST['message'] ?? '');

// Nachricht zusammenstellen
$text = "Neue Nachricht von Aurion-Kontakt:\nName: $name\nE-Mail: $email\nNachricht:\n$message";

// Telegram API senden
$url = "https://api.telegram.org/bot$bot_token/sendMessage";
$data = [
    'chat_id' => $chat_id,
    'text' => $text
];

// POST Anfrage mit curl
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_POST, 1);
curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($data));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch);
curl_close($ch);

if($response){
    echo "<h2>Danke! Deine Nachricht wurde gesendet.</h2>";
    echo "<p><a href='kontakt.html'>Zurück zum Kontaktformular</a></p>";
}else{
    echo "<h2>Fehler beim Senden der Nachricht.</h2>";
    echo "<p>Bitte versuche es später erneut.</p>";
}
?>