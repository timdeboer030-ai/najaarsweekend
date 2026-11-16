// Zwijnenbier API — één Netlify Function op /api/*
// Opslag: Netlify Blobs (store "zwijnenbier").
//   user/<naam-lowercase>  → { id, name, salt, pinHash, createdAt, beers: [timestamp, ...] }
//   meta/secret            → automatisch gegenereerde sleutel om sessies te ondertekenen
import { getStore } from '@netlify/blobs';
import crypto from 'node:crypto';

const TZ = 'Europe/Amsterdam';
const DAY_START_HOUR = 6;          // een "dag" loopt van 06:00 tot 06:00
const HOUR = 3600_000;
const COOLDOWN = 15_000;           // tegen per ongeluk dubbel tikken
const UNDO_WINDOW = 10 * 60_000;   // laatste biertje 10 min lang terug te draaien
const SESSION_AGE = 60 * 60 * 24 * 30; // 30 dagen ingelogd blijven

const store = () => getStore({ name: 'zwijnenbier', consistency: 'strong' });
const userKey = (name) => `user/${name.toLowerCase()}`;

// ---------- Tijd ----------
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});
function parts(ts) {
  const o = {};
  for (const p of fmt.formatToParts(new Date(ts))) o[p.type] = p.value;
  return o;
}
const localHour = (ts) => Number(parts(ts).hour);
const dayKey = (ts) => {
  const p = parts(ts - DAY_START_HOUR * HOUR);
  return `${p.year}-${p.month}-${p.day}`;
};

// ---------- Badges ----------
const BADGES = [
  { id: 'openingsschot', icon: '🎯', name: 'Openingsschot', desc: 'Het allereerste biertje van het weekend' },
  { id: 'haantje', icon: '🐓', name: 'Haantje de voorste', desc: 'Als eerste van de groep een biertje op een dag' },
  { id: 'ochtendzwijn', icon: '🌅', name: 'Ochtendzwijn', desc: 'Een biertje vóór 12:00' },
  { id: 'kanonnier', icon: '💥', name: 'Kanonnier', desc: '3 biertjes binnen één uur' },
  { id: 'nachtbraker', icon: '🌙', name: 'Nachtbraker', desc: 'Een biertje tussen 02:00 en 06:00' },
  { id: 'volhouder', icon: '🔁', name: 'Volhouder', desc: 'Op 3 verschillende dagen gedronken' },
  { id: 'wildzwijn', icon: '🐗', name: 'Wildzwijn', desc: '10 biertjes in totaal' },
  { id: 'halvekist', icon: '📦', name: 'Halve kist', desc: '12 biertjes in totaal' },
  { id: 'kist', icon: '🏆', name: 'Volle kist', desc: '24 biertjes in totaal' },
];

async function loadUsers() {
  const s = store();
  const { blobs } = await s.list({ prefix: 'user/' });
  const users = await Promise.all(blobs.map((b) => s.get(b.key, { type: 'json' })));
  return users.filter(Boolean);
}

// Loopt chronologisch door alle biertjes: badges per gebruiker + feed-informatie.
function analyse(users) {
  const beers = [];
  for (const u of users) for (const ts of u.beers || []) beers.push({ userId: u.id, ts });
  beers.sort((a, b) => a.ts - b.ts);

  const badges = new Map();
  const give = (uid, id) => {
    if (!badges.has(uid)) badges.set(uid, new Set());
    badges.get(uid).add(id);
  };
  const seenDays = new Set();
  const perUser = new Map();
  const enriched = [];
  if (beers.length) give(beers[0].userId, 'openingsschot');

  for (const b of beers) {
    const dk = dayKey(b.ts);
    const h = localHour(b.ts);
    if (!seenDays.has(dk)) { seenDays.add(dk); give(b.userId, 'haantje'); }
    if (h >= 6 && h < 12) give(b.userId, 'ochtendzwijn');
    if (h >= 2 && h < 6) give(b.userId, 'nachtbraker');

    if (!perUser.has(b.userId)) perUser.set(b.userId, { ts: [], days: new Map() });
    const u = perUser.get(b.userId);
    u.ts.push(b.ts);
    u.days.set(dk, (u.days.get(dk) || 0) + 1);
    const n = u.ts.length;
    let inHour = 0;
    for (let i = n - 1; i >= 0 && b.ts - u.ts[i] < HOUR; i--) inHour++;

    if (inHour >= 3) give(b.userId, 'kanonnier');
    if (u.days.size >= 3) give(b.userId, 'volhouder');
    if (n >= 10) give(b.userId, 'wildzwijn');
    if (n >= 12) give(b.userId, 'halvekist');
    if (n >= 24) give(b.userId, 'kist');

    enriched.push({ ...b, day: dk, inHour, dayNum: u.days.get(dk) });
  }
  return { badges, enriched };
}

function buildState(users) {
  const now = Date.now();
  const today = dayKey(now);
  const { badges, enriched } = analyse(users);
  const names = new Map(users.map((u) => [u.id, u.name]));

  const stats = new Map(users.map((u) => [u.id, {
    id: u.id, name: u.name, total: 0, today: 0, lastHour: 0, lastTs: null,
    badges: BADGES.filter((b) => badges.get(u.id)?.has(b.id)).map((b) => b.id),
  }]));

  let todayAll = 0, lastHourAll = 0;
  for (const b of enriched) {
    const s = stats.get(b.userId);
    s.total++;
    s.lastTs = b.ts;
    if (b.day === today) { s.today++; todayAll++; }
    if (now - b.ts < HOUR) { s.lastHour++; lastHourAll++; }
  }

  const ranked = [...stats.values()].sort((a, b) =>
    b.total - a.total || (a.lastTs ?? Infinity) - (b.lastTs ?? Infinity) || a.name.localeCompare(b.name));

  const feed = enriched.slice(-20).reverse().map((b) => ({
    name: names.get(b.userId), userId: b.userId, ts: b.ts, inHour: b.inHour, dayNum: b.dayNum,
  }));

  return {
    now, today,
    totals: {
      all: enriched.length,
      today: todayAll,
      lastHour: lastHourAll,
      activeToday: ranked.filter((u) => u.today > 0).length,
    },
    users: ranked,
    feed,
    badges: BADGES,
  };
}

// ---------- Sessies (ondertekend cookie, geen sessie-opslag nodig) ----------
let cachedSecret = null;
async function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (cachedSecret) return cachedSecret;
  const s = store();
  let value = await s.get('meta/secret');
  if (!value) {
    value = crypto.randomBytes(32).toString('hex');
    await s.set('meta/secret', value, { onlyIfNew: true });
    value = (await s.get('meta/secret')) || value; // bij gelijktijdige eerste start: neem de winnaar
  }
  return (cachedSecret = value);
}
const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString();
const sign = (data, key) => crypto.createHmac('sha256', key).update(data).digest('base64url');

async function makeToken(userId) {
  const data = `${b64(userId)}.${Date.now() + SESSION_AGE * 1000}`;
  return `${data}.${sign(data, await secret())}`;
}
async function readToken(token) {
  const [idPart, exp, sig] = String(token || '').split('.');
  if (!idPart || !exp || !sig) return null;
  const expected = sign(`${idPart}.${exp}`, await secret());
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now()) return null;
  return unb64(idPart);
}

function cookieHeader(req, value, maxAge) {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `zwijn=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
function getCookie(req, name) {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
async function currentUser(req) {
  const id = await readToken(getCookie(req, 'zwijn'));
  if (!id) return null;
  return store().get(userKey(id), { type: 'json' });
}

const hashPin = (pin, salt) => crypto.scryptSync(pin, salt, 32).toString('hex');
const attempts = new Map(); // simpele rem op wachtwoord raden (per function-instantie)

// ---------- HTTP ----------
const json = (status, data, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
});
async function body(req) {
  try { return await req.json(); } catch { return {}; }
}
const cleanName = (n) => String(n || '').trim().replace(/\s+/g, ' ');

export default async (req) => {
  try {
    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    const m = req.method;

    if (path === '/api/state' && m === 'GET') return json(200, buildState(await loadUsers()));

    if (path === '/api/me' && m === 'GET') {
      const u = await currentUser(req);
      if (!u) return json(200, { user: null });
      const beers = (u.beers || []).map((ts) => ({ ts, day: dayKey(ts) }));
      return json(200, { user: { id: u.id, name: u.name }, beers, today: dayKey(Date.now()) });
    }

    if (path === '/api/register' && m === 'POST') {
      const b = await body(req);
      const name = cleanName(b.name);
      const pin = String(b.pin || '');
      if (name.length < 2 || name.length > 20 || !/^[\p{L}\p{N} _.'-]+$/u.test(name))
        return json(400, { error: 'Kies een naam van 2–20 tekens (letters, cijfers, spatie).' });
      if (pin.length < 4 || pin.length > 12)
        return json(400, { error: 'Je wachtwoord moet 4 tot 12 tekens zijn.' });
      const salt = crypto.randomBytes(16).toString('hex');
      const user = {
        id: name.toLowerCase(), name, salt, pinHash: hashPin(pin, salt), createdAt: Date.now(), beers: [],
      };
      const { modified } = await store().setJSON(userKey(name), user, { onlyIfNew: true });
      if (!modified) return json(409, { error: 'Die naam is al bezet. Kies een andere of log in.' });
      return json(201, { user: { id: user.id, name } },
        { 'Set-Cookie': cookieHeader(req, await makeToken(user.id), SESSION_AGE) });
    }

    if (path === '/api/login' && m === 'POST') {
      const b = await body(req);
      const name = cleanName(b.name);
      const pin = String(b.pin || '');
      const key = name.toLowerCase();
      const a = attempts.get(key);
      if (a && a.until > Date.now())
        return json(429, { error: 'Te vaak fout geprobeerd. Wacht een minuutje en probeer opnieuw.' });
      const user = name ? await store().get(userKey(name), { type: 'json' }) : null;
      const ok = user && crypto.timingSafeEqual(
        Buffer.from(hashPin(pin, user.salt), 'hex'), Buffer.from(user.pinHash, 'hex'));
      if (!ok) {
        const r = attempts.get(key) || { fails: 0, until: 0 };
        if (++r.fails >= 5) { r.fails = 0; r.until = Date.now() + 60_000; }
        attempts.set(key, r);
        return json(401, { error: 'Naam of wachtwoord klopt niet.' });
      }
      attempts.delete(key);
      return json(200, { user: { id: user.id, name: user.name } },
        { 'Set-Cookie': cookieHeader(req, await makeToken(user.id), SESSION_AGE) });
    }

    if (path === '/api/logout' && m === 'POST') {
      return json(200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });
    }

    if (path === '/api/beer' && m === 'POST') {
      const u = await currentUser(req);
      if (!u) return json(401, { error: 'Log eerst in.' });
      const now = Date.now();
      const last = u.beers.at(-1);
      if (last && now - last < COOLDOWN)
        return json(429, { error: 'Rustig aan, die vorige is net geteld! 🐗' });

      const users = await loadUsers();
      const before = analyse(users).badges.get(u.id) || new Set();
      u.beers.push(now);
      await store().setJSON(userKey(u.id), u);
      const updated = users.map((x) => (x.id === u.id ? u : x));
      const after = analyse(updated).badges.get(u.id) || new Set();
      const newBadges = BADGES.filter((b) => after.has(b.id) && !before.has(b.id));

      const today = dayKey(now);
      const todayCount = u.beers.filter((ts) => dayKey(ts) === today).length;
      const hourCount = u.beers.filter((ts) => now - ts < HOUR).length;
      return json(201, { total: u.beers.length, todayCount, hourCount, firstOfDay: todayCount === 1, newBadges });
    }

    if (path === '/api/beer/last' && m === 'DELETE') {
      const u = await currentUser(req);
      if (!u) return json(401, { error: 'Log eerst in.' });
      const last = u.beers.at(-1);
      if (!last) return json(404, { error: 'Er is niks om terug te draaien.' });
      if (Date.now() - last > UNDO_WINDOW)
        return json(400, { error: 'Alleen een biertje van de laatste 10 minuten kan terug.' });
      u.beers.pop();
      await store().setJSON(userKey(u.id), u);
      return json(200, { ok: true });
    }

    return json(404, { error: 'Niet gevonden' });
  } catch (e) {
    console.error(e);
    return json(500, { error: 'Er ging iets mis in het bos. Probeer het nog eens.' });
  }
};

export const config = { path: '/api/*' };
