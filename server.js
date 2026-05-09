const express = require('express');
const session = require('express-session');
const path = require('path');
const nodemailer = require('nodemailer'); // <--- MUSISZ TO DODAĆ NA GÓRZE
const app = express();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
    console.error("Brak ADMIN_PASSWORD!");
    process.exit(1);
}

// Obsługa danych z formularzy (ważne, żeby mail zadziałał!)
app.use(express.urlencoded({ extended: true })); 
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || 'cypek_secret_2026',
    resave: false,
    saveUninitialized: false
}));

// ─── PUBLICZNE TRASY ─────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/home', (req, res) => res.sendFile(path.join(__dirname, 'home.html')));
app.get('/page3', (req, res) => res.sendFile(path.join(__dirname, 'page3.html')));
app.get('/kontakt', (req, res) => res.sendFile(path.join(__dirname, 'kontakt.html')));

// ─── OBSŁUGA FORMULARZA KONTAKTOWEGO ─────────────────────────
app.post('/send-email', (req, res) => {
    const { name, email, reason, message } = req.body;

    const transporter = nodemailer.createTransport({
        host: "poczta.home.pl",
        port: 587,
        secure: false, // Port 587 musi mieć secure: false
        auth: {
            user: "kontakt@lecimyszacunek.pl",
            pass: process.env.MAIL_PASS || "11kojo11"
        },
        tls: {
            // To wymusza połączenie nawet jeśli certyfikat wygasł lub jest nieznany
            rejectUnauthorized: false,
            ciphers: 'SSLv3'
        },
        connectionTimeout: 15000 // Zwiększamy do 15s
    });
    const mailOptions = {
        from: 'kontakt@lecimyszacunek.pl',
        to: 'TWÓJ_PRYWATNY_MAIL@gmail.com', // <--- WPISZ SWÓJ GMAIL
        subject: `KONTAKT: ${reason} od ${name}`,
        text: `Od: ${name} (${email})\nCel: ${reason}\n\nWiadomość:\n${message}`
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            return res.status(500).send("Błąd: " + error.toString());
        }
        res.send("<h1>WYSŁANO TRANSMISJĘ!</h1><br><a href='/home' style='color:green; font-family:monospace;'>POWRÓT NA BAZĘ</a>");
    });
});

// ─── LOGOWANIE I RESZTA ──────────────────────────────────────
app.post('/login', (req, res) => {
    if (req.body.pass === ADMIN_PASSWORD) {
        req.session.authenticated = true;
        res.sendStatus(200);
    } else {
        res.sendStatus(401);
    }
});

app.get('/panel', (req, res) => {
    if (req.session.authenticated) {
        res.sendFile(path.join(__dirname, 'panel.html'));
    } else {
        res.redirect('/');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

app.use((req, res) => res.redirect('/home'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SERVER DZIAŁA na porcie ${PORT}`));
