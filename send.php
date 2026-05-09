<?php
// --- KONFIGURACJA ---
$to = "lubiekasynoezez@gmail.com"; // <--- TUTAJ WPISZ SWÓJ ADRES MAILOWY!
// --------------------

if ($_SERVER["REQUEST_METHOD"] == "POST") {
    $name = strip_tags(trim($_POST["name"]));
    $email = filter_var(trim($_POST["email"]), FILTER_SANITIZE_EMAIL);
    $reason = $_POST["reason"];
    $message = trim($_POST["message"]);

    if (empty($name) || empty($message) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        echo "Błąd danych. Spróbuj ponownie.";
        exit;
    }

    $subject = "NOWA WIADOMOŚĆ: $reason (od $name)";
    
    $email_content = "Imię: $name\n";
    $email_content .= "Email: $email\n";
    $email_content .= "Cel: $reason\n\n";
    $email_content .= "Wiadomość:\n$message\n";

    $headers = "From: kontakt@lecimyszacunek.pl\r\n"; // Musi być w domenie home.pl
    $headers .= "Reply-To: $email";

    if (mail($to, $subject, $email_content, $headers)) {
        echo "<h1>WIADOMOŚĆ WYSŁANA. WRACAJ NA STRONĘ.</h1>";
        echo "<a href='home.html' style='color:#00ff88'>POWRÓT</a>";
    } else {
        echo "Serwer home.pl odrzucił żądanie. Sprawdź konfigurację PHP.";
    }
} else {
    echo "Dostęp zabroniony.";
}
?>
