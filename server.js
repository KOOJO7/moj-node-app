const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const app = express();

const db = new Pool({
    host: process.env.PGHOST || '192.168.50.10',
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'trading',
    user: process.env.PGUSER || 'appuser',
    password: process.env.PGPASSWORD,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

// TUTAJ WKLEJ TEN KOD:
async function initCapitalDb() {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const result = await client.query(
            'SELECT id FROM capital_state WHERE id = 1 FOR UPDATE'
        );

        if (result.rowCount === 0) {
            await client.query(
                `INSERT INTO capital_state
                    (id, starting_capital, current_capital)
                 VALUES
                    (1, $1, $1)`,
                [29.18]
            );

            console.log('PostgreSQL: utworzono stan kapitału 29.18');
        } else {
            console.log('PostgreSQL: stan kapitału już istnieje');
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Błąd inicjalizacji PostgreSQL:', err);
        throw err;
    } finally {
        client.release();
    }
}


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
        secure: false,
        maxAge: 12 * 60 * 60 * 1000
    }
}));

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://s3.tradingview.com; font-src 'self' data: https://*.tradingview.com; frame-src https://*.tradingview.com https://*.tradingview-widget.com; connect-src 'self' https://*.tradingview.com https://*.tradingview-widget.com; img-src 'self' data: https://*.tradingview.com https://*.tradingview-widget.com;"
    );
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

const PUBLIC_FILES = new Set([
    '/style.css',
    '/icon.png',
    '/app.js',
    '/pusheen1.png',
    '/pusheen2.png',
    '/pusheen3.png',
    '/pusheen4.png',
    '/pusheen5.png',
    '/pusheen6.png',
    '/att.GW6FYrCmXKO6OgnxWBtsvvtJ1AOoXiRUrpIBLQWwHV4.jpeg'
]);
app.use((req, res, next) => {
    if (req.method === 'GET' && PUBLIC_FILES.has(req.path)) {
        return res.sendFile(path.join(__dirname, req.path));
    }
    next();
});

app.use((req, res, next) => {
    if (
        req.method === 'GET' &&
        /\.(png|jpg|jpeg|gif|webp)$/i.test(req.path)
    ) {
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
        loginAttempts.set(ip, {
            count: 0,
            resetAt: now + LOGIN_WINDOW_MS
        });
    }

    const current = loginAttempts.get(ip);

    if (current.count >= LOGIN_MAX_ATTEMPTS) {
        const waitMin = Math.ceil(
            (current.resetAt - now) / 60000
        );

        return res.status(429).json({
            error: `Za dużo prób. Spróbuj za ~${waitMin} min.`
        });
    }

    next();
}

app.post('/login', loginRateLimited, (req, res) => {
    const pass = typeof req.body?.pass === 'string'
        ? req.body.pass
        : '';

    if (!timingSafeEquals(pass, ADMIN_PASSWORD)) {
        const ip = req.ip || 'unknown';
        const rec = loginAttempts.get(ip) || {
            count: 0,
            resetAt: Date.now() + LOGIN_WINDOW_MS
        };

        rec.count++;
        loginAttempts.set(ip, rec);

        return res.status(401).json({
            error: 'Nieprawidłowe hasło'
        });
    }

    loginAttempts.delete(req.ip || 'unknown');

    req.session.authenticated = true;

    return res.json({ ok: true });
});

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
    const lines = String(text || '')
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .filter(l => l.trim());

    if (lines.length < 2) {
        throw new Error('Pusty lub niekompletny plik CSV');
    }

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

    if (col.recordType < 0) {
        throw new Error('To nie wygląda na eksport brokera (brak kolumny Record Type)');
    }

    if (col.date < 0) {
        throw new Error('Brak kolumny Date (UTC)');
    }

    const raw = [];

    for (let i = 1; i < lines.length; i++) {
        const cells = parseCsvLine(lines[i]);

        const get = (c) => {
            if (c < 0 || c >= cells.length) return '';
            return String(cells[c]).trim();
        };

        const rt = get(col.recordType);

        console.log(
            'CSV RECORD:',
            JSON.stringify({
                recordType: rt,
                txType: get(col.txType),
                amount: get(col.amount),
                totalResult: get(col.totalResult),
                date: get(col.date),
                dateClosed: get(col.dateClosed)
            })
        );

        if (rt === 'Transaction') {
            const txType = get(col.txType);
            let amount = parseFloat(get(col.amount));

            console.log(
                'CSV TRANSACTION:',
                JSON.stringify({
                    date: get(col.date),
                    type: txType,
                    amount: get(col.amount)
                })
            );

            if (!isFinite(amount) || amount === 0) continue;

            const date = normalizeBrokerDate(get(col.date));
            if (!date) continue;

            if (txType === 'Deposit') {
                amount = Math.round(amount * 100) / 100;

                raw.push({
                    date,
                    type: 'deposit',
                    amount,
                    note: 'wpłata z brokera',
                    market: ''
                });

                continue;
            }

            if (txType === 'Withdrawal' || txType === 'Withdraw') {
                amount = Math.abs(amount) * -1;
                amount = Math.round(amount * 100) / 100;

                raw.push({
                    date,
                    type: 'deposit',
                    amount,
                    note: 'wypłata z brokera',
                    market: ''
                });

                continue;
            }

            continue;
        }

        if (rt === 'Overnight interest') {
            console.log(
                'CSV OVERNIGHT:',
                get(col.date),
                get(col.symbol),
                get(col.amount),
                get(col.totalResult)
            );
            continue;
        }

        if (rt === 'Closed position') {
            const amount = parseFloat(get(col.totalResult));

            if (!isFinite(amount) || amount === 0) continue;

            const date = normalizeBrokerDate(
                get(col.dateClosed) || get(col.date)
            );

            if (!date) continue;

            const sym = get(col.symbol).toUpperCase();

            const market =
                (BROKER_SYMBOL_MAP[sym] ||
                    sym.replace(/[^A-Z0-9]/g, '').slice(0, 12)) || '';

            const instrument = get(col.instrument) || market;
            const direction = get(col.direction);

            const note = (
                instrument +
                (direction ? ' ' + direction : '')
            ).trim().slice(0, 200);

            raw.push({
                date,
                type: 'trade',
                amount: Math.round(amount * 100) / 100,
                note,
                market
            });

            continue;
        }
    }

    if (raw.length === 0) {
        throw new Error(
            'Nie znaleziono wpłat, wypłat ani zamkniętych pozycji w pliku'
        );
    }

    raw.sort((a, b) => {
        const timeA = new Date(a.date).getTime();
        const timeB = new Date(b.date).getTime();

        if (timeA !== timeB) {
            return timeA - timeB;
        }

        return 0;
    });

    let balance = 0;

    const entries = raw.map((entry, i) => {
        balance = Math.round(
            (balance + Number(entry.amount)) * 100
        ) / 100;

        return {
            id: Date.parse(entry.date) + i,
            date: entry.date,
            type: entry.type,
            amount: Number(entry.amount),
            note: entry.note,
            market: entry.market,
            balanceAfter: balance
        };
    });

    const deposits = entries.filter(
        e => e.type === 'deposit' && e.amount > 0
    );

    const withdrawals = entries.filter(
        e => e.type === 'deposit' && e.amount < 0
    );

    const trades = entries.filter(
        e => e.type === 'trade'
    );

    const totalDeposits = deposits.reduce(
        (sum, e) => sum + e.amount,
        0
    );

    const totalWithdrawals = withdrawals.reduce(
        (sum, e) => sum + e.amount,
        0
    );

    const totalTrading = trades.reduce(
        (sum, e) => sum + e.amount,
        0
    );

    return {
        startingCapital: 0,
        currentCapital: Math.round(balance * 100) / 100,
        entries,

        summary: {
            deposits: deposits.length,
            withdrawals: withdrawals.length,
            trades: trades.length,
            totalDeposits: Math.round(totalDeposits * 100) / 100,
            totalWithdrawals: Math.round(totalWithdrawals * 100) / 100,
            totalTrading: Math.round(totalTrading * 100) / 100,
            finalCapital: Math.round(balance * 100) / 100
        }
    };
}

async function getCapital() {
    const stateResult = await db.query(`
        SELECT starting_capital, current_capital
        FROM capital_state
        WHERE id = 1
    `);

    if (stateResult.rowCount === 0) {
        throw new Error('Brak rekordu capital_state');
    }

    const entriesResult = await db.query(`
        SELECT
            id,
            date,
            type,
            amount,
            note,
            market,
            balance_after
        FROM capital_entries
        ORDER BY date ASC, id ASC
    `);

    const state = stateResult.rows[0];

    return {
        startingCapital: Number(state.starting_capital),
        currentCapital: Number(state.current_capital),
        entries: entriesResult.rows.map(row => ({
            id: Number(row.id),
            date: new Date(row.date).toISOString(),
            type: row.type,
            amount: Number(row.amount),
            note: row.note,
            market: row.market,
            balanceAfter: Number(row.balance_after)
        }))
    };
}

app.get('/api/capital', requireAuthApi, async (req, res) => {
    try {
        const data = await getCapital();
        res.json(data);
    } catch (err) {
        console.error('GET /api/capital:', err);
        res.status(500).json({
            error: 'Błąd odczytu kapitału'
        });
    }
});

app.post('/api/capital/entry', requireAuthApi, async (req, res) => {
    const { type, amount, note, market } = req.body;

    if (!['trade', 'deposit'].includes(type)) {
        return res.status(400).json({
            error: 'Zły typ wpisu'
        });
    }

    const amt = Math.round(parseFloat(amount) * 100) / 100;

    if (!isFinite(amt) || amt === 0) {
        return res.status(400).json({
            error: 'Podaj poprawną, niezerową kwotę'
        });
    }

    if (note && String(note).length > 200) {
        return res.status(400).json({
            error: 'Notatka za długa'
        });
    }

    if (market && String(market).length > 24) {
        return res.status(400).json({
            error: 'Nazwa rynku za długa'
        });
    }

    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const stateResult = await client.query(`
            SELECT current_capital
            FROM capital_state
            WHERE id = 1
            FOR UPDATE
        `);

        if (stateResult.rowCount === 0) {
            throw new Error('Brak rekordu capital_state');
        }

        const currentCapital =
            Number(stateResult.rows[0].current_capital);

        const newCapital =
            Math.round((currentCapital + amt) * 100) / 100;

        const entryId = Date.now();

        await client.query(`
            INSERT INTO capital_entries
                (id, date, type, amount, note, market, balance_after)
            VALUES
                ($1, NOW(), $2, $3, $4, $5, $6)
        `, [
            entryId,
            type,
            amt,
            (note || '').toString().trim(),
            (market || '').toString().trim().slice(0, 24),
            newCapital
        ]);

        await client.query(`
            UPDATE capital_state
            SET current_capital = $1
            WHERE id = 1
        `, [newCapital]);

        await client.query('COMMIT');

        const data = await getCapital();
        res.json(data);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('POST /api/capital/entry:', err);

        res.status(500).json({
            error: 'Błąd zapisu kapitału'
        });

    } finally {
        client.release();
    }
});

app.delete('/api/capital/entry/:id', requireAuthApi, async (req, res) => {
    const client = await db.connect();

    try {
        await client.query('BEGIN');

        const lastResult = await client.query(`
            SELECT id, amount
            FROM capital_entries
            ORDER BY date DESC, id DESC
            LIMIT 1
            FOR UPDATE
        `);

        if (lastResult.rowCount === 0) {
            await client.query('ROLLBACK');

            return res.status(400).json({
                error: 'Brak wpisów do cofnięcia'
            });
        }

        const last = lastResult.rows[0];

        if (String(last.id) !== req.params.id) {
            await client.query('ROLLBACK');

            return res.status(400).json({
                error: 'Można cofnąć tylko ostatni wpis'
            });
        }

        const stateResult = await client.query(`
            SELECT current_capital
            FROM capital_state
            WHERE id = 1
            FOR UPDATE
        `);

        if (stateResult.rowCount === 0) {
            throw new Error('Brak rekordu capital_state');
        }

        const currentCapital =
            Number(stateResult.rows[0].current_capital);

        const newCapital =
            Math.round(
                (currentCapital - Number(last.amount)) * 100
            ) / 100;

        await client.query(`
            DELETE FROM capital_entries
            WHERE id = $1
        `, [last.id]);

        await client.query(`
            UPDATE capital_state
            SET current_capital = $1
            WHERE id = 1
        `, [newCapital]);

        await client.query('COMMIT');

        const data = await getCapital();
        res.json(data);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('DELETE /api/capital/entry/:id:', err);

        res.status(500).json({
            error: 'Błąd cofania wpisu'
        });

    } finally {
        client.release();
    }
});

app.post('/api/capital/import-csv', requireAuthApi, async (req, res) => {
    const csv = req.body && req.body.csv;

    if (typeof csv !== 'string' || csv.length < 20) {
        return res.status(400).json({ error: 'Brak treści CSV' });
    }

    if (csv.length > 1.5 * 1024 * 1024) {
        return res.status(400).json({
            error: 'Plik za duży (max ~1.5 MB)'
        });
    }

    try {
        const parsed = parseBrokerCsv(csv);
        const client = await db.connect();

        try {
            await client.query('BEGIN');

            const startingCapital = 0;

            await client.query(`
                DELETE FROM capital_entries
            `);

            let balance = startingCapital;

            for (const entry of parsed.entries) {
                balance = Math.round(
                    (balance + Number(entry.amount)) * 100
                ) / 100;

                await client.query(`
                    INSERT INTO capital_entries
                        (id, date, type, amount, note, market, balance_after)
                    VALUES
                        ($1, $2, $3, $4, $5, $6, $7)
                `, [
                    entry.id,
                    entry.date,
                    entry.type,
                    entry.amount,
                    entry.note,
                    entry.market,
                    balance
                ]);
            }

            await client.query(`
                UPDATE capital_state
                SET
                    starting_capital = $1,
                    current_capital = $2
                WHERE id = 1
            `, [
                startingCapital,
                balance
            ]);

            await client.query('COMMIT');

            const data = await getCapital();

            res.json({
                ok: true,
                ...data,
                summary: {
                    ...parsed.summary,
                    startingCapital,
                    finalCapital: balance
                }
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (e) {
        console.error('import-csv:', e);
        res.status(400).json({
            error: e.message || 'Błąd importu CSV'
        });
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
        res.status(502).json({
            ok: false,
            error: 'Nie udało się pobrać notowania rynku'
        });
    }
});

function requireJulciaAuth(req, res, next) {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');

    if (req.session && req.session.julciaAuthenticated) {
        return next();
    }

    return res.redirect('/');
}

app.post('/julcia-login', loginRateLimited, (req, res) => {
    const ip = req.ip || 'unknown';
    const pass = req.body && req.body.pass;

    if (pass === 'kochamkonrada') {
        loginAttempts.delete(ip);
        req.session.julciaAuthenticated = true;

        return res.sendStatus(200);
    }

    const rec = loginAttempts.get(ip) || {
        count: 0,
        resetAt: Date.now() + LOGIN_WINDOW_MS
    };

    rec.count += 1;
    loginAttempts.set(ip, rec);

    return res.sendStatus(401);
});

// ─── STRONY ────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.session && req.session.authenticated) return res.redirect('/panel');
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/panel', requireAuthPage, (req, res) =>
    res.sendFile(path.join(__dirname, 'panel.html'))
);

app.get('/zapis', requireAuthPage, (req, res) =>
    res.sendFile(path.join(__dirname, 'zapis.html'))
);

app.get('/prognoza', requireAuthPage, (req, res) =>
    res.sendFile(path.join(__dirname, 'prognoza.html'))
);

app.get('/rynki', requireAuthPage, (req, res) =>
    res.sendFile(path.join(__dirname, 'rynki.html'))
);

app.get('/julcia.html', requireJulciaAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'julcia.html'));
});

app.get('/wybaczam.html', requireJulciaAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'wybaczam.html'));
});

app.get('/nie-wybaczam.html', requireJulciaAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'nie-wybaczam.html'));
});

app.post('/julcia-login', loginRateLimited, (req, res) => {
    const ip = req.ip || 'unknown';
    const pass = req.body && req.body.pass;

    if (pass === 'kochamkonrada') {
        loginAttempts.delete(ip);
        req.session.julciaAuthenticated = true;

        return res.sendStatus(200);
    }

    const rec = loginAttempts.get(ip) || {
        count: 0,
        resetAt: Date.now() + LOGIN_WINDOW_MS
    };

    rec.count += 1;
    loginAttempts.set(ip, rec);

    return res.sendStatus(401);
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('sid');
        res.redirect('/');
    });
});

app.use((req, res) => res.redirect('/'));

const PORT = process.env.PORT || 3000;

initCapitalDb()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Nasłuchuję na porcie ${PORT}`);
        });
    })
    .catch((err) => {
        console.error('Nie można uruchomić aplikacji:', err);
        process.exit(1);
    });


















































