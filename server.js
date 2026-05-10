const express = require('express');
const session = require('express-session');
const path = require('path');
const { Resend } = require('resend');
const app = express();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) { 
    console.error("Brak ADMIN_PASSWORD!"); 
    process.exit(1);
}

// Inicjalizacja Resend
const resend = new Resend(process.env.RESEND_API_KEY);

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
    if (req.body.pass === ADMIN_PASSWORD) { 
        req.session.authenticated = true; 
        res.sendStatus(200);
    } else {
        res.sendStatus(401);
    }
});

// PANEL
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

// ─── SEND EMAIL ───────────────────────────────────────────────
app.post('/send-email', async (req, res) => {
    console.log('=== /send-email called ===');
    const { name, email, reason, message } = req.body;

    if (!name || !email || !message) {
        return res.status(400).send(`
            <!DOCTYPE html>
            <html>
            <head><meta charset="UTF-8">
            <title>BŁĄD</title>
            <style>
                body{background:#0a0a0a;color:#e0e0e0;font-family:monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;}
                .box{text-align:center;padding:40px;border:1px solid #ff3c3c;}
                a{color:#00ff88}
            </style>
            </head>
            <body><div class="box"><h1 style="color:#ff3c3c">BŁĄD</h1><p>Wypełnij wszystkie pola!</p><a href="/kontakt">← WRÓĆ</a></div></body>
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

    // Sprawdź czy Resend jest skonfigurowany
    if (!process.env.RESEND_API_KEY) {
        console.log('⚠️ BRAK RESEND_API_KEY');
        return res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head><meta charset="UTF-8">
            <title>BŁĄD</title>
            <style>
                body{background:#0a0a0a;color:#e0e0e0;font-family:monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;}
                .box{text-align:center;padding:40px;border:1px solid #ffaa00;}
                a{color:#00ff88}
            </style>
            </head>
            <body><div class="box"><h1 style="color:#ffaa00">BŁĄD KONFIGURACJI</h1><p>Brak klucza API. Skontaktuj się z administratorem.</p><a href="/kontakt">← WRÓĆ</a></div></body>
            </html>
        `);
    }

    try {
        const htmlContent = `
            <div style="font-family:monospace;background:#0a0a0a;color:#e0e0e0;padding:30px">
                <h2 style="color:#00ff88">NOWA TRANSMISJA</h2>
                <p><b style="color:#3cf">OD:</b> ${name}</p>
                <p><b style="color:#3cf">EMAIL:</b> ${email}</p>
                <p><b style="color:#3cf">CEL:</b> ${reasonLabels[reason] || reason}</p>
                <hr style="border-color:#333;margin:20px 0">
                <p style="line-height:1.8;color:#aaa">${message.replace(/\n/g,'<br>').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
            </div>
        `;

        // Wysyłka przez Resend
        const { data, error } = await resend.emails.send({
            from: `CYPEK Kontakt <onboarding@resend.dev>`, // Tymczasowo używamy domeny Resend
            to: process.env.MAIL_TO || 'koszojad2131@gmail.com',
            reply_to: email,
            subject: `[lecimyszacunek.pl] ${reasonLabels[reason] || reason} — ${name}`,
            html: htmlContent
        });

        if (error) {
            console.error('Resend error:', error);
            throw new Error(error.message);
        }

        console.log('Mail wysłany! ID:', data?.id);
        
        res.send(`<!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8">
        <title>WYSŁANO</title>
        <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Bebas+Neue&display=swap" rel="stylesheet">
        <style>
            body{background:#0a0a0a;color:#e0e0e0;font-family:'Share Tech Mono',monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
            .box{text-align:center;padding:40px;border:1px solid #1e1e1e;max-width:380px}
            h1{font-family:'Bebas Neue';font-size:3rem;color:#00ff88;letter-spacing:4px}
            a{display:inline-block;padding:12px 24px;border:1px solid #00ff88;color:#00ff88;text-decoration:none;font-size:11px;letter-spacing:3px;margin-top:20px}
            a:hover{background:#00ff88;color:#000}
        </style>
        </head>
        <body><div class="box"><h1>WYSŁANO!</h1><p>TRANSMISJA DOTARŁA DO BAZY</p><a href="/home">← POWRÓT</a></div></body>
        </html>`);

    } catch (err) {
        console.error('Send error:', err);
        res.status(500).send(`<!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8">
        <title>BŁĄD</title>
        <style>
            body{background:#0a0a0a;font-family:monospace;display:flex;align-items:center;justify-content:center;min-height:100vh;}
            .box{text-align:center;padding:40px;border:1px solid #ff3c3c;max-width:380px}
            h1{color:#ff3c3c;font-family:'Bebas Neue';letter-spacing:4px}
            a{color:#00ff88}
        </style>
        </head>
        <body><div class="box"><h1>BŁĄD</h1><p>${err.message}</p><a href="/kontakt">← WRÓĆ</a></div></body>
        </html>`);
    }
});

// CATCH ALL
app.use((req, res) => res.redirect('/home'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SERVER DZIAŁA na porcie ${PORT}`));
