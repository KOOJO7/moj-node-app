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

app.set('trust proxy', 1);
app.disable('x-powered-by');

// CSV import może mieć ~100–500 KB — podnosimy limit JSON
app.use(express.json({ limit: '2mb' }));
app.use(session({
    name: 'sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: IS_PROD,
        maxAge: 12 * 60 * 60 * 1000
    }
}));

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
});

function requireAuthPage(req, res, next) {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    if (req.session && req.session.authenticated) return next();
    return res.redirect('/');
}
function requireAuthApi(req, res, next) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.session && req.session.authenticated) return next();
    return res.status(401).json({ error: 'Brak autoryzacji' });
}

const PUBLIC_FILES = new Set(['/style.css', '/icon.png', '/app.js']);
app.use((req, res, next) => {
    if (req.method === 'GET' && PUBLIC_FILES.has(req.path)) {
        return res.sendFile(path.join(__dirname, req.path));
    }
    next();
});

const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const loginAttempts = new Map();

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
    if (bufA.length !== bufB.length) {
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

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
        console.error('capital.json jest uszkodzony, zostawiam plik bez zmian:', e.message);
        try { fs.copyFileSync(CAPITAL_FILE, CAPITAL_FILE + '.corrupt-' + Date.now()); } catch (_) {}
        return lastGoodCapital || { startingCapital: STARTING_CAPITAL, currentCapital: STARTING_CAPITAL, entries: [] };
    }
}

function saveCapital(data) {
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

// ─── IMPORT CSV Z BROKERA (Trading 212 / podobny eksport) ───
const BROKER_SYMBOL_MAP = {
    TECH100: 'NAS100',
    USA500: 'US500',
    US500: 'US500',
    SPX500: 'US500',
    GER40: 'GER40',
    DE40: 'GER40',
    DAX: 'DAX',
    XAUUSD: 'GOLD',
    GOLD: 'GOLD',
    US30: 'US30',
    DJ30: 'US30',
    UK100: 'UK100',
    FTSE100: 'UK100'
};

function parseCsvLine(line) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
            if (ch === '"') {
                if (line[i + 1] === '"') { cur += '"'; i++; }
                else inQ = false;
            } else cur += ch;
        } else {
            if (ch === '"') inQ = true;
            else if (ch === ',') { out.push(cur); cur = ''; }
            else cur += ch;
        }
    }
    out.push(cur);
    return out;
}

function normalizeBrokerDate(s) {
    if (!s) return null;
    const t = String(s).trim().replace(' ', 'T').replace(/\+00:00$/, 'Z');
    const d = new Date(t);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
}

function parseBrokerCsv(text) {
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) throw new Error('Pusty lub niekompletny plik CSV');

    const headers = parseCsvLine(lines[0]).map(h => h.trim());
    const idx = (name) => headers.indexOf(name);
    const col = {
        recordType: idx('Record Type'),
        date: idx('Date (UTC)'),
        instrument: idx('Instrument'),
        symbol: idx('Symbol'),
        direction: idx('Direction'),
        dateClosed: idx('Date closed (UTC)'),
        totalResult: idx('Total result (account currency)'),
        txType: idx('Transaction type'),
        amount: idx('Amount (account currency)')
    };
    if (col.recordType < 0) throw new Error('To nie wygląda na eksport brokera (brak kolumny Record Type)');

    const raw = [];
    for (let i = 1; i < lines.length; i++) {
        const cells = parseCsvLine(lines[i]);
        const get = (c) => (c >= 0 && c < cells.length ? cells[c].trim() : '');
        const rt = get(col.recordType);

        if (rt === 'Transaction' && get(col.txType) === 'Deposit') {
            const amt = parseFloat(get(col.amount));
            if (!isFinite(amt) || amt === 0) continue;
            const date = normalizeBrokerDate(get(col.date));
            if (!date) continue;
            raw.push({
                date,
                type: 'deposit',
                amount: Math.round(amt * 100) / 100,
                note: 'wpłata z brokera',
                market: ''
            });
        } else if (rt === 'Closed position') {
            const amt = parseFloat(get(col.totalResult));
            if (!isFinite(amt) || amt === 0) continue;
            const date = normalizeBrokerDate(get(col.dateClosed) || get(col.date));
            if (!date) continue;
            const sym = get(col.symbol).toUpperCase();
            const market = (BROKER_SYMBOL_MAP[sym] || sym.replace(/[^A-Z0-9]/g, '').slice(0, 12)) || '';
            const inst = get(col.instrument) || market;
            const direction = get(col.direction);
            const note = (inst + (direction ? ' ' + direction : '')).trim().slice(0, 200);
            raw.push({
                date,
                type: 'trade',
                amount: Math.round(amt * 100) / 100,
                note,
                market
            });
        }
        // Overnight interest: już wliczone w Total result zamkniętej pozycji — pomijamy
    }

    if (raw.length === 0) throw new Error('Nie znaleziono depozytów ani zamkniętych pozycji w pliku');

    raw.sort((a, b) => a.date.localeCompare(b.date));

    let bal = 0;
    const entries = raw.map((e, i) => {
        bal = Math.round((bal + e.amount) * 100) / 100;
        return {
            id: Date.parse(e.date) + i,
            date: e.date,
            type: e.type,
            amount: e.amount,
            note: e.note,
            market: e.market,
            balanceAfter: bal
        };
    });

    const trades = entries.filter(e => e.type === 'trade');
    const deposits = entries.filter(e => e.type === 'deposit');
    const totalTrade = trades.reduce((s, e) => s + e.amount, 0);
    const totalDep = deposits.reduce((s, e) => s + e.amount, 0);

    return {
        startingCapital: 0,
        currentCapital: bal,
        entries,
        summary: {
            deposits: deposits.length,
            trades: trades.length,
            totalDeposits: Math.round(totalDep * 100) / 100,
            totalTrading: Math.round(totalTrade * 100) / 100,
            finalCapital: bal
        }
    };
}

app.post('/api/capital/import-csv', requireAuthApi, (req, res) => {
    try {
        const csv = req.body && req.body.csv;
        if (typeof csv !== 'string' || csv.length < 20) {
            return res.status(400).json({ error: 'Brak treści CSV' });
        }
        if (csv.length > 1.5 * 1024 * 1024) {
            return res.status(400).json({ error: 'Plik za duży (max ~1.5 MB)' });
        }

        const parsed = parseBrokerCsv(csv);
        try {
            const prev = loadCapital();
            fs.writeFileSync(
                CAPITAL_FILE + '.bak-' + Date.now(),
                JSON.stringify(prev, null, 2)
            );
        } catch (_) {}

        const data = {
            startingCapital: parsed.startingCapital,
            currentCapital: parsed.currentCapital,
            entries: parsed.entries
        };
        saveCapital(data);
        res.json({ ok: true, ...data, summary: parsed.summary });
    } catch (e) {
        console.error('import-csv:', e.message);
        res.status(400).json({ error: e.message || 'Błąd importu CSV' });
    }
});

// ─── RYNKI ──────────────────────────────────────────────────
const MARKET_SYMBOLS = {
    US500: '^spx', SPX500: '^spx', SP500: '^spx',
    NAS100: '^ndx', NASDAQ: '^ndx', USTEC: '^ndx',
    DAX: '^dax', DE40: '^dax', GER40: '^dax',
    US30: '^dji', DJ30: '^dji',
    UK100: '^ftse', FTSE100: '^ftse',
    WIG20: '^wig20'
};

const MARKET_CACHE_MS = 60 * 1000;
const marketCache = new Map();

async function getMarketQuote(code) {
    code = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (!code) throw new Error('Brak symbolu rynku');
    const cached = marketCache.get(code);
    if (cached && Date.now() - cached.time < MARKET_CACHE_MS) return cached;
    const symbol = MARKET_SYMBOLS[code] || code.toLowerCase();
    const url = 'https://stooq.com/q/l/?s=' + encodeURIComponent(symbol) + '&f=sd2t2ohlc&h&e=csv';
    const response = await fetch(url, {
        headers: { 'User-Agent': 'lecimyszacunek/1.0' },
        signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`Stooq HTTP ${response.status}`);
    const text = await response.text();
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) throw new Error('Stooq zwrócił pustą odpowiedź');
    const cols = lines[1].split(',');
    const price = Number.parseFloat(cols[6]);
    if (!Number.isFinite(price) || price <= 0) throw new Error('Brak poprawnej ceny dla ' + code);
    const data = { code, symbol, price, time: Date.now(), source: 'stooq' };
    marketCache.set(code, data);
    return data;
}

app.get('/api/market/:code', requireAuthApi, async (req, res) => {
    try {
        const data = await getMarketQuote(req.params.code);
        res.json({ ok: true, ...data });
    } catch (err) {
        console.error(`Błąd pobierania rynku ${req.params.code}:`, err.message);
        res.status(502).json({ ok: false, error: 'Nie udało się pobrać notowania rynku' });
    }
});

// ─── STRONY ────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
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
