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
    secret: 'jakis_dlugi_losowy_tekst_123',
    resave: false,
    saveUninitialized: true
}));

// 🔐 logowanie
app.post('/login', (req, res) => {
    if (req.body.pass === ADMIN_PASSWORD) {
        req.session.authenticated = true;
        res.sendStatus(200);
    } else {
        res.sendStatus(401);
    }
});

// 🧠 panel (tylko po zalogowaniu)
app.get('/panel', (req, res) => {
    if (req.session.authenticated) {
        res.sendFile(path.join(__dirname, 'panel.html'));
    } else {
        res.redirect('/');
    }
});

app.get('/home.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'home.html'));
});

// 🚪 wylogowanie
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// 🏠 strona logowania
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 🚀 start serwera (ważne dla Render)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("SERVER DZIAŁA"));
