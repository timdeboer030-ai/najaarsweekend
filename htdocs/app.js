'use strict';

// ================= Helpers =================
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const fillIn = (t, v) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const HOUR = 3600e3, TWO_H = 2 * HOUR, UNDO_WINDOW = 10 * 60e3;

const S = { state: null, me: null, busy: false, seenFeedTs: 0, prevCounts: {}, welcomed: false };

// '/api/state' → 'api.php?a=state' (PHP-backend op InfinityFree)
async function api(path, { method = 'GET', body } = {}) {
  const url = 'api.php?a=' + encodeURIComponent(path.replace(/^\/api\//, ''));
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) throw Object.assign(new Error(data.error || 'Er ging iets mis.'), { status: r.status });
  return data;
}

function timeAgo(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'zojuist';
  if (m < 60) return `${m} min geleden`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return r ? `${h}u ${r}m geleden` : `${h} uur geleden`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'gisteren' : `${d} dagen geleden`;
}
function duration(ms) {
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${m} min`;
  return r ? `${h}u ${r}m` : `${h} uur`;
}
const clock = (ts) => new Date(ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' });
const firstName = (n) => String(n).split(' ')[0];

const AVATAR_COLORS = ['#1f6f4f', '#24497f', '#8a5a1c', '#2d7d7a', '#7a3b2e', '#3d5a99', '#4f7a2a', '#6b4e8f'];
function avatar(name, cls = '') {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  const words = String(name).trim().split(/\s+/);
  const ini = words.length > 1 ? [...words[0]][0] + [...words[1]][0] : [...words[0]].slice(0, 2).join('');
  return `<span class="avatar ${cls}" style="--bg:${AVATAR_COLORS[h % AVATAR_COLORS.length]}">${esc(ini.toUpperCase())}</span>`;
}
function badgeIcons(ids) {
  const defs = S.state?.badges || [];
  return ids.map((id) => defs.find((b) => b.id === id)).filter(Boolean)
    .map((b) => `<span class="badge-ico" title="${esc(b.name)}: ${esc(b.desc)}">${b.icon}</span>`).join('');
}

// ================= Teksten voor pop-ups =================
const TXT = {
  first: [
    ['Daar is ie dan!', 'Het eerste bier van de dag, {naam}. Het zwijn in jou is wakker. 🐗'],
    ['Goed begonnen…', '…is half gedronken! Eerste van de dag staat erop, {naam}.'],
    ['Pssst-klik!', '{naam} opent de dag in stijl. Proost op een mooie dag in het bos!'],
    ['De toon is gezet', 'Eerste blikje van de dag, {naam}. De rotte kijkt trots toe.'],
  ],
  hour2: [
    ['Lekker tempo!', 'Twee binnen het uur, {naam}. Het zwijn is los! 🔥'],
    ['Er zit vaart in', '{naam} heeft er duidelijk zin in: al 2 dit uur. Heerlijk!'],
    ['Dubbelslag', 'Twee in een uur. Het bos hoort je kanonnen, {naam}!'],
  ],
  hour3: [
    ['Kanonnier!', 'Drie in één uur, {naam}. Respect van de hele rotte. 💥'],
    ['Volle salvo', '{naam} vuurt er drie af binnen het uur. Dat is kanonnenwerk!'],
  ],
  hourN: [
    ['Leider van de rotte', '{n} in een uur?! {naam}, jij bent een legende. 👑'],
    ['Wildzwijn-modus', '{n} binnen het uur, {naam}. Het bos buigt voor je!'],
  ],
  drought: [
    ['Het is stil in het bos…', 'Hé {naam}, al {tijd} droog! Het zwijn heeft dorst. Tijd voor een blikje? 🍺'],
    ['De rotte mist je!', '{naam}, al {tijd} geen bier. De rest loopt in, kom op!'],
    ['Wakker worden, zwijn!', '{tijd} zonder bier, {naam}. Eén blikje en je zit weer in de race.'],
  ],
  podium: {
    1: [
      ['Pilsvlinder-alarm! 🦋', 'Er fladdert een pilsvlinder over het bos… {naam} landt op de GOUDEN plek! De hele rotte kijkt omhoog. 👑'],
      ['Koning(in) van de rotte', 'De pilsvlinders dansen om je kop, {naam}: jij staat op nummer 1!'],
    ],
    2: [
      ['Pilsvlinders in je buik? 🦋', '{naam} fladdert naar plek 2 op het podium. Het goud is binnen vleugelbereik!'],
      ['Zilveren vleugels', 'Een pilsvlinder brengt {naam} naar de tweede plek. Nog één slok en je vliegt naar de top!'],
    ],
    3: [
      ['Er landt een pilsvlinder! 🦋', '{naam} staat op het podium: plek 3! Brons glimt ook prima in het maanlicht.'],
      ['Podiumzwijn!', 'Fladder fladder… {naam} pakt plek 3. Welkom bij de top van de rotte!'],
    ],
  },
  // Elke 7 bier: een eretitel (oplopend) + drie lange complimenten
  zevenTitels: [
    ['🦋', 'De Pilsvlinder ontpopt zich'],
    ['💥', 'Kanonnenschieter van het Bos'],
    ['👑', 'De Dorstige Koning'],
    ['🐗', 'Na-zaad van de Grote Koning'],
    ['🎩', 'Illustige Pilsbaas'],
    ['🌟', 'Levende Legende van de Rotte'],
  ],
  zeven: [
    'Zeven keer zeven tellen de oude eiken, en vanavond tellen ze voor jou, {naam}. Diep in het bos buigen de takken en fluisteren de wilde zwijnen je naam. De Pilsvlinder is uit zijn cocon gekropen, en hij heeft jouw gezicht.',
    'Hoor je dat? Dat is het geluid van {n} lege blikken die samen een ode zingen aan hun Dorstige Koning. Geen gouden kroon past jou beter dan het schuim op je bovenlip, {naam}.',
    'De kroniekschrijvers van de rotte moesten een nieuwe bladzijde openslaan. Er staat maar één zin op: "{naam}, na-zaad van de Grote Koning, dronk {n} bier, en het bos was trots."',
    'Lang geleden liep er een zwijn door dit bos dat zo dorstig was dat de beken zich voor hem verstopten. Men noemde hem de Grote Koning. Vanavond weten we eindelijk wie zijn erfgenaam is: {naam}.',
    'Kanonnenschieter {naam}! Elk blik dat jij opent klinkt als een saluutschot over de heuvels. De dorst is verslagen, de vijand is gevlucht, en toch laad jij doodleuk het volgende kanon.',
    'Illustige Pilsbaas, wij groeten u. Uw kantoor is het bos, uw bureau een boomstronk, uw handtekening een tevreden boer. {n} bier, en geen enkele vergadering gemist.',
    'Als bier een taal was, sprak {naam} hem inmiddels vloeiend, met een poëtische ondertoon en een vleugje schuim. {n} hoofdstukken geschreven, en het boek is nog lang niet uit.',
    'De sterren boven het kamp schijnen ineens net iets feller. Sterrenkundigen staan voor een raadsel, maar de rotte weet beter: dat is het licht van {naam}, die zojuist bier nummer {n} opende.',
    'Er zijn zwijnen die drinken, en er zijn zwijnen over wie liederen worden gezongen. {naam}, warm je stembanden maar vast op, want vanaf vanavond ben jij het refrein.',
    'Zelfs de maan draaide even haar hoofd om te kijken. {n} bier! De Pilsvlinder fladdert drie eererondjes om je heen en landt dan eerbiedig op je schouder.',
    'Wie zeven keer proost, proost niet meer gewoon: die zegent. {naam}, elke slok van jou is vanaf nu officieel een ceremonie, en wij zijn je dankbare toeschouwers.',
    'In de stamboom van de rotte staat jouw naam voortaan met gouden inkt geschreven, {naam}. Naast de Grote Koning, boven de Pilsvlinder, en ruim voor iedereen die nu nog water drinkt.',
    'Het kanon is warmgeschoten, de blikken liggen als trofeeën in het mos, en ergens in de verte knikt een oude keiler goedkeurend. {n} bier, {naam}. Dit is hoe legendes beginnen.',
    'Weet je wat ze zeggen over iemand die {n} bier drinkt? Niks, want ze zijn sprakeloos. De hele rotte staat met open bek naar je te kijken, {naam}.',
  ],
  welcome: ['Welkom in het bos!', 'Je teller staat nog op 0, {naam}. Tik op Proost zodra je eerste blikje open is. 🍻'],
};

// ================= Pop-ups, toast, confetti =================
const queue = [];
let modalOpen = false;
function popup(p) {
  queue.push(p);
  if (!modalOpen) nextPopup();
}
function nextPopup() {
  const p = queue.shift();
  const root = $('#modal-root');
  if (!p) { modalOpen = false; return; }
  modalOpen = true;
  root.innerHTML = `
    <div class="modal ${p.kind || ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-card">
        <div class="modal-emoji">${p.emoji}</div>
        <div class="modal-kicker">${esc(p.kicker)}</div>
        <h2 id="modal-title">${esc(p.title)}</h2>
        ${p.lines ? `<div class="compliments">${p.lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>` : `<p>${esc(p.text)}</p>`}
        <button class="btn btn-amber btn-block">${esc(p.button || 'Proost! 🍻')}</button>
      </div>
    </div>`;
  if (p.confetti) confetti(p.confetti === 'big' ? 90 : 50);
  const close = () => { root.innerHTML = ''; setTimeout(nextPopup, 200); };
  root.querySelector('button').addEventListener('click', close);
  root.querySelector('.modal').addEventListener('click', (e) => { if (e.target.classList.contains('modal')) close(); });
  root.querySelector('button').focus();
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalOpen) $('#modal-root button')?.click();
});

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

function confetti(n = 50) {
  if (reduceMotion) return;
  const host = $('#confetti');
  const colors = ['#f4b23e', '#ffd47a', '#f7f0dd', '#2e9d68', '#7fd4a5', '#2f5597'];
  for (let i = 0; i < n; i++) {
    const el = document.createElement('span');
    const emoji = Math.random() < 0.12;
    el.className = 'cf' + (emoji ? ' emo' : '');
    if (emoji) el.textContent = pick(['🍺', '🐗', '🍻']);
    el.style.left = Math.random() * 100 + 'vw';
    el.style.background = pick(colors);
    el.style.setProperty('--x', (Math.random() - 0.5) * 200 + 'px');
    el.style.setProperty('--rot', (Math.random() * 900 - 450) + 'deg');
    el.style.setProperty('--dur', 1.8 + Math.random() * 1.6 + 's');
    el.style.animationDelay = Math.random() * 0.3 + 's';
    host.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }
}

function animateCounts() {
  document.querySelectorAll('[data-count]').forEach((el) => {
    const key = el.dataset.key, to = Number(el.dataset.count);
    const from = S.prevCounts[key] ?? 0;
    S.prevCounts[key] = to;
    if (from === to || reduceMotion) { el.textContent = to; return; }
    const t0 = performance.now(), d = 900;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// ================= Achtergrond =================
function buildScene() {
  // Sterren
  const stars = $('.stars');
  stars.innerHTML = Array.from({ length: 70 }, () => {
    const s = Math.random() < 0.15 ? 3 : 2;
    return `<i class="star" style="left:${Math.random() * 100}%;top:${Math.random() * 100}%;width:${s}px;height:${s}px;--t:${3 + Math.random() * 4}s;--d:${-Math.random() * 6}s"></i>`;
  }).join('');

  // Dennenbomen in twee lagen
  function pine(x, base, h) {
    const w = h * 0.42, top = base - h, crown = h * 0.86, tiers = 4, R = [];
    for (let i = 1; i <= tiers; i++) {
      const y = top + (crown * i) / tiers, hw = (w / 2) * (0.35 + (0.65 * i) / tiers);
      R.push([hw, y]);
      if (i < tiers) R.push([hw * 0.42, y]);
    }
    const tw = w * 0.07;
    R.push([tw, top + crown], [tw, base]);
    const L = R.slice().reverse().map(([dx, y]) => [-dx, y]);
    return `<polygon points="${[[0, top], ...R, ...L].map(([dx, y]) => `${(x + dx).toFixed(1)},${y.toFixed(1)}`).join(' ')}"/>`;
  }
  function treeline(count, minH, maxH) {
    let out = '';
    for (let i = 0; i < count; i++) {
      const x = (i / count) * 1700 - 50 + Math.random() * 30;
      out += pine(x, 400, minH + Math.random() * (maxH - minH));
    }
    return `<svg viewBox="0 0 1600 400" preserveAspectRatio="xMidYMax slice">${out}<rect x="0" y="396" width="1600" height="10"/></svg>`;
  }
  $('.trees.far').innerHTML = treeline(46, 170, 330);
  $('.trees.near').innerHTML = treeline(30, 110, 230);

  // Zwevende blikken Kanon
  const cans = [
    { l: 4, t: 18, w: 64, r: -18, dur: 9, o: 0.95 },
    { l: 90, t: 30, w: 80, r: 14, dur: 11, o: 0.95 },
    { l: 16, t: 52, w: 44, r: 22, dur: 8, o: 0.6, blur: true },
    { l: 78, t: 58, w: 52, r: -10, dur: 10, o: 0.75 },
    { l: 46, t: 12, w: 38, r: 30, dur: 12, o: 0.45, blur: true },
    { l: 62, t: 34, w: 30, r: -26, dur: 9.5, o: 0.4, blur: true },
    { l: 32, t: 70, w: 34, r: 8, dur: 10.5, o: 0.5, blur: true },
  ];
  $('.cans').innerHTML = cans.map((c, i) => `
    <div class="float-can${c.blur ? ' blur' : ''}" style="left:${c.l}%;top:${c.t}%;--w:${c.w}px;--r:${c.r}deg;--dur:${c.dur}s;--o:${c.o};--delay:${-i * 1.7}s">
      <svg><use href="#can"/></svg>
    </div>`).join('');

  // Belletjes
  $('.bubbles').innerHTML = Array.from({ length: 26 }, () =>
    `<i class="bubble" style="left:${Math.random() * 100}%;--s:${4 + Math.random() * 10}px;--dur:${10 + Math.random() * 14}s;--delay:${-Math.random() * 20}s;--drift:${(Math.random() - 0.5) * 80}px"></i>`).join('');

  // Wilde zwijnen die door het bos scharrelen
  const boars = [
    { s: 170, d: 70, dl: -12, b: 1, back: false },
    { s: 120, d: 95, dl: -60, b: 4, back: true },
    { s: 92, d: 82, dl: -30, b: 6, back: false },
    { s: 140, d: 110, dl: -85, b: 0.5, back: true },
    { s: 72, d: 75, dl: -50, b: 7.5, back: false },
  ];
  $('.walkers').innerHTML = boars.map((w) => `
    <div class="walker${w.back ? ' back' : ''}" style="--s:clamp(${Math.round(w.s * 0.55)}px, ${(w.s / 14).toFixed(1)}vw, ${w.s}px);--d:${w.d}s;--dl:${w.dl}s;--b:${w.b}vh">
      <svg viewBox="0 0 220 130"><use href="#boar"/></svg>
    </div>`).join('');
}

// ================= Header =================
function renderUserChip() {
  const el = $('#userchip');
  if (S.me) {
    el.innerHTML = `<span class="who">${avatar(S.me.user.name, 'sm')}<span>${esc(S.me.user.name)}</span></span>
      <button class="logout" id="logout">Uitloggen</button>`;
    $('#logout').onclick = async () => {
      try { await api('/api/logout', { method: 'POST' }); } catch {}
      S.me = null;
      renderUserChip();
      location.hash = '#/';
      render();
    };
  } else {
    el.innerHTML = `<a class="btn btn-amber" style="padding:8px 14px;font-size:.9rem" href="#/login">Inloggen</a>`;
  }
}

// ================= Dashboard =================
const MILESTONES = [10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000];
function milestone(t) {
  let prev = 0;
  for (const m of MILESTONES) { if (t < m) return { prev, next: m }; prev = m; }
  const next = Math.floor(t / 250) * 250 + 250;
  return { prev: next - 250, next };
}
function groupCheer(s, ms) {
  const { all, lastHour, today } = s.totals;
  if (!s.users.length) return 'Het bos is nog leeg. Wie meldt zich als eerste zwijn?';
  if (!all) return 'Het bos is nog droog. Wie opent het eerste blik?';
  if (lastHour >= 6) return `Het bos staat in vuur en vlam: ${lastHour} bier in het afgelopen uur! 🔥`;
  if (!lastHour) return 'Het is even stil in het bos… tijd voor een rondje? 🍻';
  const togo = ms.next - all;
  if (togo <= 3) return `Bijna! Nog maar ${togo} tot de ${ms.next}. Wie pakt de mijlpaal? 🏁`;
  return today ? `Lekker bezig, rotte! Al ${today} vandaag. Nog ${togo} tot de ${ms.next}.` : `Nieuwe dag, nieuwe kansen. Nog ${togo} tot de ${ms.next}!`;
}
function glassSvg(pct) {
  const top = 14, bottom = 178;
  const level = top + (bottom - top) * (1 - pct);
  const shape = 'M22 14 H118 L108 168 Q107 178 96 178 H44 Q33 178 32 168 Z';
  const rise = Math.max(10, bottom - level - 14);
  const bubbles = pct > 0.04
    ? [44, 60, 72, 86, 98, 54, 80].map((x, i) =>
        `<circle class="gb" cx="${x}" cy="${bottom - 6}" r="${1.5 + (i % 3) * 0.8}" style="--t:${2 + (i % 4) * 0.7}s;--d:${-i * 0.6}s;--rise:-${rise}px"/>`).join('')
    : '';
  const foam = pct > 0.02
    ? `<path d="M0 ${level + 2} q 10 -11 20 -3 t 20 0 t 20 -3 t 20 0 t 20 -3 t 20 0 t 20 -3 V ${level + 12} H0 Z" fill="#f7f0dd"/>`
    : '';
  return `
    <svg viewBox="0 0 140 190" class="glass" role="img" aria-label="${Math.round(pct * 100)} procent naar de volgende mijlpaal">
      <defs><clipPath id="glassClip"><path d="${shape}"/></clipPath></defs>
      <g clip-path="url(#glassClip)">
        <rect width="140" height="190" fill="rgba(255,255,255,.05)"/>
        ${pct > 0.02 ? `<rect x="0" y="${level}" width="140" height="190" fill="url(#beerFill)"/>` : ''}
        ${bubbles}
        ${foam}
      </g>
      <path d="${shape}" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="3"/>
      <path d="M33 28 L41 158" stroke="rgba(255,255,255,.25)" stroke-width="5" stroke-linecap="round"/>
    </svg>`;
}
const stat = (key, label, val, ico, sub, isCount = true) => `
  <div class="stat card">
    <div class="stat-ico">${ico}</div>
    <div class="stat-val" ${isCount ? `data-count="${val}" data-key="${key}"` : ''}>${isCount ? (S.prevCounts[key] ?? 0) : val}</div>
    <div class="stat-label">${label}</div>
    <div class="stat-sub">${sub}</div>
  </div>`;

function podium(users) {
  return `<div class="podium">${[1, 0, 2].map((i) => {
    const u = users[i], place = i + 1;
    if (!u || !u.total) return `
      <div class="pod pod-${place} empty">
        <div class="pod-person"><span class="avatar lg ghost">?</span><div class="pod-name">Vrij plekje</div><div class="pod-badges"></div></div>
        <div class="pod-block"><span class="pod-place">${place}</span></div>
      </div>`;
    return `
      <div class="pod pod-${place}">
        <div class="pod-person">
          ${place === 1 ? '<div class="crown">👑</div>' : ''}
          ${avatar(u.name, 'lg')}
          <div class="pod-name">${esc(u.name)}</div>
          <div class="pod-badges">${badgeIcons(u.badges)}</div>
        </div>
        <div class="pod-block"><span class="pod-place">${place}</span><span class="pod-score">${u.total} 🍺</span></div>
      </div>`;
  }).join('')}</div>`;
}

// Laatste plek = zielig zwijn (alleen als niet iedereen gelijk staat)
function isZielig(u, users) {
  if (users.length < 2) return false;
  const totals = users.map((x) => x.total);
  const min = Math.min(...totals), max = Math.max(...totals);
  return min < max && u.total === min;
}

function userStatus(u) {
  if (!u.lastTs) return `<span class="st-new">Nog geen bier. De teller wacht!</span>`;
  const since = Date.now() - u.lastTs;
  if (u.lastHour >= 3) return `<span class="st-fire">💥 ${u.lastHour} dit uur, kanonnier!</span>`;
  if (u.lastHour === 2) return `<span class="st-fire">🔥 2 dit uur</span>`;
  if (since >= 12 * HOUR) return `<span class="st-sleep">💤 Ligt nog in het hol… of is ${esc(firstName(u.name))} verdwaald?</span>`;
  if (since >= TWO_H) return `<span class="st-sleep">💤 ${duration(since)} droog. Kom op ${esc(firstName(u.name))}!</span>`;
  return `<span>laatste ${timeAgo(u.lastTs)}</span>`;
}

function renderDashboard() {
  const s = S.state;
  const { totals, users, feed, badges } = s;
  const ms = milestone(totals.all);
  const pct = Math.max(0, Math.min(1, (totals.all - ms.prev) / (ms.next - ms.prev)));
  const maxTotal = Math.max(1, ...users.map((u) => u.total));
  const meId = S.me?.user.id;
  const avg = users.length ? (totals.all / users.length).toLocaleString('nl-NL', { maximumFractionDigits: 1 }) : '0';
  const newestSeen = S.seenFeedTs;

  app.innerHTML = `
    <section class="hero card">
      <div>
        <div class="eyebrow">Groepstotaal · Najaarsweekend</div>
        <div class="big-number" data-count="${totals.all}" data-key="all">${S.prevCounts.all ?? 0}</div>
        <div class="big-label">bier weggewerkt door de rotte</div>
        <p class="hero-cheer">${esc(groupCheer(s, ms))}</p>
        <div class="milestone">
          <div class="milestone-bar"><i style="width:${(pct * 100).toFixed(1)}%"></i></div>
          <div class="milestone-labels"><span>${ms.prev}</span><span>Volgende mijlpaal: <b>${ms.next}</b></span></div>
        </div>
        ${S.me
          ? `<a class="btn btn-amber" href="#/mijn">🍺 Bier erbij</a>`
          : `<a class="btn btn-amber" href="#/login">🐗 Doe mee: log in</a>`}
      </div>
      <div class="hero-glass">${glassSvg(pct)}</div>
    </section>

    <section class="stats">
      ${stat('today', 'Vandaag', totals.today, '🍺', 'sinds 06:00')}
      ${stat('hour', 'Afgelopen uur', totals.lastHour, '🔥', totals.lastHour ? 'het bos leeft' : 'tijd voor een rondje')}
      ${stat('users', 'Zwijnen', users.length, '🐗', `${totals.activeToday} vandaag actief`)}
      ${stat('avg', 'Gemiddeld', avg, '📊', 'bier per zwijn', false)}
    </section>

    <div class="grid">
      <div>
        <section class="card">
          <h2 class="card-title">🏆 Het podium</h2>
          ${podium(users)}
        </section>
        <section class="card">
          <h2 class="card-title">🐗 De hele rotte <small>${users.length} ${users.length === 1 ? 'zwijn' : 'zwijnen'}</small></h2>
          ${users.length ? `<ol class="ranking">${users.map((u, i) => `
            <li class="row${u.id === meId ? ' is-me' : ''}">
              <span class="rank">${i + 1}</span>
              ${avatar(u.name)}
              <div>
                <div class="row-top"><b>${esc(u.name)}</b>${u.id === meId ? '<span class="me-tag">JIJ</span>' : ''}${isZielig(u, users) ? '<span class="zielig-tag">🥺 Zielig zwijn</span>' : ''}<span class="row-badges">${badgeIcons(u.badges)}</span></div>
                <div class="bar"><i style="width:${((u.total / maxTotal) * 100).toFixed(1)}%"></i></div>
                <div class="row-sub"><span>Vandaag <b>${u.today}</b></span>${userStatus(u)}</div>
              </div>
              <span class="row-total">${u.total}<small>totaal</small></span>
            </li>`).join('')}</ol>`
          : `<div class="empty-state">Nog niemand in het bos.<br><a class="btn btn-amber" href="#/login">Meld je als eerste zwijn</a></div>`}
        </section>
      </div>

      <div>
        <section class="card">
          <h2 class="card-title">📡 Live uit het bos</h2>
          ${feed.length ? `<ul class="feed">${feed.map((f) => {
            const ico = f.inHour >= 3 ? '💥' : f.inHour === 2 ? '🔥' : f.dayNum === 1 ? '🌅' : '🍺';
            const what = f.inHour >= 3 ? `pakte nr. ${f.inHour} binnen het uur. Kanonnier!`
              : f.inHour === 2 ? 'zit op tempo: 2e binnen het uur'
              : f.dayNum === 1 ? 'opende de dag met een bier'
              : `opende bier nr. ${f.dayNum} van vandaag`;
            return `<li class="${newestSeen && f.ts > newestSeen ? 'new' : ''}"><span class="feed-ico">${ico}</span><div><b>${esc(f.name)}</b> ${what}<small>${timeAgo(f.ts)} · ${clock(f.ts)}</small></div></li>`;
          }).join('')}</ul>`
          : `<p class="muted">Nog geen activiteit. Het eerste blikje verschijnt hier live.</p>`}
        </section>
        <section class="card">
          <h2 class="card-title">🎖️ Badges</h2>
          <ul class="badge-list">${badges.map((b) => {
            const holders = users.filter((u) => u.badges.includes(b.id)).map((u) => u.name);
            return `<li class="${holders.length ? '' : 'unclaimed'}">
              <span class="badge-big">${b.icon}</span>
              <div><b>${esc(b.name)}</b><small>${esc(b.desc)}</small>
              <small class="${holders.length ? 'holders' : ''}">${holders.length ? esc(holders.join(', ')) : 'Nog niemand. Wie pakt hem?'}</small></div>
            </li>`;
          }).join('')}</ul>
        </section>
      </div>
    </div>`;
  if (feed.length) S.seenFeedTs = feed[0].ts;
  animateCounts();
}

// ================= Mijn bier =================
function renderMine() {
  const s = S.state, me = S.me;
  const idx = s.users.findIndex((u) => u.id === me.user.id);
  const u = s.users[idx] || { total: 0, today: 0, lastHour: 0, badges: [] };
  const last = me.beers.at(-1);
  const todays = me.beers.filter((b) => b.day === me.today);
  const canUndo = last && Date.now() - last.ts < UNDO_WINDOW;
  const ahead = idx > 0 ? s.users[idx - 1] : null;
  const gap = ahead ? ahead.total - u.total + 1 : 0;
  const motivation = !u.total
    ? 'Je teller staat nog op nul. Tijd om het bos wakker te maken!'
    : idx === 0 ? 'Jij leidt de rotte! Houd die kroon vast. 👑'
    : isZielig(u, s.users) ? `Jij bent nu het zielige zwijn 🥺 Nog ${gap} bier om ${ahead.name} in te halen!`
    : `Nog ${gap} bier om ${ahead.name} in te halen!`;

  app.innerHTML = `
    <section class="mine-hero card">
      <div class="mine-head">
        ${avatar(me.user.name, 'lg')}
        <div><div class="eyebrow">Proost,</div><h1>${esc(me.user.name)}</h1></div>
        <div class="mine-rank">${idx >= 0 ? '#' + (idx + 1) : '–'}<small>positie</small></div>
      </div>
      <button class="proost" id="proost" aria-label="Bier toevoegen">
        <span class="proost-ring"></span>
        <svg class="proost-can" aria-hidden="true"><use href="#can"/></svg>
        <span class="proost-label">Proost!<b>+1</b></span>
      </button>
      <p class="motivation">${esc(motivation)}</p>
      <div class="mine-stats">
        <div><b data-count="${u.today}" data-key="m-today">${S.prevCounts['m-today'] ?? 0}</b><span>vandaag</span></div>
        <div><b data-count="${u.lastHour}" data-key="m-hour">${S.prevCounts['m-hour'] ?? 0}</b><span>afgelopen uur</span></div>
        <div><b data-count="${u.total}" data-key="m-total">${S.prevCounts['m-total'] ?? 0}</b><span>totaal</span></div>
      </div>
      ${canUndo ? `<button class="link-btn" id="undo">↩︎ Verkeerd getikt? Bier van ${clock(last.ts)} ongedaan maken</button>` : ''}
    </section>

    <div class="grid">
      <section class="card">
        <h2 class="card-title">🕒 Jouw bier vandaag <small>${todays.length}</small></h2>
        ${todays.length
          ? `<div class="chips">${todays.map((b, i) => `<span class="chip"><b>#${i + 1}</b> 🍺 ${clock(b.ts)}</span>`).join('')}</div>`
          : '<p class="muted">Nog niks vandaag. De eerste levert je een compliment op 😉</p>'}
      </section>
      <section class="card">
        <h2 class="card-title">🎖️ Jouw badges <small>${u.badges.length}/${s.badges.length}</small></h2>
        <ul class="my-badges">${s.badges.map((b) => `
          <li class="${u.badges.includes(b.id) ? 'earned' : ''}">
            <span class="mb-ico">${b.icon}</span>
            <div><b>${esc(b.name)}</b><small>${esc(b.desc)}</small></div>
          </li>`).join('')}</ul>
      </section>
    </div>`;

  $('#proost').addEventListener('click', drink);
  $('#undo')?.addEventListener('click', undo);
  animateCounts();
}

async function drink() {
  if (S.busy) return;
  S.busy = true;
  const btn = $('#proost');
  btn.disabled = true;
  btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop');
  try {
    const r = await api('/api/beer', { method: 'POST' });
    navigator.vibrate?.(60);
    const plus = document.createElement('span');
    plus.className = 'plus-one';
    plus.textContent = '+1';
    btn.appendChild(plus);
    await new Promise((res) => setTimeout(res, 550));
    await Promise.all([loadMe(), loadState()]);
    S.busy = false;
    if (route() === 'mijn') renderMine();
    beerPopups(r);
    checkPodium();
  } catch (e) {
    S.busy = false;
    btn.disabled = false;
    toast(e.message);
  }
}

function beerPopups(r) {
  const naam = firstName(S.me.user.name);
  let shown = false;
  if (r.total > 0 && r.total % 7 === 0) {
    const level = r.total / 7;
    const [emoji, titel] = TXT.zevenTitels[Math.min(level, TXT.zevenTitels.length) - 1];
    const pool = TXT.zeven.slice();
    const lines = [];
    for (let i = 0; i < 3 && pool.length; i++) lines.push(fillIn(pool.splice(Math.floor(Math.random() * pool.length), 1)[0], { naam, n: r.total }));
    popup({ kind: 'zeven', emoji, kicker: `${r.total} bier · zeven-salvo`, title: titel, lines, confetti: 'big', button: 'Ik neem de eer in ontvangst 👑' });
    shown = true;
  }
  if (r.firstOfDay) {
    const [title, text] = pick(TXT.first);
    popup({ emoji: '🌅', kicker: 'Eerste van de dag', title, text: fillIn(text, { naam }), confetti: true });
    shown = true;
  } else if (r.hourCount >= 2) {
    const n = r.hourCount;
    const [title, text] = pick(n === 2 ? TXT.hour2 : n === 3 ? TXT.hour3 : TXT.hourN);
    popup({ emoji: n >= 4 ? '👑' : n === 3 ? '💥' : '🔥', kicker: `${n} binnen een uur`, title, text: fillIn(text, { naam, n }), confetti: n >= 3 ? 'big' : true });
    shown = true;
  }
  for (const b of r.newBadges || []) {
    popup({ emoji: b.icon, kicker: 'Nieuwe badge!', title: b.name, text: `${b.desc}. Dik verdiend, ${naam}!`, confetti: true, button: 'Yes! 🐗' });
    shown = true;
  }
  if (!shown) toast(`Proost! Nummer ${r.todayCount} van vandaag 🍺`);
}

async function undo() {
  if (S.busy) return;
  S.busy = true;
  try {
    await api('/api/undo', { method: 'POST' });
    await Promise.all([loadMe(), loadState()]);
    toast('Teruggedraaid. Geen zorgen, het zwijn vergeeft je 🐗');
  } catch (e) {
    toast(e.message);
  }
  S.busy = false;
  if (route() === 'mijn') renderMine();
}

// Pilsvlinder-melding: elke keer dat je op het podium komt of een podiumplek stijgt.
function checkPodium() {
  if (!S.me || !S.state) return;
  const users = S.state.users;
  const idx = users.findIndex((u) => u.id === S.me.user.id);
  const place = idx >= 0 && idx < 3 && users[idx].total > 0 ? idx + 1 : 0;
  const key = 'zwijn-podium-' + S.me.user.id;
  let prev = null;
  try { const v = localStorage.getItem(key); prev = v === null ? null : Number(v); } catch {}
  try { localStorage.setItem(key, String(place)); } catch {}
  if (place && (prev === null || prev === 0 || place < prev)) {
    const [title, text] = pick(TXT.podium[place]);
    popup({ kind: 'vlinder', emoji: '🦋', kicker: `Pilsvlinder-melding · plek ${place}`, title, text: fillIn(text, { naam: firstName(S.me.user.name) }), confetti: 'big', button: 'Fladderen maar! 🍺' });
  }
}

// 2 uur niks gedronken? Aanmoedigen (één keer per droge periode van 2 uur).
function checkDrought() {
  if (!S.me || S.busy) return;
  const naam = firstName(S.me.user.name);
  const last = S.me.beers.at(-1);
  if (!last) {
    if (!S.welcomed) {
      S.welcomed = true;
      popup({ kind: 'nudge', emoji: '🐗', kicker: 'Nieuw zwijn', title: TXT.welcome[0], text: fillIn(TXT.welcome[1], { naam }), button: 'Ik ga ervoor!' });
    }
    return;
  }
  const now = Date.now();
  const since = now - last.ts;
  if (since < TWO_H) return;
  const key = 'zwijn-nudge-' + S.me.user.id;
  let seen = {};
  try { seen = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
  if (seen.last === last.ts && now - seen.at < TWO_H) return;
  const [title, text] = pick(TXT.drought);
  popup({ kind: 'nudge', emoji: '🍺', kicker: `${duration(since)} droog`, title, text: fillIn(text, { naam, tijd: duration(since) }), button: 'Ik pak er een! 🍻' });
  try { localStorage.setItem(key, JSON.stringify({ last: last.ts, at: now })); } catch {}
}

// ================= Login =================
function renderLogin(mode = 'login', name = '') {
  app.innerHTML = `
    <section class="auth card">
      <svg class="auth-boar" aria-hidden="true"><use href="#boar"/></svg>
      <h1 class="auth-title">Welkom in het bos</h1>
      <p class="muted">Log in om je bier bij te houden. Nieuw hier? Maak in 10 seconden een account.</p>
      <div class="tabs" role="tablist">
        <button type="button" role="tab" data-mode="login" class="${mode === 'login' ? 'active' : ''}" aria-selected="${mode === 'login'}">Inloggen</button>
        <button type="button" role="tab" data-mode="register" class="${mode === 'register' ? 'active' : ''}" aria-selected="${mode === 'register'}">Nieuw zwijn</button>
      </div>
      <form id="authForm" novalidate>
        <label>Gebruikersnaam
          <input name="name" autocomplete="username" required minlength="2" maxlength="20" placeholder="bv. Sanne" value="${esc(name)}" autocapitalize="words">
        </label>
        <label>Wachtwoord
          <input name="pin" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required minlength="4" maxlength="12" placeholder="••••">
        </label>
        ${mode === 'register' ? '<p class="form-hint">Kies een korte code van minimaal 4 tekens. Makkelijk te onthouden, ook na een paar bier 😉</p>' : ''}
        <div class="form-error" role="alert"></div>
        <button class="btn btn-amber btn-block" type="submit">${mode === 'login' ? 'Inloggen' : 'Account maken & proosten'}</button>
      </form>
    </section>`;

  app.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => renderLogin(b.dataset.mode, $('#authForm').name.value);
  });
  const form = $('#authForm');
  (name ? form.pin : form.name).focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = form.querySelector('.form-error');
    const btn = form.querySelector('button[type=submit]');
    const data = { name: form.name.value.trim(), pin: form.pin.value };
    if (data.name.length < 2) { err.textContent = 'Vul een naam in van minimaal 2 tekens.'; return; }
    if (data.pin.length < 4) { err.textContent = 'Je wachtwoord moet minimaal 4 tekens zijn.'; return; }
    err.textContent = '';
    btn.disabled = true;
    try {
      await api(`/api/${mode}`, { method: 'POST', body: data });
      await Promise.all([loadMe(), loadState()]);
      location.hash = '#/mijn';
      setTimeout(() => { checkDrought(); checkPodium(); }, 600);
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  };
}

// ================= Routing & data =================
async function loadMe() {
  const d = await api('/api/me');
  S.me = d.user ? d : null;
  renderUserChip();
}
async function loadState() {
  S.state = await api('/api/state');
}
function route() {
  return location.hash.replace(/^#\/?/, '').split('?')[0] || 'dashboard';
}
function render() {
  const r = route();
  document.querySelectorAll('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === r));
  if (!S.state) return;
  if (r === 'mijn' && !S.me) { location.hash = '#/login'; return; }
  if (r === 'login') { if (S.me) { location.hash = '#/mijn'; return; } renderLogin(); }
  else if (r === 'mijn') renderMine();
  else renderDashboard();
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', render);

async function poll() {
  if (document.hidden || S.busy) return;
  try {
    await Promise.all([loadState(), S.me ? loadMe() : null]);
    const r = route();
    // Bij het dashboard en "mijn bier" alles live bijwerken (scrollpositie blijft staan)
    if (r === 'dashboard' || r === '') renderDashboard();
    else if (r === 'mijn' && S.me && !S.busy) renderMine();
    checkDrought();
    checkPodium();
  } catch {}
}

async function init() {
  buildScene();
  renderUserChip();
  try {
    await Promise.all([loadMe(), loadState()]);
  } catch (e) {
    app.innerHTML = `<div class="loading">😵 Kon het bos niet bereiken. Ververs de pagina even.<br><small>${esc(e.message)}</small></div>`;
    return;
  }
  render();
  setTimeout(() => { checkDrought(); checkPodium(); }, 1200);
  setInterval(poll, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
}
init();
