const express = require('express');
const session = require('express-session');
const path = require('path');
const nodemailer = require('nodemailer');
const app = express();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) { 
    console.error("Brak ADMIN_PASSWORD!"); 
    process.exit(1);
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'cypek_secret_2026',
    resave: false,
    saveUninitialized: false
}));

// STATIC ROUTES
app.get('/',        (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/home',    (req, res) => res.sendFile(path.join(__dirname, 'home.html')));
app.get('/page3',   (req, res) => res.sendFile(path.join(__dirname, 'page3.html')));
app.get('/kontakt', (req, res) => res.sendFile(path.join(__dirname, 'kontakt.html')));

// LOGIN
app.post('/login', (req, res) => {
    console.log('Login attempt');
    if (req.body.pass === ADMIN_PASSWORD) { 
        req.session.authenticated = true; 
        res.sendStatus(200);
    } else {
        res.sendStatus(401);
    }
});

// PANEL (protected)
app.get('/panel', (req, res) => {
    if (req.session.authenticated) {
        res.sendFile(path.join(__dirname, 'panel.html'));
    } else {
        res.redirect('/');
    }
});

// LOGOUT
app.get('/logout', (req, res) => { 
    req.session.destroy(() => res.redirect('/')); 
});

// ─── SEND EMAIL ────────────────────────────────────────────────
// Dla testów - symulacja (jeśli brak zmiennych)
const USE_FAKE_MAIL = !process.env.GMAIL_USER || !process.env.GMAIL_PASS;

app.post('/send-email', async (req, res) => {
    console.log('=== /send-email called ===');
    console.log('Body:', req.body);
    
    const { name, email, reason, message } = req.body;

    if (!name || !email || !message) {
        console.log('Missing fields');
        return res.status(400).send(`
            <!DOCTYPE html>
            <html>
            <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
            <title>BŁĄD</title>
            <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Bebas+Neue&display=swap" rel="stylesheet">
            <style>
                body{background:#0a0a0a;color:#e0e0e0;font-family:'Share Tech Mono',monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
                .box{text-align:center;padding:40px;border:1px solid #ff3c3c;max-width:380px}
                h1{color:#ff3c3c;font-family:'Bebas Neue',letter-spacing:4px}
                a{color:#00ff88}
            </style>
            </head>
            <body><div class="box"><h1>BŁĄD</h1><p>Wypełnij wszystkie pola!</p><a href="/kontakt">← WRÓĆ</a></div></body>
            </html>
        `);
    }

    const reasonLabels = {
        'problem_zakup': 'Problem z zakupem',
        'zakup_towaru':  'Chce kupić towar',
        'sad':           'Jak uniknąć sprawy sądowej',
        'tluste_plecy':  'Tłuste plecy Warmia/Mazury',
        'inne':          'Inne (bez sensu)'
    };

    // FAKE MAIL MODE (dla testów bez Gmail config)
    if (USE_FAKE_MAIL) {
        console.log('⚠️ URUCHOMIONO TRYB FAKE MAIL (brak GMAIL_USER/GMAIL_PASS)');
        console.log(`📧 [FAKE] Wiadomość od: ${name} <${email}>`);
        console.log(`📧 [FAKE] Temat: ${reasonLabels[reason] || reason}`);
        console.log(`📧 [FAKE] Treść: ${message}`);
        
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
            <title>WYSŁANO (TEST)</title>
            <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Bebas+Neue&display=swap" rel="stylesheet">
            <style>
                body{background:#0a0a0a;color:#e0e0e0;font-family:'Share Tech Mono',monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
                .box{text-align:center;padding:40px;border:1px solid #ffaa00;max-width:380px}
                h1{color:#ffaa00;font-family:'Bebas Neue',letter-spacing:4px}
                .warning{color:#ffaa00;font-size:10px;margin-top:20px}
                a{color:#00ff88}
            </style>
            </head>
            <body><div class="box"><h1>WYSŁANO (TRYB TEST)</h1><p>Wiadomość została zapisana w logach serwera.</p><p><strong>${name}</strong>, dziękujemy za kontakt!</p><div class="warning">⚠️ Skonfiguruj GMAIL_USER i GMAIL_PASS na Renderze żeby wysyłać prawdziwe maile.</div><br><a href="/home">← POWRÓT</a></div></body>
            </html>
        `);
    }

    // PRAWIDŁOWY MAIL (z Gmail)
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_PASS
        },
        // Timeout ustawienia
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000
    });

    try {
        console.log('Próba wysłania maila przez Gmail...');
        
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

        console.log('Mail wysłany pomyślnie!');
        
        res.send(`<!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>WYSŁANO</title>
        <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Bebas+Neue&display=swap" rel="stylesheet">
        <style>
            body{background:#0a0a0a;color:#e0e0e0;font-family:'Share Tech Mono',monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
            .box{text-align:center;padding:40px;border:1px solid #1e1e1e;max-width:380px}
            h1{font-family:'Bebas Neue';font-size:3rem;color:#00ff88;letter-spacing:4px}
            a{display:inline-block;padding:12px 24px;border:1px solid #00ff88;color:#00ff88;text-decoration:none;font-size:11px;letter-spacing:3px}
            a:hover{background:#00ff88;color:#000}
        </style>
        </head>
        <body><div class="box"><h1>WYSŁANO!</h1><p>TRANSMISJA DOTARŁA DO BAZY</p><a href="/home">← POWRÓT</a></div></body>
        </html>`);

    } catch (err) {
        console.error('Mail error:', err);
        res.status(500).send(`<!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>BŁĄD</title>
        <style>
            body{background:#0a0a0a;font-family:monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
            .box{text-align:center;padding:40px;border:1px solid #ff3c3c;max-width:380px}
            h1{color:#ff3c3c;font-family:'Bebas Neue'}
            a{color:#00ff88}
        </style>
        </head>
        <body><div class="box"><h1>BŁĄD</h1><p>Nie udało się wysłać wiadomości.</p><p style="color:#333;font-size:9px">${err.message}</p><a href="/kontakt">← WRÓĆ</a></div></body>
        </html>`);
    }
});

// CATCH ALL - redirect to home
app.use((req, res) => res.redirect('/home'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SERVER DZIAŁA na porcie ${PORT}`));
