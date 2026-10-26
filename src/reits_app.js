(function(){
'use strict';
const $ = s => document.querySelector(s);
const el = (tag, attrs, ...kids) => { const e = document.createElement(tag); if (attrs) for (const k in attrs) { if (k === 'class') e.className = attrs[k]; else if (k === 'html') e.innerHTML = attrs[k]; else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] != null) e.setAttribute(k, attrs[k]); } for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c)); return e; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- formatting ----------
const fm = v => v == null || !isFinite(v) ? '—' : Math.abs(v) >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : Math.abs(v) >= 1e6 ? '$' + (v / 1e6).toFixed(Math.abs(v) >= 1e8 ? 0 : 1) + 'M' : v === 0 ? '$0' : '$' + Math.round(v / 1e3) + 'K';
const fp = (v, d = 0) => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(d) + '%';
const fr = (v, d = 2) => v == null || !isFinite(v) ? '—' : Number(v).toFixed(d) + '%';
const fx = v => v == null || !isFinite(v) ? '—' : Number(v).toFixed(2) + '×';
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fd = iso => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return MON[+m - 1] + ' ' + (+d) + ', ' + y; };
const fmy = d => MON[d.getMonth()] + ' ' + d.getFullYear();
const edgar = (cik, acc, doc) => `https://www.sec.gov/Archives/edgar/data/${cik}/${String(acc).replace(/-/g, '')}/${doc}`;

const BUCKETS = [
  { k: 'Self-funded', c: 'cash' }, { k: 'Revolver covers it', c: 'ready' }, { k: 'Routine refinance', c: 'mezz' },
  { k: 'Needs new capital', c: 'gap' }, { k: 'Stretched', c: 'work' }, { k: 'Insufficient data', c: 'na' },
];
const BC = Object.fromEntries(BUCKETS.map(b => [b.k, b.c]));
const pill = b => el('span', { class: 'pill', style: `background:var(--b-${BC[b]}-bg);color:var(--b-${BC[b]})` }, el('i', { style: `background:var(--b-${BC[b]})` }), b);
const SEVC = ['var(--line)', 'var(--sev1)', 'var(--sev2)', 'var(--sev3)'];

// ---------- assumptions ----------
const clone = o => JSON.parse(JSON.stringify(o));
let A = clone(RW_DEFAULTS);
try { const s = localStorage.getItem('rw-assump-v1'); if (s) { const p = JSON.parse(s); if (p && p.tiers && p.tiers.length === A.tiers.length) A = Object.assign(A, p); } } catch (e) {}
// index rates always come from the latest daily update, never from a saved copy
Object.assign(A, { ust10: RW_DEFAULTS.ust10, sofr: RW_DEFAULTS.sofr, ust10Date: RW_DEFAULTS.ust10Date, sofrDate: RW_DEFAULTS.sofrDate, asOf: RW_DEFAULTS.asOf });
const saveA = () => { try { localStorage.setItem('rw-assump-v1', JSON.stringify(A)); } catch (e) {} };

// ---------- state ----------
const F = { q: '', sector: '', bucket: '', min: 0, flag: '', levMin: null, dueShareMin: null };
let view = 'cos', limit = 80, sortKey = 'score', sortDir = -1, secSortKey = 'due', secSortDir = -1, selected = null;
const DATA = REITS.filter(r => !r.error);
let R = [];
function compute() { R = DATA.map(r => ({ r, s: rwSize(r, A) })); }
const winEnd = () => { const d = new Date(RW_TODAY); d.setMonth(d.getMonth() + A.windowMonths); return d; };

// ---------- header + rate sheet ----------
function renderStamp() {
  $('#asOf').textContent = fd(RW_DEFAULTS.ust10Date) + ' close';
  const q = DATA.map(r => r.asOf).filter(Boolean).sort();
  const latest = q[q.length - 1];
  $('#filAsOf').textContent = `10-K and 10-Q, financials through ${latest ? fd(latest) : '—'}`;
  $('#nAbout').textContent = DATA.length;
}
function renderRates() {
  const box = $('#rates'); box.textContent = '';
  box.append(
    el('div', { class: 'rate idx' }, el('div', { class: 'nm' }, '10-yr Treasury', el('small', null, 'index')), el('div', { class: 'big' }, fr(A.ust10)), el('div', { class: 'con' }, 'U.S. Treasury close, ' + fd(RW_DEFAULTS.ust10Date))),
    el('div', { class: 'rate idx' }, el('div', { class: 'nm' }, 'SOFR', el('small', null, 'index')), el('div', { class: 'big' }, fr(A.sofr)), el('div', { class: 'con' }, 'New York Fed, ' + fd(RW_DEFAULTS.sofrDate))));
  let lo = 0;
  for (const t of A.tiers) {
    box.append(el('div', { class: 'rate' }, el('div', { class: 'nm' }, t.name, el('small', null, t.term)), el('div', { class: 'big' }, fr(A.ust10 + t.spread / 100)),
      el('div', { class: 'sp' }, `+${t.spread} bps over 10-yr`), el('div', { class: 'con' }, t.maxLev >= 999 ? `Leverage over ${lo}%` : `Leverage ${lo ? lo + '% to ' : 'up to '}${t.maxLev}%`)));
    lo = t.maxLev;
  }
  box.append(el('div', { class: 'rate' }, el('div', { class: 'nm' }, 'Bank term loan', el('small', null, '3 to 5-yr')), el('div', { class: 'big' }, fr(A.sofr + A.bank.spread / 100)),
    el('div', { class: 'sp' }, `+${A.bank.spread} bps over SOFR`), el('div', { class: 'con' }, 'Unsecured, floating')));
  box.append(el('div', { class: 'rate' }, el('div', { class: 'nm' }, 'Pref / JV equity', el('small', null, 'rescue capital')), el('div', { class: 'big' }, fr(A.pref.rate, 1)),
    el('div', { class: 'sp' }, 'target return'), el('div', { class: 'con' }, 'For REITs that can’t borrow more')));
  const rates = R.map(x => x.s.rate).filter(v => v != null && v > 0.5 && v < 15).sort((a, b) => a - b);
  const med = rates[Math.floor(rates.length / 2)];
  const ig = A.ust10 + A.tiers[0].spread / 100;
  const added = R.reduce((a, x) => a + (x.s.addedInterest > 0 ? x.s.addedInterest : 0), 0);
  $('#shockline').innerHTML = `These REITs pay a median <b>${med.toFixed(2)}%</b> on their debt today. A 10-year investment-grade REIT bond prices near <b>${ig.toFixed(2)}%</b>, <b>${ig >= med ? '+' : ''}${Math.round((ig - med) * 100)} bps</b>. Refinancing everything due by ${fmy(winEnd())} at today’s rates adds about <b>${fm(added)}</b> a year in interest across the group.`;
}
function renderAssumpEditor() {
  const tb = $('#tierEdit'); tb.textContent = '';
  A.tiers.forEach((t, i) => {
    const inp = (key, step) => el('input', { type: 'number', step, value: t[key], 'aria-label': `${t.name} ${key}`, oninput: e => { const v = parseFloat(e.target.value); if (isFinite(v)) { t[key] = v; changed(); } } });
    tb.append(el('tr', null, el('td', null, t.name + ' ', el('span', { class: 'note' }, t.term)), el('td', null, '10-yr UST'), el('td', null, inp('spread', 5)), el('td', null, t.maxLev >= 999 ? el('span', { class: 'note' }, 'above') : inp('maxLev', 1))));
  });
  const bind = (id, get, set) => { const e = $(id); e.value = get(); e.oninput = () => { const v = parseFloat(e.value); if (isFinite(v)) { set(v); changed(); } }; };
  bind('#aUst', () => A.ust10, v => A.ust10 = v); bind('#aSofr', () => A.sofr, v => A.sofr = v);
  bind('#aBank', () => A.bank.spread, v => A.bank.spread = v); bind('#aPref', () => A.pref.rate, v => A.pref.rate = v);
  bind('#aWin', () => A.windowMonths, v => A.windowMonths = Math.max(3, Math.min(60, Math.round(v))));
  bind('#aLevR', () => A.levRefi, v => A.levRefi = v); bind('#aLevH', () => A.levHigh, v => A.levHigh = v);
}
let chT; function changed() { clearTimeout(chT); chT = setTimeout(() => { saveA(); compute(); renderRates(); renderSummary(); renderList(); if (selected) openCo(selected, true); }, 120); }

// ---------- summary ----------
function renderSummary() {
  const due = R.reduce((a, x) => a + x.s.due, 0);
  const due12 = R.reduce((a, x) => a + x.s.due12, 0);
  const need = R.reduce((a, x) => a + x.s.need, 0);
  const str = R.filter(x => x.s.bucket === 'Stretched');
  const k = $('#kpis'); k.textContent = '';
  const add = (v, l) => k.append(el('div', { class: 'kpi' }, el('div', { class: 'v' }, v), el('div', { class: 'l' }, l)));
  add(DATA.length.toLocaleString(), 'listed equity REITs tracked');
  add(fm(due), `debt due by ${fmy(winEnd())}`);
  add(fm(due12), 'due in the next 12 months');
  add(fm(need), 'that cash, cash flow and revolvers don’t cover');
  add(String(str.length), `stretched REITs with ${fm(str.reduce((a, x) => a + x.s.due, 0))} due`);
  const bySec = {}; R.forEach(x => bySec[x.r.sector] = (bySec[x.r.sector] || 0) + x.s.need);
  const top = Object.entries(bySec).sort((a, b) => b[1] - a[1])[0];
  add(top ? top[0] : '—', `sector needing the most outside capital (${fm(top ? top[1] : 0)})`);
  $('#mixH').textContent = `Outcome · share of debt due by ${fmy(winEnd())}`;
  const bar = $('#mixbar'), lg = $('#legend'); bar.textContent = ''; lg.textContent = '';
  for (const b of BUCKETS) {
    const rs = R.filter(x => x.s.bucket === b.k); if (!rs.length) continue;
    const v = rs.reduce((a, x) => a + x.s.due, 0);
    if (v > 0) bar.append(el('span', { style: `width:${v / due * 100}%;background:var(--b-${b.c})`, title: `${b.k}: ${fm(v)} (${rs.length} REITs)`, onclick: () => setBucket(b.k) }));
    lg.append(el('button', { class: 'lg', type: 'button', 'aria-pressed': String(F.bucket === b.k), onclick: () => setBucket(b.k) }, el('i', { style: `background:var(--b-${b.c})` }), b.k, el('span', { class: 'c' }, `${rs.length} · ${fm(v)}`)));
  }
}
function setBucket(k) { F.bucket = F.bucket === k ? '' : k; $('#fBucket').value = F.bucket; view = 'cos'; setView(); renderSummary(); renderList(); }

// ---------- quick screens ----------
const QUICK = [
  { t: 'Office REITs that need outside capital', f: { sector: 'Office' }, sort: 'need', test: x => x.s.need > 0 },
  { t: 'Dividend not covered, or barely', f: { flag: 'div' }, sort: 'divc' },
  { t: 'Biggest walls in the next 12 months', f: {}, sort: 'due12', test: x => x.s.due12 > 0.15 * x.s.debt },
  { t: 'Leverage over 55% of book', f: { levMin: 55 }, sort: 'lev' },
  { t: 'Stretched hotel and healthcare REITs', f: { bucket: 'Stretched' }, sort: 'score', test: x => /Hotels|Healthcare/.test(x.r.sector) },
  { t: 'Investment-grade names to pitch a bond deal', f: { bucket: 'Routine refinance' }, sort: 'due' },
];
let quickTest = null;
function renderQuick() {
  const c = $('#quickChips'); c.textContent = '';
  QUICK.forEach(q => c.append(el('button', { class: 'chip', type: 'button', onclick: () => applyQuick(q) }, q.t)));
}
function applyQuick(q) {
  clearFilters(false);
  Object.assign(F, q.f); quickTest = q.test || null;
  sortKey = q.sort; sortDir = (SORTS[q.sort] || [0, -1])[1];
  if (F.sector) $('#fSector').value = F.sector; if (F.bucket) $('#fBucket').value = F.bucket;
  const o = [...$('#fSort').options].find(o => o.value === q.sort); if (o) $('#fSort').value = q.sort;
  view = 'cos'; setView(); renderSummary(); renderList();
  const n = R.filter(passes).length;
  $('#quickOut').textContent = `${q.t}: ${n} REIT${n === 1 ? '' : 's'}.`;
  window.scrollTo({ top: $('#tblCos').getBoundingClientRect().top + scrollY - 120, behavior: 'smooth' });
}

// ---------- filters ----------
function fillSelects() {
  const secs = [...new Set(DATA.map(r => r.sector))].sort();
  const ss = $('#fSector'); ss.textContent = ''; ss.append(el('option', { value: '' }, `All sectors (${secs.length})`));
  secs.forEach(s => ss.append(el('option', { value: s }, `${s} · ${DATA.filter(r => r.sector === s).length}`)));
  const bs = $('#fBucket'); bs.textContent = ''; bs.append(el('option', { value: '' }, 'All outcomes')); BUCKETS.forEach(b => bs.append(el('option', { value: b.k }, b.k)));
}
function passes(x) {
  const { r, s } = x;
  if (F.sector && r.sector !== F.sector) return false;
  if (F.bucket && s.bucket !== F.bucket) return false;
  if (F.min && s.due < F.min * 1e6) return false;
  if (F.flag && !s.flags.some(f => f.k === F.flag && f.sev >= 2)) return false;
  if (F.levMin != null && !(s.lev != null && s.lev * 100 >= F.levMin)) return false;
  if (quickTest && !quickTest(x)) return false;
  if (F.q) { const q = F.q.toLowerCase(); const hay = (r.name + ' ' + r.ticker + ' ' + r.sector).toLowerCase(); if (!q.split(/\s+/).every(t => hay.includes(t))) return false; }
  return true;
}
const SORTS = {
  score: [x => x.s.score, -1], due: [x => x.s.due, -1], due12: [x => x.s.due12, -1], need: [x => x.s.need, -1], dueShare: [x => x.s.dueShare ?? -1, -1],
  lev: [x => x.s.lev ?? -1, -1], divc: [x => x.s.divCover ?? 99, 1], shock: [x => x.s.shockBps ?? -999, -1], sector: [x => x.r.sector + '|' + String(9e12 - x.s.due).padStart(14, '0'), 1],
  name: [x => x.r.name.toLowerCase(), 1], debt: [x => x.s.debt, -1], fund: [x => x.s.cash + Math.max(x.s.rcfWin, 0) + (x.s.revolver || 0), -1],
  rate: [x => x.s.rate ?? 99, 1], bucket: [x => BUCKETS.findIndex(b => b.k === x.s.bucket), 1], flags: [x => x.s.flags.reduce((a, f) => a + f.sev, 0), -1],
};
function sorted(rows) { const [fn] = SORTS[sortKey] || SORTS.score; return rows.slice().sort((a, b) => { const x = fn(a), y = fn(b); return (x < y ? -1 : x > y ? 1 : 0) * sortDir; }); }

// ---------- companies table ----------
const COLS = [
  ['score', 'Score', ''], ['name', 'Company', ''], ['sector', 'Sector', ''], ['debt', 'Total debt', 'r'], ['due', 'Due in window', 'r'],
  ['fund', 'Cash + cash flow + revolver', 'r'], ['need', 'Outside capital', 'r'], ['lev', 'Leverage', 'r'], ['divc', 'Dividend cover', 'r'],
  ['rate', 'Rate → today', 'r'], ['bucket', 'Outcome', ''], ['flags', 'Flags', ''],
];
function renderHead() {
  const h = $('#thead'); h.textContent = '';
  for (const [k, lab, cls] of COLS) {
    const on = sortKey === k;
    h.append(el('th', { class: cls, scope: 'col', tabindex: '0', 'aria-sort': on ? (sortDir > 0 ? 'ascending' : 'descending') : 'none',
      onclick: () => headSort(k), onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); headSort(k); } } },
      k === 'due' ? `Due by ${fmy(winEnd())}` : lab, el('span', { class: 'ar' }, on ? (sortDir > 0 ? '↑' : '↓') : '')));
  }
}
function headSort(k) {
  if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = (SORTS[k] || [0, -1])[1]; }
  const opt = [...$('#fSort').options].find(o => o.value === k); if (opt) $('#fSort').value = k;
  renderList();
}
function renderList() {
  const rows = R.filter(passes);
  const due = rows.reduce((a, x) => a + x.s.due, 0), need = rows.reduce((a, x) => a + x.s.need, 0);
  $('#resCount').innerHTML = `<b>${rows.length}</b> REITs · <b>${fm(due)}</b> due by ${fmy(winEnd())} · <b>${fm(need)}</b> from outside` + extraNote();
  renderHead();
  if (view === 'sec') return renderSectors(rows);
  const body = $('#tbody'); body.textContent = '';
  const S = sorted(rows);
  let last = null;
  for (const x of S.slice(0, limit)) {
    const { r, s } = x;
    if (sortKey === 'sector' && r.sector !== last) {
      last = r.sector; const g = rows.filter(y => y.r.sector === r.sector);
      body.append(el('tr', { class: 'grp', style: 'cursor:default' }, el('td', { colspan: COLS.length, style: 'background:var(--surface-2);font-family:var(--cond);font-weight:600;font-size:12.5px;letter-spacing:.02em;padding:7px 10px' }, r.sector,
        el('span', { class: 'note', style: 'font-family:var(--sans);font-weight:400;margin-left:8px' }, `${g.length} REITs · ${fm(g.reduce((a, y) => a + y.s.due, 0))} due · ${fm(g.reduce((a, y) => a + y.s.need, 0))} from outside`))));
    }
    const sev = s.flags.filter(f => f.sev >= 2).sort((a, b) => b.sev - a.sev);
    const fund = s.cash + Math.max(s.rcfWin, 0) + (s.revolver || 0);
    body.append(el('tr', { tabindex: '0', class: selected === r.ticker ? 'sel' : '', onclick: () => openCo(r.ticker), onkeydown: e => { if (e.key === 'Enter') openCo(r.ticker); } },
      el('td', null, el('span', { class: 'score' + (s.score >= 70 ? ' hi' : '') }, s.score)),
      el('td', { style: 'min-width:200px' }, el('div', { class: 'pname' }, r.name, el('span', { class: 'tk' }, r.ticker))),
      el('td', null, r.sector),
      el('td', { class: 'r num' }, fm(s.debt)),
      el('td', { class: 'r num' }, fm(s.due), el('div', { class: 'psub' }, s.dueShare != null ? fp(s.dueShare) + ' of debt' : '')),
      el('td', { class: 'r num' }, fm(fund), el('div', { class: 'psub' }, s.revolver == null ? 'revolver not tagged' : '')),
      el('td', { class: 'r num ' + (s.need > 0 ? 'delta-up' : 'delta-dn') }, s.need > 0 ? fm(s.need) : '—'),
      el('td', { class: 'r num' }, fp(s.lev)),
      el('td', { class: 'r num' }, fx(s.divCover)),
      el('td', { class: 'r num' }, s.rate != null ? fr(s.rate) + ' → ' + fr(s.newRate) : '—', el('div', { class: 'psub' }, s.shockBps != null ? `${s.shockBps >= 0 ? '+' : ''}${s.shockBps} bps` : '')),
      el('td', null, pill(s.bucket)),
      el('td', { title: sev.map(f => f.t).join('\n') }, el('span', { class: 'flagdots' }, sev.slice(0, 4).map(f => el('i', { style: `background:${SEVC[f.sev]}` }))), sev.length ? '' : el('span', { class: 'note' }, '—'))));
  }
  $('#moreWrap').hidden = S.length <= limit;
  $('#moreBtn').textContent = `Show ${Math.min(80, S.length - limit)} more of ${S.length - limit}`;
}
function extraNote() {
  const p = [];
  if (F.flag === 'div') p.push('dividend not covered or thin');
  if (F.levMin != null) p.push(`leverage ≥ ${F.levMin}%`);
  if (quickTest) p.push('quick screen');
  return p.length ? ` · also: ${esc(p.join(', '))}` : '';
}

// ---------- sector view ----------
function renderSectors(rows) {
  const g = {}; rows.forEach(x => (g[x.r.sector] = g[x.r.sector] || []).push(x));
  const list = Object.entries(g).map(([sec, xs]) => {
    const levs = xs.map(x => x.s.lev).filter(v => v != null).sort((a, b) => a - b);
    return { sec, xs, n: xs.length, debt: xs.reduce((a, x) => a + x.s.debt, 0), due: xs.reduce((a, x) => a + x.s.due, 0), need: xs.reduce((a, x) => a + x.s.need, 0),
      lev: levs.length ? levs[Math.floor(levs.length / 2)] : null, top: xs.slice().sort((a, b) => b.s.need - a.s.need || b.s.due - a.s.due)[0] };
  });
  const keyf = { sec: x => x.sec, n: x => x.n, debt: x => x.debt, due: x => x.due, need: x => x.need, lev: x => x.lev ?? -1 }[secSortKey] || (x => x.due);
  list.sort((a, b) => { const x = keyf(a), y = keyf(b); return (x < y ? -1 : x > y ? 1 : 0) * secSortDir; });
  const h = $('#shead'); h.textContent = '';
  const SC = [['sec', 'Sector', ''], ['n', 'REITs', 'r'], ['debt', 'Total debt', 'r'], ['due', `Due by ${fmy(winEnd())}`, 'r'], ['need', 'Outside capital', 'r'], ['lev', 'Median leverage', 'r'], ['mix', 'Outcome mix', ''], ['top', 'Biggest need', '']];
  for (const [k, lab, cls] of SC) {
    const on = secSortKey === k, fixed = k === 'mix' || k === 'top';
    h.append(el('th', { class: cls, scope: 'col', tabindex: fixed ? null : '0', 'aria-sort': on ? (secSortDir > 0 ? 'ascending' : 'descending') : 'none',
      onclick: () => { if (fixed) return; if (secSortKey === k) secSortDir *= -1; else { secSortKey = k; secSortDir = k === 'sec' ? 1 : -1; } renderList(); } },
      lab, el('span', { class: 'ar' }, on ? (secSortDir > 0 ? '↑' : '↓') : '')));
  }
  const b = $('#sbody'); b.textContent = '';
  for (const x of list) {
    const mix = el('div', { class: 'msabar' });
    for (const bk of BUCKETS) { const v = x.xs.filter(y => y.s.bucket === bk.k).reduce((a, y) => a + y.s.due, 0); if (v) mix.append(el('span', { style: `width:${v / (x.due || 1) * 100}%;background:var(--b-${bk.c})`, title: `${bk.k}: ${fm(v)}` })); }
    b.append(el('tr', { tabindex: '0', onclick: () => pickSector(x.sec), onkeydown: e => { if (e.key === 'Enter') pickSector(x.sec); } },
      el('td', null, el('div', { class: 'pname' }, x.sec)), el('td', { class: 'r num' }, x.n), el('td', { class: 'r num' }, fm(x.debt)), el('td', { class: 'r num' }, fm(x.due)),
      el('td', { class: 'r num delta-up' }, x.need ? fm(x.need) : '—'), el('td', { class: 'r num' }, fp(x.lev)), el('td', null, mix),
      el('td', null, el('div', { style: 'font-size:12.5px' }, x.top.r.name, el('span', { class: 'tk' }, x.top.r.ticker)), el('div', { class: 'psub num' }, x.top.s.need ? fm(x.top.s.need) + ' from outside' : fm(x.top.s.due) + ' due'))));
  }
  $('#moreWrap').hidden = true;
}
function pickSector(sec) { F.sector = sec; $('#fSector').value = sec; view = 'cos'; setView(); renderList(); window.scrollTo({ top: $('#tblCos').getBoundingClientRect().top + scrollY - 90, behavior: 'smooth' }); }
function setView() { $('#vCos').setAttribute('aria-pressed', String(view === 'cos')); $('#vSec').setAttribute('aria-pressed', String(view === 'sec')); $('#tblCos').hidden = view !== 'cos'; $('#tblSec').hidden = view !== 'sec'; }

// ---------- drawer ----------
function ladderSvg(r, s) {
  const lad = r.ladder || {};
  const years = Object.keys(lad).filter(y => y !== 'later').map(Number).sort((a, b) => a - b);
  const cols = years.map(y => ({ lab: String(y), v: lad[y], inWin: rwOverlap(y, RW_TODAY, winEnd()) > 0 }));
  if (lad.later) cols.push({ lab: 'Later', v: lad.later, inWin: false });
  const W = 640, H = 190, pl = 8, pr = 8, pt = 22, pb = 26;
  const max = Math.max(...cols.map(c => c.v), 1);
  const bw = (W - pl - pr) / Math.max(cols.length, 1);
  const NS = 'http://www.w3.org/2000/svg';
  const sv = (t, a) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Debt maturities by year' });
  svg.append(sv('line', { x1: pl, x2: W - pr, y1: H - pb, y2: H - pb, stroke: 'var(--line)', 'stroke-width': 1 }));
  cols.forEach((c, i) => {
    const h = (H - pt - pb) * c.v / max, x = pl + i * bw + bw * 0.18, w = bw * 0.64;
    const rect = sv('rect', { x, y: H - pb - h, width: w, height: Math.max(h, c.v > 0 ? 1.5 : 0), rx: 3, fill: c.inWin ? 'var(--b-gap)' : 'var(--accent)', opacity: c.inWin ? 1 : 0.55 });
    const tt = sv('title', {}); tt.textContent = `${c.lab}: ${fm(c.v)}${c.inWin ? ' (in the window)' : ''}`; rect.append(tt); svg.append(rect);
    const l = sv('text', { x: x + w / 2, y: H - 8, 'text-anchor': 'middle', class: 'lab' }); l.textContent = c.lab; svg.append(l);
    if (c.v > 0) { const v = sv('text', { x: x + w / 2, y: H - pb - h - 6, 'text-anchor': 'middle', class: 'val' }); v.textContent = fm(c.v).replace('$', ''); svg.append(v); }
  });
  return el('div', { class: 'ladder' }, svg);
}
function srcText(r) {
  const m = { 'XBRL maturity tags': 'the company’s XBRL maturity tags', 'XBRL maturity tags by debt type': 'the company’s XBRL maturity tags, summed across debt types',
    'Maturity table in the 10-K debt note': 'the maturity table in the 10-K debt footnote', 'Loan and bond list in the 10-K debt note': 'the list of loans and bonds in the 10-K debt footnote, grouped by maturity year',
    'Read from the 10-K debt note': 'the 10-K debt footnote, read by hand because no table in it parses cleanly' };
  return m[r.ladderSrc] || r.ladderSrc;
}
let lastFocus = null;
function openCo(tk, keep) {
  const x = R.find(y => y.r.ticker === tk); if (!x) return;
  const { r, s } = x; selected = tk;
  if (!keep) lastFocus = document.activeElement;
  const d = $('#drawer'); const prev = keep ? d.scrollTop : 0; d.textContent = '';
  d.append(el('div', { class: 'dhead' },
    el('div', null, el('h2', { id: 'dTitle' }, r.name), el('div', { class: 'sub' }, [r.ticker, r.sector, r.asOf ? 'financials as of ' + fd(r.asOf) : null].filter(Boolean).join(' · ')),
      el('div', { class: 'row', style: 'margin-top:8px' }, pill(s.bucket), el('span', { class: 'score' + (s.score >= 70 ? ' hi' : '') }, s.score), el('span', { class: 'note' }, 'capital need score'))),
    el('button', { class: 'x', 'aria-label': 'Close', onclick: closeCo }, '×')));
  const body = el('div', { class: 'dbody' }); d.append(body);
  const fact = (k, v, sub) => el('div', { class: 'fact' }, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v, sub ? el('small', null, ' ' + sub) : null));

  body.append(el('section', { class: 'card' }, el('h3', null, 'The balance sheet today'), el('div', { class: 'facts' },
    fact('Total debt', fm(s.debt), r.debtEst ? 'from the 10-K schedule' : ''),
    fact(`Due by ${fmy(winEnd())}`, fm(s.due), s.dueShare != null ? fp(s.dueShare) + ' of debt' : ''),
    fact('Due in 12 months', fm(s.due12)),
    fact('Cash', fm(s.cash)),
    fact('Undrawn revolver', s.revolver == null ? 'not tagged' : fm(s.revolver)),
    fact('Operating cash flow', fm(s.ocf), 'last 12 mo'),
    fact('Dividends paid', fm(s.div), 'last 12 mo'),
    fact('Retained cash flow', fm(s.rcf), 'last 12 mo'),
    fact('Interest expense', fm(s.interest), 'last 12 mo'),
    fact('Average rate', fr(s.rate), s.rateEst ? 'interest ÷ debt' : 'reported'),
    fact('Leverage', fp(s.lev), s.levBasis + ', book'),
    fact('Dividend coverage', fx(s.divCover), 'cash flow ÷ dividends'),
    fact('Interest coverage', fx(s.intCover)),
  )));

  body.append(el('section', { class: 'card' }, el('h3', null, 'Debt maturities by year'), ladderSvg(r, s),
    el('p', { class: 'srcline' }, `Amber bars fall inside the window (today to ${fmy(winEnd())}); the current year is prorated for the months left. Source: ${srcText(r)}, as of ${fd(r.fyEnd)}.`, r.ladderNote ? ' ' + r.ladderNote + '.' : '',
      r.ladderCheck != null ? ` The schedule adds up to ${fp(r.ladderCheck)} of reported debt.` : '')));

  // sources and uses
  const segs = [
    { v: Math.min(s.cash, s.due), c: 'var(--b-cash)', lab: 'Cash' },
    { v: Math.max(Math.min(Math.max(s.rcfWin, 0), s.due - Math.min(s.cash, s.due)), 0), c: 'var(--b-ready)', lab: 'Retained cash flow' },
  ];
  const used = segs.reduce((a, y) => a + y.v, 0);
  segs.push({ v: Math.max(Math.min(s.revolver || 0, s.due - used), 0), c: 'var(--accent)', lab: 'Revolver' });
  segs.push({ v: s.need, c: s.bucket === 'Stretched' ? 'var(--b-work)' : 'var(--b-gap)', lab: 'Outside capital needed' });
  const shown = segs.filter(y => y.v > 1); const scale = shown.reduce((a, y) => a + y.v, 0) || 1;
  const sb = el('div', { class: 'stackbar' });
  shown.forEach(y => sb.append(el('span', { style: `width:${y.v / scale * 100}%;background:${y.c}`, title: `${y.lab}: ${fm(y.v)}` }, y.v / scale > 0.14 ? fm(y.v) : '')));
  body.append(el('section', { class: 'card' }, el('h3', null, `How the ${fm(s.due)} due by ${fmy(winEnd())} gets paid`),
    s.due > 0 ? el('div', { class: 'stack' }, sb, el('div', { class: 'stackleg' }, shown.map(y => el('span', null, el('i', { style: `background:${y.c}` }), `${y.lab}: `, el('b', { class: 'num' }, fm(y.v)))))) : el('p', { class: 'note', style: 'margin:0' }, 'Nothing in the schedule falls due in the window.'),
    el('p', { class: 'note', style: 'margin:10px 0 0' }, `Retained cash flow is the last 12 months of operating cash flow less dividends (${fm(s.rcf)}), scaled to ${A.windowMonths} months.${s.rcf != null && s.rcf < 0 ? ' It is negative, so dividends are draining cash.' : ''}${s.revolver == null ? ' The revolver isn’t counted because its undrawn amount isn’t tagged in the filing data; check the MD&A.' : ''}`)));

  // refinance cost by execution
  const cmp = el('div', { class: 'cmp' }); const t = el('table');
  t.append(el('thead', null, el('tr', null, ['Execution', 'All-in rate', 'vs today’s average', `Added interest on ${fm(s.due)}`, 'As % of cash flow'].map(h => el('th', { scope: 'col' }, h)))));
  const tb = el('tbody');
  const rows = A.tiers.map(ti => ({ name: ti.name, term: ti.term, rate: A.ust10 + ti.spread / 100, mine: ti.id === s.tier.id }))
    .concat([{ name: 'Bank term loan', term: `SOFR + ${A.bank.spread} bps`, rate: A.sofr + A.bank.spread / 100 }, { name: 'Pref / JV equity', term: 'target return', rate: A.pref.rate }]);
  for (const q of rows) {
    const add = s.rate != null ? s.due * (q.rate - s.rate) / 100 : null;
    tb.append(el('tr', { class: q.mine ? 'mine' : '' }, el('td', null, el('b', null, q.name), el('div', { class: 'bind' }, q.term + (q.mine ? (s.strongCover ? ' · its coverage points here' : ' · matches its leverage') : ''))),
      el('td', { class: 'num' }, fr(q.rate)), el('td', { class: 'num' }, s.rate != null ? `${q.rate >= s.rate ? '+' : ''}${Math.round((q.rate - s.rate) * 100)} bps` : '—'),
      el('td', { class: 'num' }, add != null ? (add >= 0 ? '+' : '−') + fm(Math.abs(add)) + ' / yr' : '—'), el('td', { class: 'num' }, add != null && s.ocf > 0 ? fp(add / s.ocf, 1) : '—')));
  }
  t.append(tb); cmp.append(t);
  body.append(el('section', { class: 'card' }, el('h3', null, 'What refinancing costs at today’s rates'), cmp,
    el('p', { class: 'note', style: 'margin:8px 0 0' }, s.strongCover ? `The highlighted row is investment grade: book leverage is ${fp(s.lev)}, but cash flow covers interest ${fx(s.intCover)}. Edit spreads and leverage bands in the rate sheet.` : `The highlighted row is the execution its leverage (${fp(s.lev)}) points to. Edit spreads and leverage bands in the rate sheet.`)));

  const fl = s.flags.slice().sort((a, b) => b.sev - a.sev);
  body.append(el('section', { class: 'card' }, el('h3', null, 'Risk flags'), fl.length ? el('ul', { class: 'flags' }, fl.map(f => el('li', null, el('i', { style: `background:${SEVC[f.sev]}` }), f.t))) : el('p', { class: 'note', style: 'margin:0' }, 'No flags.')));

  body.append(el('section', { class: 'card' }, el('h3', null, 'Pitch notes'), autoBrief(x)));

  const src = [];
  src.push(el('li', null, el('i', { style: 'background:var(--line)' }), el('span', null, `10-K for the year ended ${fd(r.fyEnd)} (filed ${fd(r.filed10K)}): `, el('a', { href: edgar(r.cik, r.acc10K, r.doc10K), target: '_blank', rel: 'noopener' }, 'SEC EDGAR'), ' · maturity schedule, total debt')));
  if (r.acc10Q) src.push(el('li', null, el('i', { style: 'background:var(--line)' }), el('span', null, `10-Q for the period ended ${fd(r.asOf)} (filed ${fd(r.filed10Q)}): `, el('a', { href: edgar(r.cik, r.acc10Q, r.doc10Q), target: '_blank', rel: 'noopener' }, 'SEC EDGAR'), ' · cash, revolver, year-to-date cash flow')));
  body.append(el('section', { class: 'card' }, el('h3', null, 'Sources'), el('ul', { class: 'flags' }, src)));

  $('#scrim').hidden = false; d.hidden = false; document.body.style.overflow = 'hidden';
  if (keep) d.scrollTop = prev; else d.querySelector('.x').focus();
}
function closeCo() { $('#drawer').hidden = true; $('#scrim').hidden = true; document.body.style.overflow = ''; selected = null; renderList(); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
$('#scrim').onclick = closeCo;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#drawer').hidden) closeCo(); });

function autoBrief(x) {
  const { r, s } = x;
  const box = el('div', { class: 'brief' });
  const lad = r.ladder || {};
  // the biggest maturity year still ahead (this year counts only for the months left)
  const big = Object.entries(lad).filter(([y]) => y !== 'later').map(([y, v]) => [y, v * rwOverlap(+y, RW_TODAY, winEnd())]).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1])[0];
  box.append(el('h4', null, 'Why now'));
  box.append(el('p', null, s.due > 0
    ? `${r.name} has ${fm(s.due)} of debt due by ${fmy(winEnd())}, ${fp(s.dueShare)} of its ${fm(s.debt)} total${big ? `, with the biggest share (${fm(big[1])}) in ${big[0]}` : ''}. ${s.rate != null ? `It pays about ${fr(s.rate)} today; the same debt refinances near ${fr(s.newRate)}${s.addedInterest > 0 ? `, adding roughly ${fm(s.addedInterest)} a year in interest` : ''}.` : ''}`
    : `${r.name} has little or nothing due in the window, so the conversation is about growth capital rather than maturities.`));
  const angle = {
    'Self-funded': 'Cash and retained cash flow cover what comes due. This isn’t a rescue: pitch acquisition financing, a development JV or a programmatic partnership.',
    'Revolver covers it': 'It can bridge the maturities on its credit line, but that uses up liquidity. Pitch terming out the revolver with a bond or term loan, or secured debt on unencumbered assets.',
    'Routine refinance': `It should be able to refinance in the market. Bankers: pitch a bond or term loan ahead of the ${big ? big[0] : 'next'} maturities. Lenders: offer secured debt as a cheaper alternative if spreads widen.`,
    'Needs new capital': 'Leverage is near the top of the range, so new debt alone is a stretch. Pitch JV equity on stabilized assets, asset sales, or preferred equity to fund part of the wall.',
    'Stretched': 'Cash flow, coverage or leverage is under strain. Pitch preferred equity or a JV recap, and expect it to sell assets. Lenders should expect tighter terms and structure.',
    'Insufficient data': 'The filings don’t give enough to size the need. Start from the 10-K debt footnote.',
  }[s.bucket];
  box.append(el('h4', null, 'The angle'), el('p', null, angle));
  const pts = [];
  if (s.lev != null) pts.push(`Leverage is ${fp(s.lev)} of ${s.levBasis} at book value${s.strongCover ? `, but cash flow covers interest ${fx(s.intCover)}, so it should price as investment grade` : `; the pricing band it falls in is ${s.tier.name.toLowerCase()}`}.`);
  if (s.divCover != null) pts.push(s.divCover < 1 ? `Dividends exceed operating cash flow (${fx(s.divCover)}), so there’s pressure to cut or sell assets.` : `Operating cash flow covers dividends ${fx(s.divCover)}.`);
  if (s.revolver != null) pts.push(`About ${fm(s.revolver)} is undrawn on the revolver.`);
  if (s.need > 0) pts.push(`After cash, retained cash flow${s.revolver != null ? ' and the revolver' : ''}, about ${fm(s.need)} has to come from outside.`);
  box.append(el('h4', null, 'Talking points for the first call'), el('ul', null, pts.map(p => el('li', null, p))));
  box.append(el('h4', null, 'Verify before calling'), el('ul', null,
    el('li', null, `Any refinancing, bond deal or asset sale since ${fd(r.asOf || r.fyEnd)}: check 8-Ks and the latest earnings release.`),
    el('li', null, 'Extension options on the maturing loans, which can push dates out a year or two.'),
    s.revolver == null ? el('li', null, 'Undrawn revolver capacity, from the liquidity section of the latest 10-Q.') : null));
  box.append(el('p', { class: 'note', style: 'margin-top:8px' }, 'Generated from the filing data above; numbers update with the rate sheet.'));
  return box;
}

// ---------- csv ----------
function csv() {
  const rows = sorted(R.filter(passes));
  const head = ['Ticker', 'Company', 'Sector', 'Score', 'Outcome', 'Total debt', `Due by ${fmy(winEnd())}`, 'Due next 12 months', 'Cash', 'Undrawn revolver', 'Retained cash flow (12 mo)', 'Outside capital needed', 'Leverage', 'Dividend coverage', 'Interest coverage', 'Average rate', 'Refinance rate', 'Financials as of', 'Schedule source', '10-K link'];
  const q = v => v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const lines = [head.join(',')].concat(rows.map(({ r, s }) => [r.ticker, r.name, r.sector, s.score, s.bucket, Math.round(s.debt), Math.round(s.due), Math.round(s.due12), Math.round(s.cash), s.revolver == null ? '' : Math.round(s.revolver),
    s.rcf == null ? '' : Math.round(s.rcf), Math.round(s.need), s.lev == null ? '' : s.lev.toFixed(3), s.divCover == null ? '' : s.divCover.toFixed(2), s.intCover == null ? '' : s.intCover.toFixed(2),
    s.rate == null ? '' : s.rate.toFixed(2), s.newRate.toFixed(2), r.asOf, r.ladderSrc || '', edgar(r.cik, r.acc10K, r.doc10K)].map(q).join(',')));
  const a = el('a', { href: URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })), download: `reit-runway-${RW_DEFAULTS.asOf}.csv` });
  document.body.append(a); a.click(); a.remove();
}

// ---------- wire up ----------
function clearFilters(render = true) {
  Object.assign(F, { q: '', sector: '', bucket: '', min: 0, flag: '', levMin: null }); quickTest = null;
  $('#fQ').value = ''; $('#fSector').value = ''; $('#fBucket').value = ''; $('#fMin').value = '0'; $('#quickOut').textContent = '';
  if (render) { renderSummary(); renderList(); }
}
function init() {
  compute(); renderStamp(); renderRates(); renderAssumpEditor(); fillSelects(); renderSummary(); renderQuick(); renderList();
  $('#fQ').oninput = e => { F.q = e.target.value.trim(); limit = 80; renderList(); };
  $('#fSector').onchange = e => { F.sector = e.target.value; renderList(); };
  $('#fBucket').onchange = e => { F.bucket = e.target.value; renderSummary(); renderList(); };
  $('#fMin').onchange = e => { F.min = +e.target.value; renderList(); };
  $('#fSort').onchange = e => { sortKey = e.target.value; sortDir = (SORTS[sortKey] || [0, -1])[1]; renderList(); };
  $('#vCos').onclick = () => { view = 'cos'; setView(); renderList(); };
  $('#vSec').onclick = () => { view = 'sec'; setView(); renderList(); };
  $('#moreBtn').onclick = () => { limit += 80; renderList(); };
  $('#clearBtn').onclick = () => clearFilters();
  $('#csvBtn').onclick = csv;
  $('#editBtn').onclick = () => { const a = $('#assump'); a.hidden = !a.hidden; $('#editBtn').setAttribute('aria-expanded', String(!a.hidden)); };
  $('#aboutBtn').onclick = () => { const a = $('#about'); a.hidden = !a.hidden; $('#aboutBtn').setAttribute('aria-expanded', String(!a.hidden)); };
  $('#resetBtn').onclick = () => { A = clone(RW_DEFAULTS); try { localStorage.removeItem('rw-assump-v1'); } catch (e) {} renderAssumpEditor(); changed(); };
}
init();
})();
