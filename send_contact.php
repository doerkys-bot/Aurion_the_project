<?php
// Empfänger-E-Mail (hier deine echte Mailadresse einsetzen)
$to = "doerkys@gmail";

// Formulardaten abholen
$name = htmlspecialchars($_POST['name']);
$email = htmlspecialchars($_POST['email']);
$message = htmlspecialchars($_POST['message']);

// Betreff der E-Mail
$subject = "Neue Nachricht von Aurion-Kontakt";

// Nachricht zusammenbauen
$body = "Name: $name\n";
$body .= "E-Mail: $email\n\n";
$body .= "Nachricht:\n$message\n";

// Zusätzliche Header
$headers = "From: $email\r\n";
$headers .= "Reply-To: $email\r\n";

// E-Mail senden
if(mail($to, $subject, $body, $headers)){
    echo "<h2>Danke! Deine Nachricht wurde gesendet.</h2>";
    echo "<p><a href='kontakt.html'>Zurück zum Kontaktformular</a></p>";
} else {
    echo "<h2>Fehler beim Senden der Nachricht.</h2>";
    echo "<p>Bitte versuche es später erneut.</p>";
}
?>
