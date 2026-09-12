const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const app = express();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const IS_PROD = process.env.NODE_ENV === 'production';

if (!ADMIN_PASSWORD) {
    console.error('Brak ADMIN_PASSWORD w zmiennych środowiskowych.');
    process.exit(1);
}
if (!SESSION_SECRET) {
    console.error('Brak SESSION_SECRET w zmiennych środowiskowych.');
    process.exit(1);
}

// Jeśli appka stoi za reverse proxy (Render/Railway/Fly/nginx itp.) — trzeba to
// zadeklarować, inaczej ciasteczko "secure" i req.ip nie działają poprawnie.
app.set('trust proxy', 1);
// Nie zdradzamy na zewnątrz, że to Express — mało istotne, ale to darmowa opłata
// za bycie o jeden krok mniej przewidywalnym dla automatycznych skanerów.
app.disable('x-powered-by');

app.use(express.json({ limit: '10kb' }));
app.use(session({
    name: 'sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: IS_PROD,               // wymaga HTTPS na produkcji
        maxAge: 12 * 60 * 60 * 1000    // sesja wygasa po 12h nieaktywności
    }
}));

// Kilka podstawowych nagłówków bezpieczeństwa — nic nie kosztuje, a odcina
// całe klasy prostych ataków (clickjacking, MIME sniffing).
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
});

function requireAuthPage(req, res, next) {
    // Strony za logowaniem NIGDY nie mogą być cache'owane przez przeglądarkę —
    // inaczej po Wylogowaniu przycisk "wstecz" (albo bfcache) potrafi pokazać
    // starą, zapisaną w pamięci wersję panelu, mimo że sesja już nie istnieje.
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    if (req.session && req.session.authenticated) return next();
    return res.redirect('/');
}
function requireAuthApi(req, res, next) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.session && req.session.authenticated) return next();
    return res.status(401).json({ error: 'Brak autoryzacji' });
}

// Tylko te dwa pliki są publiczne — reszta idzie przez jawne, chronione trasy
const PUBLIC_FILES = new Set(['/style.css', '/icon.png', '/app.js']);
app.use((req, res, next) => {
    if (req.method === 'GET' && PUBLIC_FILES.has(req.path)) {
        return res.sendFile(path.join(__dirname, req.path));
    }
    next();
});

// ─── PROSTY LIMIT PRÓB LOGOWANIA (brute-force) ────────────
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const loginAttempts = new Map(); // ip -> { count, resetAt }

function loginRateLimited(req, res, next) {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const rec = loginAttempts.get(ip);
    if (!rec || now > rec.resetAt) {
        loginAttempts.set(ip, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
    }
    const current = loginAttempts.get(ip);
    if (current.count >= LOGIN_MAX_ATTEMPTS) {
        const waitMin = Math.ceil((current.resetAt - now) / 60000);
        return res.status(429).json({ error: `Za dużo prób. Spróbuj za ~${waitMin} min.` });
    }
    next();
}

function timingSafeEquals(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    // Bufory muszą mieć tę samą długość dla timingSafeEqual — dopełniamy,
    // żeby sama długość hasła też nie przeciekała przez czas odpowiedzi.
    if (bufA.length !== bufB.length) {
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

// Sprzątanie starych wpisów licznika logowań, żeby mapa nie rosła bez końca
setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of loginAttempts) {
        if (now > rec.resetAt) loginAttempts.delete(ip);
    }
}, LOGIN_WINDOW_MS).unref();

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
    const { type, amount, note, market } = req.body;
    if (!['trade', 'deposit'].includes(type)) {
        return res.status(400).json({ error: 'Zły typ wpisu' });
    }
    const amt = Math.round(parseFloat(amount) * 100) / 100;
    if (!isFinite(amt) || amt === 0) {
        return res.status(400).json({ error: 'Podaj poprawną, niezerową kwotę' });
    }
    if (note && String(note).length > 200) {
        return res.status(400).json({ error: 'Notatka za długa' });
    }
    if (market && String(market).length > 24) {
        return res.status(400).json({ error: 'Nazwa rynku za długa' });
    }

    const data = loadCapital();
    data.currentCapital = Math.round((data.currentCapital + amt) * 100) / 100;

    const entry = {
        id: Date.now(),
        date: new Date().toISOString(),
        type,
        amount: amt,
        note: (note || '').toString().trim(),
        market: (market || '').toString().trim().slice(0, 24),
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
app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    // Jeśli ktoś ma już ważną sesję i wejdzie na stronę logowania — od razu do panelu,
    // zamiast każąc mu drugi raz podawać hasło.
    if (req.session && req.session.authenticated) return res.redirect('/panel');
    res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/panel', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'panel.html')));
app.get('/zapis', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'zapis.html')));
app.get('/prognoza', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'prognoza.html')));

app.post('/login', loginRateLimited, (req, res) => {
    const ip = req.ip || 'unknown';
    const pass = req.body && req.body.pass;

    if (typeof pass === 'string' && pass.length > 0 && timingSafeEquals(pass, ADMIN_PASSWORD)) {
        loginAttempts.delete(ip);
        // Regeneracja ID sesji przy logowaniu — bez tego stary, znany z góry ID
        // sesji (np. podrzucony ofierze przed zalogowaniem) mógłby zostać po prostu
        // "przejęty" przez uwierzytelnienie (tzw. session fixation).
        req.session.regenerate(err => {
            if (err) return res.sendStatus(500);
            req.session.authenticated = true;
            res.sendStatus(200);
        });
        return;
    }

    const rec = loginAttempts.get(ip) || { count: 0, resetAt: Date.now() + LOGIN_WINDOW_MS };
    rec.count += 1;
    loginAttempts.set(ip, rec);
    res.sendStatus(401);
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('sid');
        res.redirect('/');
    });
});

app.use((req, res) => res.redirect('/'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Nasłuchuję na porcie ${PORT}`));
