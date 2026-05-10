const express = require('express');
const session = require('express-session');
const path = require('path');
const nodemailer = require('nodemailer');
const app = express();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) { console.error("Brak ADMIN_PASSWORD!"); process.exit(1); }

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'cypek_secret_2026',
    resave: false,
    saveUninitialized: false
}));

app.get('/',        (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/home',    (req, res) => res.sendFile(path.join(__dirname, 'home.html')));
app.get('/page3',   (req, res) => res.sendFile(path.join(__dirname, 'page3.html')));
app.get('/kontakt', (req, res) => res.sendFile(path.join(__dirname, 'kontakt.html')));

// ─── MAIL przez Gmail ─────────────────────────────────────────
// Na Render dodaj zmienne środowiskowe:
//   GMAIL_USER = twój@gmail.com
//   GMAIL_PASS = App Password z Google (nie zwykłe hasło!)
//   MAIL_TO    = adres na który chcesz dostawać maile
//
// App Password generujesz tu:
//   myaccount.google.com → Security → 2-Step Verification → App passwords
app.post('/send-email', async (req, res) => {
    const { name, email, reason, message } = req.body;

    if (!name || !email || !message) {
        return res.status(400).send('<p style="font-family:monospace;color:#ff3c3c">Wypełnij wszystkie pola. <a href="/kontakt" style="color:#00ff88">Wróć</a></p>');
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_PASS
        }
    });

    const reasonLabels = {
        'problem_zakup': 'Problem z zakupem',
        'zakup_towaru':  'Chce kupić towar',
        'sad':           'Jak uniknąć sprawy sądowej',
        'tluste_plecy':  'Tłuste plecy Warmia/Mazury',
        'inne':          'Inne (bez sensu)'
    };

    try {
        await transporter.sendMail({
            from: `"CYPEK KONTAKT" <${process.env.GMAIL_USER}>`,
            to: process.env.MAIL_TO || process.env.GMAIL_USER,
            replyTo: email,
            subject: `[lecimyszacunek.pl] ${reasonLabels[reason] || reason} — ${name}`,
            html: `<div style="font-family:monospace;background:#0a0a0a;color:#e0e0e0;padding:30px">
                <h2 style="color:#00ff88">NOWA TRANSMISJA</h2>
                <p><b style="color:#3cf">OD:</b> ${name}</p>
                <p><b style="color:#3cf">MAIL:</b> <a href="mailto:${email}" style="color:#00ff88">${email}</a></p>
                <p><b style="color:#3cf">CEL:</b> ${reasonLabels[reason] || reason}</p>
                <hr style="border-color:#333;margin:20px 0">
                <p style="line-height:1.8;color:#aaa">${message.replace(/\n/g,'<br>')}</p>
            </div>`
        });

        res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>WYSŁANO</title>
        <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Bebas+Neue&display=swap" rel="stylesheet">
        <style>body{background:#0a0a0a;color:#e0e0e0;font-family:'Share Tech Mono',monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background-image:repeating-linear-gradient(0deg,transparent,transparent 39px,#111 39px,#111 40px),repeating-linear-gradient(90deg,transparent,transparent 39px,#111 39px,#111 40px)}.box{text-align:center;padding:40px;border:1px solid #1e1e1e;max-width:380px}h1{font-family:'Bebas Neue';font-size:3rem;color:#00ff88;letter-spacing:4px;margin-bottom:10px}p{color:#444;font-size:11px;letter-spacing:2px;margin-bottom:30px}a{display:inline-block;padding:12px 24px;border:1px solid #00ff88;color:#00ff88;text-decoration:none;font-size:11px;letter-spacing:3px}a:hover{background:#00ff88;color:#000}</style>
        </head><body><div class="box"><h1>WYSŁANO!</h1><p>TRANSMISJA DOTARŁA DO BAZY</p><a href="/home">← POWRÓT</a></div></body></html>`);

    } catch (err) {
        console.error('Mail error:', err);
        res.status(500).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>BŁĄD</title><style>body{background:#0a0a0a;font-family:monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}.box{text-align:center;padding:40px;border:1px solid #ff3c3c;max-width:380px}h1{color:#ff3c3c}p{color:#666;font-size:11px;margin:10px 0}a{color:#00ff88}</style>
        </head><body><div class="box"><h1>BŁĄD</h1><p>Sprawdź GMAIL_USER i GMAIL_PASS na Render</p><p style="color:#333;font-size:9px">${err.message}</p><a href="/kontakt">← WRÓĆ</a></div></body></html>`);
    }
});

app.post('/login', (req, res) => {
    if (req.body.pass === ADMIN_PASSWORD) { req.session.authenticated = true; res.sendStatus(200); }
    else res.sendStatus(401);
});

app.get('/panel', (req, res) => {
    if (req.session.authenticated) res.sendFile(path.join(__dirname, 'panel.html'));
    else res.redirect('/');
});

app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect('/')); });

app.use((req, res) => res.redirect('/home'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SERVER DZIAŁA na porcie ${PORT}`));
