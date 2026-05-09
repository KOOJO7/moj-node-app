const express = require('express');
const session = require('express-session');
const path = require('path');
const app = express();

// 🔑 hasło z Render (Environment Variable)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// ❗ zabezpieczenie — bez hasła serwer się nie odpali
if (!ADMIN_PASSWORD) {
    console.error("Brak ADMIN_PASSWORD!");
    process.exit(1);
}

app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'cypek_secret_2026',
    resave: false,
    saveUninitialized: false
}));

// ─── PUBLICZNE (bez logowania) ───────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/home', (req, res) => {
    res.sendFile(path.join(__dirname, 'home.html'));
});

app.get('/page3', (req, res) => {
    res.sendFile(path.join(__dirname, 'page3.html'));
});

app.get('/kontakt', (req, res) => {
    res.sendFile(path.join(__dirname, 'kontakt.html'));
});

// ─── LOGOWANIE ───────────────────────────────────────────────
app.post('/login', (req, res) => {
    if (req.body.pass === ADMIN_PASSWORD) {
        req.session.authenticated = true;
        res.sendStatus(200);
    } else {
        res.sendStatus(401);
    }
});

// ─── CHRONIONE (tylko po zalogowaniu) ────────────────────────
app.get('/panel', (req, res) => {
    if (req.session.authenticated) {
        res.sendFile(path.join(__dirname, 'panel.html'));
    } else {
        res.redirect('/');
    }
});

// ─── WYLOGOWANIE ─────────────────────────────────────────────
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// ─── FALLBACK — nieznany URL → strona główna ─────────────────
app.use((req, res) => {
    res.redirect('/home');
});

// ─── START ───────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SERVER DZIAŁA na porcie ${PORT}`));
