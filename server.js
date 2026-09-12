const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const app = express();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!ADMIN_PASSWORD) {
    console.error('Brak ADMIN_PASSWORD w zmiennych środowiskowych.');
    process.exit(1);
}
if (!SESSION_SECRET) {
    console.error('Brak SESSION_SECRET w zmiennych środowiskowych.');
    process.exit(1);
}

app.use(express.json());
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' }
}));

function requireAuthPage(req, res, next) {
    if (req.session && req.session.authenticated) return next();
    return res.redirect('/');
}
function requireAuthApi(req, res, next) {
    if (req.session && req.session.authenticated) return next();
    return res.status(401).json({ error: 'Brak autoryzacji' });
}

// Tylko te dwa pliki są publiczne — reszta idzie przez jawne, chronione trasy
const PUBLIC_FILES = new Set(['/style.css', '/icon.png']);
app.use((req, res, next) => {
    if (req.method === 'GET' && PUBLIC_FILES.has(req.path)) {
        return res.sendFile(path.join(__dirname, req.path));
    }
    next();
});

// ─── KAPITAŁ ───────────────────────────────────────────────
const CAPITAL_FILE = path.join(__dirname, 'capital.json');
const STARTING_CAPITAL = 29.18;
let lastGoodCapital = null;

function loadCapital() {
    try {
        const raw = fs.readFileSync(CAPITAL_FILE, 'utf8');
        const data = JSON.parse(raw);
        lastGoodCapital = data;
        return data;
    } catch (e) {
        if (e.code === 'ENOENT') {
            const init = { startingCapital: STARTING_CAPITAL, currentCapital: STARTING_CAPITAL, entries: [] };
            saveCapital(init);
            return init;
        }
        // Plik istnieje, ale jest nieczytelny/uszkodzony — NIE wolno go nadpisać domyślnym stanem,
        // bo to skasowałoby całą historię. Zachowujemy kopię i oddajemy ostatni znany dobry stan.
        console.error('capital.json jest uszkodzony, zostawiam plik bez zmian:', e.message);
        try { fs.copyFileSync(CAPITAL_FILE, CAPITAL_FILE + '.corrupt-' + Date.now()); } catch (_) {}
        return lastGoodCapital || { startingCapital: STARTING_CAPITAL, currentCapital: STARTING_CAPITAL, entries: [] };
    }
}

function saveCapital(data) {
    // Zapis atomowy: najpierw do pliku tymczasowego, potem podmiana — zero ryzyka
    // połowicznego zapisu, nawet jeśli proces padnie w trakcie.
    const tmp = CAPITAL_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, CAPITAL_FILE);
    lastGoodCapital = data;
}

app.get('/api/capital', requireAuthApi, (req, res) => {
    res.json(loadCapital());
});

app.post('/api/capital/entry', requireAuthApi, (req, res) => {
    const { type, amount, note } = req.body;
    if (!['trade', 'deposit'].includes(type)) {
        return res.status(400).json({ error: 'Zły typ wpisu' });
    }
    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (isNaN(amt) || amt === 0) {
        return res.status(400).json({ error: 'Podaj poprawną, niezerową kwotę' });
    }
    if (note && String(note).length > 200) {
        return res.status(400).json({ error: 'Notatka za długa' });
    }

    const data = loadCapital();
    data.currentCapital = Math.round((data.currentCapital + amt) * 100) / 100;

    const entry = {
        id: Date.now(),
        date: new Date().toISOString(),
        type,
        amount: amt,
        note: (note || '').toString().trim(),
        balanceAfter: data.currentCapital
    };
    data.entries.push(entry);
    if (data.entries.length > 2000) data.entries.shift();

    saveCapital(data);
    res.json(data);
});

app.delete('/api/capital/entry/:id', requireAuthApi, (req, res) => {
    const data = loadCapital();
    if (data.entries.length === 0) {
        return res.status(400).json({ error: 'Brak wpisów do cofnięcia' });
    }
    const last = data.entries[data.entries.length - 1];
    if (String(last.id) !== req.params.id) {
        return res.status(400).json({ error: 'Można cofnąć tylko ostatni wpis' });
    }
    data.entries.pop();
    data.currentCapital = Math.round((data.currentCapital - last.amount) * 100) / 100;
    saveCapital(data);
    res.json(data);
});

// ─── STRONY ────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/panel', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'panel.html')));
app.get('/zapis', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'zapis.html')));
app.get('/prognoza', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'prognoza.html')));

app.post('/login', (req, res) => {
    if (req.body.pass === ADMIN_PASSWORD) {
        req.session.authenticated = true;
        res.sendStatus(200);
    } else {
        res.sendStatus(401);
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

app.use((req, res) => res.redirect('/'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Nasłuchuję na porcie ${PORT}`));
