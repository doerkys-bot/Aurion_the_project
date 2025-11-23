<?php

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

require 'PHPMailer.php';
require 'SMTP.php';
require 'Exception.php';

// Formulardaten
$name = htmlspecialchars($_POST['name']);
$email = htmlspecialchars($_POST['email']);
$message = htmlspecialchars($_POST['message']);

// Mailer
$mail = new PHPMailer(true);

try {
    // SMTP
    $mail->isSMTP();
    $mail->Host = 'smtp.gmail.com';       // Beispiel: Gmail
    $mail->SMTPAuth = true;
    $mail->Username = 'DEINE_EMAIL@gmail.com';
    $mail->Password = 'DEIN_APP_PASSWORT'; // Wichtig: Gmail App-Passwort!
    $mail->SMTPSecure = 'tls';
    $mail->Port = 587;

    // Absender, Empfänger
    $mail->setFrom('DEINE_EMAIL@gmail.com', 'Aurion Kontakt');
    $mail->addAddress('DEINE_EMAIL@gmail.com');
    $mail->addReplyTo($email, $name);

    // Inhalt
    $mail->Subject = 'Neue Nachricht von Aurion-Kontakt';
    $mail->Body = "Name: $name\nE-Mail: $email\n\nNachricht:\n$message";

    // Senden
    $mail->send();
    echo "<h2>Danke! Deine Nachricht wurde gesendet.</h2>";
    echo "<p><a href='kontakt.html'>Zurück</a></p>";

} catch (Exception $e) {
    echo "<h2>Fehler beim Senden:</h2>";
    echo $mail->ErrorInfo;
}

?>