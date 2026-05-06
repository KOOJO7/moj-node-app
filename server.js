const express = require('express');
const session = require('express-session');
const path = require('path');
const app = express();

app.use(express.json());
app.use(session({
    secret: 'twoj-bardzo-dlugi-sekretny-klucz', // zmień to na cokolwiek
    resave: false,
    saveUninitialized: true
}));

// TWOJE HASŁO
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Logowanie
app.post('/login', (req, res) => {
    if (req.body.pass === ADMIN_PASSWORD) {
        req.session.authenticated = true;
        res.sendStatus(200);
    } else {
        res.sendStatus(401);
    }
});

// Strażnik panelu - jeśli nie jesteś zalogowany, wywali Cię do logowania
app.get('/panel', (req, res) => {
    if (req.session.authenticated) {
        res.sendFile(path.join(__dirname, 'panel.html'));
    } else {
        res.redirect('/');
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('CYPEK SYSTEM READY'));
