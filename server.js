// Polls ViewPower, integrates power over time into kWh, serves a dashboard.
const http = require('http');
const fs = require('fs');
const path = require('path');

const VP = process.env.VIEWPOWER_URL || 'http://localhost:15178/ViewPower';
const PORT_NAME = process.env.UPS_PORT_NAME || 'USB24875B93';
const PORT = Number(process.env.PORT || 15180);
const HOST = process.env.HOST || '127.0.0.1';
const POLL_MS = 5000;
const MAX_GAP_MS = 60000; // don't integrate across outages longer than this
const DATA_FILE = path.join(__dirname, 'data.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

let config = { ratedWatts: Number(process.env.UPS_RATED_WATTS || 600), pricePerKwh: 0 };
try { config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; } catch {}

// energy[YYYY-MM-DD][hour] = Wh, stored as load-percent-hours so rating changes apply retroactively
let store = { loadPctHours: {} };
try { store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch {}
store.samples ||= []; // {t, pct, vin, vout, bat} every SAMPLE_MS, kept for 24 h
store.trackedHours ||= {}; // hours actually monitored, for projections
store.trackedLoadPctHours ||= {}; // consumption from samples taken by this version only
store.events ||= []; // power cuts: {start, end, minBat}
const SAMPLE_MS = 30000;
const KEEP_MS = 24 * 3600000;
// an outage left open by a restart ends at the last known sample
for (const e of store.events) {
  if (e.end == null) e.end = Math.max(e.start, store.samples.length ? store.samples[store.samples.length - 1].t : e.start);
}
let lastSampleT = store.samples.length ? store.samples[store.samples.length - 1].t : 0;

let live = { ok: false, error: 'not polled yet' };
let last = null;

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function poll() {
  try {
    const res = await fetch(`${VP}/workstatus/reqMonitorData`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `portName=${encodeURIComponent(PORT_NAME)}`,
      signal: AbortSignal.timeout(4000),
    });
    const w = (await res.json()).workInfo;
    const loadPct = parseFloat(w.outputLoadPercent);
    if (!Number.isFinite(loadPct)) throw new Error('No load data (check UPS_PORT_NAME)');
    const now = Date.now();
    if (last && now - last.t <= MAX_GAP_MS) {
      const hours = (now - last.t) / 3600000;
      const d = new Date(now);
      const k = dayKey(d);
      const day = (store.loadPctHours[k] ||= Array(24).fill(0));
      day[d.getHours()] += ((last.pct + loadPct) / 2) * hours;
      const th = (store.trackedHours[k] ||= Array(24).fill(0));
      th[d.getHours()] += hours;
      const trackedLoad = (store.trackedLoadPctHours[k] ||= Array(24).fill(0));
      trackedLoad[d.getHours()] += ((last.pct + loadPct) / 2) * hours;
    }
    last = { t: now, pct: loadPct };
    const vin = parseFloat(w.inputVoltage), vout = parseFloat(w.outputVoltage);
    const bat = Number(w.batteryCapacity);
    if (now - lastSampleT >= SAMPLE_MS) {
      lastSampleT = now;
      store.samples.push({ t: now, pct: loadPct, vin, vout, bat });
      while (store.samples.length && store.samples[0].t < now - KEEP_MS) store.samples.shift();
    }
    const onBattery = /batt/i.test(w.workMode || '') || (Number.isFinite(vin) && vin < 50);
    const open = store.events[store.events.length - 1];
    if (onBattery && !(open && open.end == null)) store.events.push({ start: now, end: null, minBat: bat });
    else if (onBattery) open.minBat = Math.min(open.minBat, bat);
    else if (open && open.end == null) open.end = now;
    if (store.events.length > 200) store.events.splice(0, store.events.length - 200);
    live = {
      ok: true, time: now, loadPct,
      watts: (loadPct / 100) * config.ratedWatts,
      inputVoltage: parseFloat(w.inputVoltage), outputVoltage: parseFloat(w.outputVoltage),
      outputFrequency: parseFloat(w.outputFrequency), batteryCapacity: w.batteryCapacity,
      workMode: w.workMode,
    };
  } catch (e) {
    last = null;
    live = { ok: false, error: String(e.message || e), time: Date.now() };
  }
}

function save() {
  fs.writeFile(DATA_FILE, JSON.stringify(store), () => {});
}

const kwh = (arr) => arr.reduce((a, b) => a + b, 0) * config.ratedWatts / 100 / 1000;

function summary() {
  const days = Object.keys(store.loadPctHours).sort();
  const now = new Date();
  const today = dayKey(now);
  const month = today.slice(0, 7);
  const weekAgo = dayKey(new Date(now.getTime() - 6 * 86400000));
  let week = 0, mon = 0, total = 0;
  const daily = days.map((d) => {
    const v = kwh(store.loadPctHours[d]);
    total += v;
    if (d >= weekAgo) week += v;
    if (d.startsWith(month)) mon += v;
    return { date: d, kwh: v };
  });
  return {
    config, live,
    today: kwh(store.loadPctHours[today] || []),
    week, month: mon, total,
    hourlyToday: (store.loadPctHours[today] || Array(24).fill(0)).map((x) => x * config.ratedWatts / 100 / 1000),
    daily: daily.slice(-30),
    projectedMonth: (() => {
      const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const hoursTracked = Object.keys(store.trackedHours).filter((d) => d.startsWith(month))
        .reduce((n, d) => n + store.trackedHours[d].reduce((a, b) => a + b, 0), 0);
      const trackedKwh = Object.keys(store.trackedLoadPctHours).filter((d) => d.startsWith(month))
        .reduce((n, d) => n + kwh(store.trackedLoadPctHours[d]), 0);
      return hoursTracked > 0.1 ? (trackedKwh / hoursTracked) * dim * 24 : 0;
    })(),
    samples: store.samples.map((s) => ({ t: s.t, w: s.pct * config.ratedWatts / 100, vin: s.vin, vout: s.vout, bat: s.bat })),
    events: store.events.slice(-20).reverse(),
    peakWatts: Math.max(0, ...store.samples.filter((s) => dayKey(new Date(s.t)) === today).map((s) => s.pct * config.ratedWatts / 100)),
  };
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/summary') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(summary()));
  }
  if (url.pathname === '/api/config' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const b = JSON.parse(body);
        const rated = Number(b.ratedWatts), price = Number(b.pricePerKwh || 0);
        if (!(rated > 0 && rated <= 100000) || !(price >= 0)) throw new Error('bad values');
        config = { ratedWatts: rated, pricePerKwh: price };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config));
        res.end('{"ok":true}');
      } catch { res.statusCode = 400; res.end('{"ok":false}'); }
    });
    return;
  }
  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const full = path.join(__dirname, 'public', path.normalize(file).replace(/^(\.\.[\\/])+/, ''));
  if (!full.startsWith(path.join(__dirname, 'public'))) { res.statusCode = 403; return res.end(); }
  fs.readFile(full, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', types[path.extname(full)] || 'application/octet-stream');
    res.end(buf);
  });
}).listen(PORT, HOST, () => console.log(`Dashboard: http://${HOST}:${PORT}`));

poll();
setInterval(poll, POLL_MS);
setInterval(save, 30000);
process.on('SIGINT', () => { fs.writeFileSync(DATA_FILE, JSON.stringify(store)); process.exit(); });
