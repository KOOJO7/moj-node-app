/* lecimyszacunek.pl — wspólne funkcje frontendowe
   Waluta wyświetlania, kursy NBP, formatowanie kwot, toasty, potwierdzenia. */
(function (global) {

  const CURRENCIES = {
    PLN: { symbol: 'zł', locale: 'pl-PL' },
    USD: { symbol: '$',  locale: 'en-US' },
    EUR: { symbol: '€',  locale: 'de-DE' }
  };

  const RATES_KEY = 'lys_rates_v1';
  const CURRENCY_KEY = 'lys_currency_v1';
  const RATES_MAX_AGE = 12 * 60 * 60 * 1000; // odśwież co 12h
  const FALLBACK_RATES = { USD: 4.00, EUR: 4.30 };

  function getCurrency() {
    const v = localStorage.getItem(CURRENCY_KEY);
    return CURRENCIES[v] ? v : 'PLN';
  }
  function setCurrency(code) {
    if (CURRENCIES[code]) localStorage.setItem(CURRENCY_KEY, code);
  }

  function loadCachedRates() {
    try {
      const raw = localStorage.getItem(RATES_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !data.fetchedAt || !data.USD || !data.EUR) return null;
      return data;
    } catch (e) { return null; }
  }

  let ratesCache = loadCachedRates();

  async function fetchRatesFromNBP() {
    // Kursy średnie NBP (tabela A) — PLN za 1 jednostkę waluty obcej.
    const [usdRes, eurRes] = await Promise.all([
      fetch('https://api.nbp.pl/api/exchangerates/rates/A/usd/?format=json'),
      fetch('https://api.nbp.pl/api/exchangerates/rates/A/eur/?format=json')
    ]);
    if (!usdRes.ok || !eurRes.ok) throw new Error('NBP niedostępne');
    const usdData = await usdRes.json();
    const eurData = await eurRes.json();
    return {
      USD: usdData.rates[0].mid,
      EUR: eurData.rates[0].mid,
      fetchedAt: Date.now()
    };
  }

  async function ensureRates() {
    if (ratesCache && (Date.now() - ratesCache.fetchedAt) < RATES_MAX_AGE) return ratesCache;
    try {
      const fresh = await fetchRatesFromNBP();
      ratesCache = fresh;
      localStorage.setItem(RATES_KEY, JSON.stringify(fresh));
      return fresh;
    } catch (e) {
      if (ratesCache) return ratesCache; // stary kurs jest lepszy niż żaden
      ratesCache = { USD: FALLBACK_RATES.USD, EUR: FALLBACK_RATES.EUR, fetchedAt: 0, fallback: true };
      return ratesCache;
    }
  }

  const BIG_UNITS = [
    { v: 1e18, s: 'trl' }, { v: 1e15, s: 'bld' }, { v: 1e12, s: 'bln' },
    { v: 1e9,  s: 'mld' }, { v: 1e6,  s: 'mln' },
  ];

  function toDisplayValue(amountPLN, code) {
    if (code === 'PLN') return amountPLN;
    const r = ratesCache && ratesCache[code];
    if (!r) return amountPLN;
    return amountPLN / r;
  }

  function fmt(amountPLN, opts) {
    opts = opts || {};
    const code = opts.currency || getCurrency();
    const meta = CURRENCIES[code] || CURRENCIES.PLN;
    const value = toDisplayValue(amountPLN, code);
    if (!isFinite(value)) return '—';
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    if (abs >= 1e21) return sign + abs.toExponential(2).replace('+', '') + ' ' + meta.symbol;
    for (const u of BIG_UNITS) {
      if (abs >= u.v) {
        return sign + (abs / u.v).toLocaleString(meta.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + u.s + ' ' + meta.symbol;
      }
    }
    const str = abs.toLocaleString(meta.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return sign + str + ' ' + meta.symbol;
  }

  function fmtSigned(amountPLN, opts) {
    const value = toDisplayValue(amountPLN, (opts && opts.currency) || getCurrency());
    return (value > 0 ? '+' : '') + fmt(amountPLN, opts);
  }

  function currencySuffix() {
    return CURRENCIES[getCurrency()].symbol;
  }

  // ---------- toast ----------
  function toast(msg, kind) {
    let host = document.getElementById('lys-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'lys-toast-host';
      host.className = 'toast-host';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 250);
    }, 3000);
  }

  // ---------- lekki modal potwierdzenia (zamiast confirm()) ----------
  function confirmModal(message, confirmLabel) {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-wrap';
      wrap.innerHTML = `
        <div class="modal-card">
          <p class="modal-msg">${message}</p>
          <div class="modal-actions">
            <button type="button" class="btn ghost" data-a="no">Anuluj</button>
            <button type="button" class="btn danger" data-a="yes">${confirmLabel || 'Potwierdź'}</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      requestAnimationFrame(() => wrap.classList.add('show'));
      function close(val) {
        wrap.classList.remove('show');
        setTimeout(() => wrap.remove(), 200);
        resolve(val);
      }
      wrap.addEventListener('click', e => {
        if (e.target === wrap) close(false);
        const a = e.target.getAttribute('data-a');
        if (a === 'yes') close(true);
        if (a === 'no') close(false);
      });
    });
  }

  // ---------- przełącznik waluty wyświetlania ----------
  function renderCurrencySwitcher(container, onChange) {
    if (!container) return;
    function paint() {
      const current = getCurrency();
      container.innerHTML = Object.keys(CURRENCIES).map(code => {
        return `<button type="button" class="cur-chip${code === current ? ' on' : ''}" data-code="${code}" title="Pokazuj w ${code}">${code}</button>`;
      }).join('');
      container.querySelectorAll('.cur-chip').forEach(btn => {
        btn.addEventListener('click', async () => {
          const code = btn.dataset.code;
          if (code === getCurrency()) return;
          setCurrency(code);
          paint();
          await ensureRates();
          if (onChange) onChange(code);
        });
      });
    }
    paint();
    ensureRates(); // dociągnij świeże kursy w tle
  }

  // ================= RYNKI (US500, Nasdaq, DAX...) =================
  // Nie waluta — instrumenty, które obserwujesz/tradujesz. Wybór i lista
  // własnych rynków zapamiętują się lokalnie. Cena — jeśli się uda — jest
  // ciągnięta na żywo (Stooq, bez klucza API); jeśli nie, można wpisać ręcznie.

  const MARKETS_KEY = 'lys_markets_v1';
  const ACTIVE_MARKET_KEY = 'lys_active_market_v1';
  const MARKET_PX_PREFIX = 'lys_mpx_';
  const QUOTE_MAX_AGE = 5 * 60 * 1000; // 5 min

  const DEFAULT_MARKETS = ['US500', 'NAS100', 'DAX'];
  // Mapa symbol widoczny -> ticker Stooq. Dla własnych, niewymienionych tu
  // rynków próbujemy po prostu małych liter z symbolu.
  const STOOQ_MAP = {
    US500: '^spx', SPX500: '^spx', SP500: '^spx',
    NAS100: '^ndx', NASDAQ: '^ndx', USTEC: '^ndx',
    DAX: '^dax', DE40: '^dax', GER40: '^dax',
    US30: '^dji', DJ30: '^dji',
    UK100: '^ftse', FTSE100: '^ftse',
    WIG20: '^wig20'
  };

  function getMarkets() {
    try {
      const raw = JSON.parse(localStorage.getItem(MARKETS_KEY));
      if (Array.isArray(raw) && raw.length) return raw;
    } catch (e) {}
    return DEFAULT_MARKETS.slice();
  }
  function saveMarkets(list) { localStorage.setItem(MARKETS_KEY, JSON.stringify(list)); }

  function addMarket(codeRaw) {
    const code = String(codeRaw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    if (!code) return { ok: false, error: 'Podaj symbol rynku' };
    const list = getMarkets();
    if (list.includes(code)) return { ok: false, error: 'Ten rynek już jest na liście' };
    if (list.length >= 10) return { ok: false, error: 'Maksymalnie 10 rynków' };
    list.push(code);
    saveMarkets(list);
    return { ok: true, code };
  }
  function removeMarket(code) {
    const list = getMarkets().filter(c => c !== code);
    saveMarkets(list.length ? list : DEFAULT_MARKETS.slice());
    if (getActiveMarket() === code) setActiveMarket(getMarkets()[0]);
  }

  function getActiveMarket() {
    const list = getMarkets();
    const v = localStorage.getItem(ACTIVE_MARKET_KEY);
    return list.includes(v) ? v : list[0];
  }
  function setActiveMarket(code) { localStorage.setItem(ACTIVE_MARKET_KEY, code); }

  function loadQuoteCache(code) {
    try { return JSON.parse(localStorage.getItem(MARKET_PX_PREFIX + code)) || null; }
    catch (e) { return null; }
  }
  function saveQuoteCache(code, data) { localStorage.setItem(MARKET_PX_PREFIX + code, JSON.stringify(data)); }

  async function fetchMarketQuote(code, force) {
    const cached = loadQuoteCache(code);

    if (
        !force &&
        cached &&
        cached.source === 'live' &&
        (Date.now() - cached.time) < QUOTE_MAX_AGE
    ) {
        return cached;
    }

    try {
        const res = await fetch(
            '/api/market/' + encodeURIComponent(code),
            {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store'
            }
        );

        if (res.status === 401) {
            window.location.href = '/';
            return cached || null;
        }

        const data = await res.json();

        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Nie udało się pobrać rynku');
        }

        const quote = {
            price: Number(data.price),
            time: Number(data.time) || Date.now(),
            source: 'live'
        };

        if (
            !Number.isFinite(quote.price) ||
            quote.price <= 0
        ) {
            throw new Error('Serwer zwrócił niepoprawną cenę');
        }

        saveQuoteCache(code, quote);

        return quote;

    } catch (e) {
        console.error('Błąd rynku ' + code + ':', e);

        // Jeśli mamy starą cenę, nadal ją pokazujemy.
        return cached || null;
    }
}

  function setManualQuote(code, price) {
    const p = parseFloat(price);
    if (!isFinite(p) || p <= 0) return { ok: false, error: 'Podaj poprawną wartość' };
    saveQuoteCache(code, { price: p, time: Date.now(), source: 'manual' });
    return { ok: true };
  }

  function timeAgo(ts) {
    if (!ts) return 'brak danych';
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'przed chwilą';
    const m = Math.round(s / 60);
    if (m < 60) return m + ' min temu';
    const h = Math.round(m / 60);
    if (h < 24) return h + ' godz. temu';
    return Math.round(h / 24) + ' dni temu';
  }

  // Pełny panel: chipy rynków (z dodawaniem/usuwaniem) + duża wartość aktywnego rynku.
  function renderMarketPanel(container, onChange) {
    if (!container) return;

    async function paint() {
      const markets = getMarkets();
      const active = getActiveMarket();
      const cached = loadQuoteCache(active);

      container.innerHTML = `
        <div class="chips market-chips" id="mktChips"></div>
        <div class="market-value-row">
          <div>
            <div class="market-value num" id="mktValue">${cached ? cached.price.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</div>
            <div class="market-sub" id="mktSub">${cached ? (cached.source === 'live' ? 'na żywo (Stooq) · ' : 'wpisane ręcznie · ') + timeAgo(cached.time) : 'brak danych — odśwież albo wpisz ręcznie'}</div>
          </div>
          <div class="market-actions">
            <button type="button" class="btn ghost small" id="mktRefresh">Odśwież</button>
            <button type="button" class="btn ghost small" id="mktManualBtn">Wpisz ręcznie</button>
          </div>
        </div>
        <div class="market-manual-row" id="mktManualRow" style="display:none">
          <input class="field" type="number" step="0.01" id="mktManualInput" placeholder="Wartość ${active}">
          <button class="btn gold small" id="mktManualSave">Zapisz</button>
        </div>`;

      const chipsEl = container.querySelector('#mktChips');
      chipsEl.innerHTML = markets.map(code => `
        <span class="chip-btn market-chip${code === active ? ' on' : ''}" data-code="${code}">
          ${code}<button type="button" class="market-chip-x" data-remove="${code}" title="Usuń ${code}">×</button>
        </span>`).join('') + `<button type="button" class="chip-btn" id="mktAdd">+ dodaj</button>`;

      chipsEl.querySelectorAll('.market-chip').forEach(el => {
        el.addEventListener('click', async (e) => {
          if (e.target.dataset.remove) return; // obsłużone osobno
          const code = el.dataset.code;
          if (code === getActiveMarket()) return;
          setActiveMarket(code);
          await paint();
          fetchMarketQuote(code).then(paint);
          if (onChange) onChange(code);
        });
      });
      chipsEl.querySelectorAll('[data-remove]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (getMarkets().length <= 1) { toast('Zostaw przynajmniej jeden rynek', 'err'); return; }
          const ok = await confirmModal('Usunąć rynek ' + btn.dataset.remove + ' z listy?', 'Usuń');
          if (!ok) return;
          removeMarket(btn.dataset.remove);
          paint();
          if (onChange) onChange(getActiveMarket());
        });
      });
      const addBtn = chipsEl.querySelector('#mktAdd');
      if (addBtn) addBtn.addEventListener('click', async () => {
        const code = prompt('Symbol rynku, np. US500, NASDAQ, DAX, GOLD, BTCUSD:');
        if (code === null) return;
        const r = addMarket(code);
        if (!r.ok) { toast(r.error, 'err'); return; }
        setActiveMarket(r.code);
        await paint();
        fetchMarketQuote(r.code).then(paint);
        if (onChange) onChange(r.code);
      });

      container.querySelector('#mktRefresh').addEventListener('click', async () => {
        container.querySelector('#mktSub').textContent = 'odświeżam…';
        await fetchMarketQuote(getActiveMarket(), true);
        paint();
      });
      container.querySelector('#mktManualBtn').addEventListener('click', () => {
        const row = container.querySelector('#mktManualRow');
        row.style.display = row.style.display === 'none' ? 'flex' : 'none';
        container.querySelector('#mktManualInput').focus();
      });
      container.querySelector('#mktManualSave').addEventListener('click', () => {
        const val = container.querySelector('#mktManualInput').value;
        const r = setManualQuote(getActiveMarket(), val);
        if (!r.ok) { toast(r.error, 'err'); return; }
        toast('Zapisano wartość ' + getActiveMarket(), 'ok');
        paint();
      });
    }

    paint();
    fetchMarketQuote(getActiveMarket()).then(paint);
  }

  // Prosty rząd chipów do oznaczania rynku przy zapisie transakcji (bez cen).
  function renderMarketTagPicker(container, initialCode, onChange) {
    if (!container) return;
    let selected = initialCode || getActiveMarket();
    function paint() {
      const markets = getMarkets();
      container.innerHTML = markets.map(code =>
        `<button type="button" class="chip-btn${code === selected ? ' on' : ''}" data-code="${code}">${code}</button>`
      ).join('') + `<button type="button" class="chip-btn" data-code="">bez tagu</button>`;
      container.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          selected = btn.dataset.code;
          paint();
          if (onChange) onChange(selected);
        });
      });
    }
    paint();
    return { get: () => selected };
  }

  global.LYS = {
    CURRENCIES, getCurrency, setCurrency, ensureRates,
    fmt, fmtSigned, currencySuffix,
    toast, confirmModal, renderCurrencySwitcher,
    getMarkets, addMarket, removeMarket, getActiveMarket, setActiveMarket,
    fetchMarketQuote, setManualQuote, timeAgo,
    renderMarketPanel, renderMarketTagPicker
  };
})(window);
