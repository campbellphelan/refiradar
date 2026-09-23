(function(){
'use strict';
const $ = s => document.querySelector(s);
const el = (tag, attrs, ...kids) => { const e = document.createElement(tag); if (attrs) for (const k in attrs) { if (k === 'class') e.className = attrs[k]; else if (k === 'html') e.innerHTML = attrs[k]; else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] != null) e.setAttribute(k, attrs[k]); } for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : String(c)); return e; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- formatting ----------
const fm = v => v == null || !isFinite(v) ? '—' : Math.abs(v) >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : Math.abs(v) >= 1e6 ? '$' + (v / 1e6).toFixed(Math.abs(v) >= 1e8 ? 0 : 1) + 'M' : '$' + Math.round(v / 1e3) + 'K';
const fmS = v => (v < 0 ? '−' : '+') + fm(Math.abs(v));
const fp = (v, d = 1) => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(d) + '%';
const fr = (v, d = 2) => v == null || !isFinite(v) ? '—' : Number(v).toFixed(d) + '%';
const fx = v => v == null || !isFinite(v) ? '—' : Number(v).toFixed(2) + '×';
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fd = iso => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return MON[+m - 1] + ' ' + (+d) + ', ' + y; };
const fmy = iso => { if (!iso) return '—'; const [y, m] = iso.split('-'); return MON[+m - 1] + ' ' + y; };

const BUCKETS = [
  { k: 'Cash-out refi', c: 'cash' }, { k: 'Refi-ready', c: 'ready' }, { k: 'Recap: mezz', c: 'mezz' },
  { k: 'Recap: mezz + pref', c: 'pref' }, { k: 'Equity gap', c: 'gap' }, { k: 'Workout', c: 'work' }, { k: 'Insufficient data', c: 'na' },
];
const BC = Object.fromEntries(BUCKETS.map(b => [b.k, b.c]));
const pill = b => el('span', { class: 'pill', style: `background:var(--b-${BC[b]}-bg);color:var(--b-${BC[b]})` }, el('i', { style: `background:var(--b-${BC[b]})` }), b);
const SEVC = ['var(--line)', 'var(--sev1)', 'var(--sev2)', 'var(--sev3)'];
const PNAME = { cmbs: 'CMBS', life: 'Life co', agency: 'Agency', bank: 'Bank', bridge: 'Bridge' };

// ---------- assumptions ----------
const clone = o => JSON.parse(JSON.stringify(o));
let A = clone(RR_DEFAULTS);
try { const s = localStorage.getItem('rr-assump-v1'); if (s) { const p = JSON.parse(s); if (p && p.programs && p.programs.length === A.programs.length) A = Object.assign(A, p); } } catch (e) {}
// Index rates always come from the latest daily update, never from a saved copy.
Object.assign(A, { ust10: RR_DEFAULTS.ust10, sofr: RR_DEFAULTS.sofr, ust10Date: RR_DEFAULTS.ust10Date, sofrDate: RR_DEFAULTS.sofrDate, asOf: RR_DEFAULTS.asOf, loansFiled: RR_DEFAULTS.loansFiled });
const saveA = () => { try { localStorage.setItem('rr-assump-v1', JSON.stringify(A)); } catch (e) {} };
const fdl = iso => { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1] + ' ' + (+d) + ', ' + y; };

// ---------- state ----------
const F = { q: '', msa: '', type: '', bucket: '', mat: 'all', min: 0, sort: 'score', dyMax: null, dyMin: null, flag: '' };
let view = 'loans', limit = 120, sortKey = 'score', sortDir = -1, msaSortKey = 'bal', msaSortDir = -1, selectedId = null;
let R = [];
const FEAT = Object.fromEntries(FEATURED.map(f => [f.id, f]));

function compute() { R = LOANS.map(l => ({ l, s: rrSize(l, A) })); }

// ---------- rate sheet ----------
function renderRates() {
  const box = $('#rates'); box.textContent = '';
  box.append(
    el('div', { class: 'rate idx' }, el('div', { class: 'nm' }, '10-yr Treasury', el('small', null, 'index')), el('div', { class: 'big' }, fr(A.ust10)), el('div', { class: 'con' }, 'U.S. Treasury close, ' + fdl(RR_DEFAULTS.ust10Date))),
    el('div', { class: 'rate idx' }, el('div', { class: 'nm' }, 'SOFR', el('small', null, 'index')), el('div', { class: 'big' }, fr(A.sofr)), el('div', { class: 'con' }, 'New York Fed, ' + fdl(RR_DEFAULTS.sofrDate))),
  );
  for (const p of A.programs) {
    const rate = (p.index === 'sofr' ? A.sofr : A.ust10) + p.spread / 100;
    box.append(el('div', { class: 'rate' },
      el('div', { class: 'nm' }, p.name, el('small', null, p.term)),
      el('div', { class: 'big' }, fr(rate)),
      el('div', { class: 'sp' }, `+${p.spread} bps over ${p.index === 'sofr' ? 'SOFR' : '10-yr'}`),
      el('div', { class: 'con' }, `${p.ltv}% LTV · ${p.dscr.toFixed(2)}× · ${p.dy}% DY · ${p.amort ? p.amort + '-yr am' : 'IO'}`)));
  }
  box.append(el('div', { class: 'rate' }, el('div', { class: 'nm' }, 'Mezz / pref equity', el('small', null, 'gap capital')),
    el('div', { class: 'big' }, fr(A.mezz.rate, 1) + ' / ' + fr(A.pref.rate, 1)),
    el('div', { class: 'sp' }, `to ${A.mezz.maxCltv}% / ${A.pref.maxCltv}% CLTV`), el('div', { class: 'con' }, 'Current-pay coupon / preferred return')));
  const coupons = LOANS.map(l => l.rate).filter(v => v).sort((a, b) => a - b);
  const med = coupons[Math.floor(coupons.length / 2)];
  const cm = A.programs.find(p => p.id === 'cmbs'); const cmRate = A.ust10 + cm.spread / 100;
  const shocks = R.map(r => r.s.paymentShock).filter(v => v != null && isFinite(v)).sort((a, b) => a - b);
  const ms = shocks[Math.floor(shocks.length / 2)];
  $('#shockline').innerHTML = `These loans carry a median coupon of <b>${med.toFixed(2)}%</b>, set in 2016 and 2017. A 10-year CMBS refinance today prices near <b>${cmRate.toFixed(2)}%</b>, <b>+${Math.round((cmRate - med) * 100)} bps</b>. For the median loan, debt service on the new stack runs <b>${ms >= 0 ? '+' : ''}${Math.round(ms * 100)}%</b> above today's payment.`;
}

function renderAssumpEditor() {
  const tb = $('#progEdit'); tb.textContent = '';
  A.programs.forEach((p, i) => {
    const inp = (key, step) => el('input', { type: 'number', step, id: `p${i}-${key}`, value: p[key], 'aria-label': `${p.name} ${key}`, oninput: e => { const v = parseFloat(e.target.value); if (isFinite(v)) { p[key] = v; changed(); } } });
    tb.append(el('tr', null, el('td', null, p.name + ' ', el('span', { class: 'note' }, p.term)), el('td', null, p.index === 'sofr' ? 'SOFR' : '10-yr UST'),
      el('td', null, inp('spread', 5)), el('td', null, inp('ltv', 1)), el('td', null, inp('dscr', 0.05)), el('td', null, inp('dy', 0.25)), el('td', null, inp('amort', 5))));
  });
  const bind = (id, get, set) => { const e = $(id); e.value = get(); e.oninput = () => { const v = parseFloat(e.value); if (isFinite(v)) { set(v); changed(); } }; };
  bind('#aUst', () => A.ust10, v => A.ust10 = v); bind('#aSofr', () => A.sofr, v => A.sofr = v);
  bind('#aMezzR', () => A.mezz.rate, v => A.mezz.rate = v); bind('#aMezzC', () => A.mezz.maxCltv, v => A.mezz.maxCltv = v);
  bind('#aPrefR', () => A.pref.rate, v => A.pref.rate = v); bind('#aPrefC', () => A.pref.maxCltv, v => A.pref.maxCltv = v);
  bind('#aClose', () => A.closingPct, v => A.closingPct = v); bind('#aFeeS', () => A.feeSeniorBps, v => A.feeSeniorBps = v); bind('#aFeeJ', () => A.feeSubBps, v => A.feeSubBps = v);
  const cg = $('#capEdit'); cg.textContent = '';
  Object.keys(A.caps).forEach((t, i) => cg.append(el('label', { for: 'cap' + i }, t, el('input', { id: 'cap' + i, type: 'number', step: 0.25, value: A.caps[t], oninput: e => { const v = parseFloat(e.target.value); if (isFinite(v) && v > 0) { A.caps[t] = v; changed(); } } }))));
}
let chT; function changed() { clearTimeout(chT); chT = setTimeout(() => { saveA(); compute(); renderRates(); renderSummary(); renderList(); if (selectedId) openLoan(selectedId, true); }, 120); }

// ---------- summary ----------
function renderSummary() {
  const tot = R.reduce((a, r) => a + r.s.bal, 0);
  const next6 = R.filter(r => r.s.monthsToMat <= 6).reduce((a, r) => a + r.s.bal, 0);
  const recap = R.filter(r => r.s.bucket.startsWith('Recap')); const recapBal = recap.reduce((a, r) => a + r.s.bal, 0);
  const gapSum = R.filter(r => r.s.bucket === 'Equity gap').reduce((a, r) => a + r.s.equityShort, 0);
  const fee = R.reduce((a, r) => a + r.s.fee, 0);
  const k = $('#kpis'); k.textContent = '';
  const add = (v, l) => k.append(el('div', { class: 'kpi' }, el('div', { class: 'v' }, v), el('div', { class: 'l' }, l)));
  add(R.length.toLocaleString(), 'loans coming due by Dec 2027');
  add(fm(tot), 'whole-loan balance');
  add(fm(next6), 'due in the next 6 months');
  add(fm(recapBal), `${recap.length} loans that need mezz or pref`);
  add(fm(gapSum), 'of equity that lenders won’t provide');
  add(fm(fee), 'est. placement fees at your fee rates');
  const bar = $('#mixbar'), lg = $('#legend'); bar.textContent = ''; lg.textContent = '';
  for (const b of BUCKETS) {
    const rs = R.filter(r => r.s.bucket === b.k); if (!rs.length) continue;
    const bal = rs.reduce((a, r) => a + r.s.bal, 0);
    bar.append(el('span', { style: `width:${bal / tot * 100}%;background:var(--b-${b.c})`, title: `${b.k}: ${fm(bal)} (${rs.length} loans)`, onclick: () => setBucket(b.k) }));
    lg.append(el('button', { class: 'lg', type: 'button', 'aria-pressed': String(F.bucket === b.k), onclick: () => setBucket(b.k) }, el('i', { style: `background:var(--b-${b.c})` }), b.k, el('span', { class: 'c' }, `${rs.length} · ${fm(bal)}`)));
  }
}
function setBucket(k) { F.bucket = F.bucket === k ? '' : k; $('#fBucket').value = F.bucket; view = 'loans'; setView(); renderSummary(); renderList(); }

// ---------- filters ----------
function fillSelects() {
  const byMsa = {}; for (const r of R) { byMsa[r.l.msa] = (byMsa[r.l.msa] || 0) + r.s.bal; }
  const msas = Object.keys(byMsa).sort((a, b) => a.localeCompare(b));
  const ms = $('#fMsa'); ms.textContent = ''; ms.append(el('option', { value: '' }, `All MSAs (${msas.length})`));
  for (const m of msas) { const n = R.filter(r => r.l.msa === m).length; ms.append(el('option', { value: m }, `${m} · ${n}`)); }
  const types = [...new Set(LOANS.map(l => l.type))].sort();
  const ts = $('#fType'); ts.textContent = ''; ts.append(el('option', { value: '' }, 'All types')); types.forEach(t => ts.append(el('option', { value: t }, t)));
  const bs = $('#fBucket'); bs.textContent = ''; bs.append(el('option', { value: '' }, 'All outcomes')); BUCKETS.forEach(b => bs.append(el('option', { value: b.k }, b.k)));
}
function passes(r) {
  const { l, s } = r;
  if (F.msa && l.msa !== F.msa) return false;
  if (F.type && l.type !== F.type) return false;
  if (F.bucket && s.bucket !== F.bucket) return false;
  if (F.mat === 'past' && s.monthsToMat >= 0) return false;
  if (F.mat === '0-6' && !(s.monthsToMat >= 0 && s.monthsToMat <= 6)) return false;
  if (F.mat === '6-12' && !(s.monthsToMat > 6 && s.monthsToMat <= 12)) return false;
  if (F.mat === '12+' && !(s.monthsToMat > 12)) return false;
  if (F.min && s.bal < F.min * 1e6) return false;
  if (F.dyMax != null && !(s.inPlaceDY != null && s.inPlaceDY * 100 <= F.dyMax)) return false;
  if (F.dyMin != null && !(s.inPlaceDY != null && s.inPlaceDY * 100 >= F.dyMin)) return false;
  if (F.flag && !s.flags.some(f => f.k === F.flag)) return false;
  if (F.q) {
    const q = F.q.toLowerCase(); const fe = FEAT[l.id];
    const hay = [l.name, l.city, l.st, l.msa, l.topTenant, l.originator, l.servicer, l.type, (l.deals || []).join(' '), fe ? fe.sponsor : ''].join(' ').toLowerCase();
    if (!q.split(/\s+/).every(t => hay.includes(t))) return false;
  }
  return true;
}
const SORTS = {
  score: [r => r.s.score, -1], mat: [r => r.l.mat, 1], bal: [r => r.s.bal, -1], msa: [r => r.l.msa + '|' + String(9e12 - r.s.bal).padStart(14, '0'), 1],
  gap: [r => r.s.gap, -1], shock: [r => r.s.paymentShock ?? -9, -1], dy: [r => r.s.inPlaceDY ?? 9, 1],
  name: [r => r.l.name.toLowerCase(), 1], type: [r => r.l.type, 1], rate: [r => r.l.rate, 1], bucket: [r => BUCKETS.findIndex(b => b.k === r.s.bucket), 1],
  best: [r => r.s.best ? r.s.best.rate : 99, 1], flags: [r => r.s.flags.reduce((a, f) => a + f.sev, 0), -1],
};
function sorted(rows) {
  if (sortKey === 'msaVol') {
    const vol = {}; rows.forEach(r => vol[r.l.msa] = (vol[r.l.msa] || 0) + r.s.bal);
    return rows.slice().sort((a, b) => (vol[b.l.msa] - vol[a.l.msa]) || a.l.msa.localeCompare(b.l.msa) || (b.s.bal - a.s.bal));
  }
  const [fn] = SORTS[sortKey] || SORTS.score;
  return rows.slice().sort((a, b) => { const x = fn(a), y = fn(b); return (x < y ? -1 : x > y ? 1 : 0) * sortDir; });
}

// ---------- loans table ----------
const COLS = [
  ['score', 'Score', ''], ['name', 'Property', ''], ['msa', 'MSA', ''], ['type', 'Type', ''], ['mat', 'Maturity', ''], ['bal', 'Whole loan', 'r'],
  ['rate', 'Coupon → today', 'r'], ['dy', 'Debt yield', 'r'], ['best', 'Best execution', ''], ['gap', 'Gap (excess)', 'r'], ['bucket', 'Outcome', ''], ['flags', 'Flags', ''],
];
function renderHead() {
  const h = $('#thead'); h.textContent = '';
  for (const [k, lab, cls] of COLS) {
    const on = sortKey === k || (k === 'msa' && sortKey === 'msaVol');
    h.append(el('th', { class: cls, scope: 'col', tabindex: '0', 'aria-sort': on ? (sortDir > 0 ? 'ascending' : 'descending') : 'none',
      onclick: () => headSort(k), onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); headSort(k); } } },
      lab, el('span', { class: 'ar' }, on ? (sortDir > 0 ? '↑' : '↓') : '')));
  }
}
function headSort(k) {
  if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = (SORTS[k] || [0, -1])[1]; }
  const opt = [...$('#fSort').options].find(o => o.value === k); $('#fSort').value = opt ? k : $('#fSort').value;
  renderList();
}
function renderList() {
  const rows = R.filter(passes);
  const tot = rows.reduce((a, r) => a + r.s.bal, 0);
  $('#resCount').innerHTML = `<b>${rows.length}</b> loans · <b>${fm(tot)}</b> whole-loan balance` + extraFilterNote();
  renderHead();
  if (view === 'msa') return renderMsa(rows);
  const body = $('#tbody'); body.textContent = '';
  const S = sorted(rows);
  let lastMsa = null;
  const grouping = sortKey === 'msa' || sortKey === 'msaVol';
  for (const r of S.slice(0, limit)) {
    const { l, s } = r;
    if (grouping && l.msa !== lastMsa) {
      lastMsa = l.msa; const g = rows.filter(x => x.l.msa === l.msa);
      body.append(el('tr', { class: 'grp', style: 'cursor:default' }, el('td', { colspan: COLS.length, style: 'background:var(--surface-2);font-family:var(--cond);font-weight:600;font-size:12.5px;letter-spacing:.02em;padding:7px 10px' }, l.msa, el('span', { class: 'note', style: 'font-family:var(--sans);font-weight:400;margin-left:8px' }, `${g.length} loans · ${fm(g.reduce((a, x) => a + x.s.bal, 0))}`))));
    }
    const sev = s.flags.filter(f => f.sev >= 1).sort((a, b) => b.sev - a.sev);
    const tr = el('tr', { tabindex: '0', class: selectedId === l.id ? 'sel' : '', onclick: () => openLoan(l.id), onkeydown: e => { if (e.key === 'Enter') openLoan(l.id); } },
      el('td', null, el('span', { class: 'score' + (s.score >= 80 ? ' hi' : '') }, s.score)),
      el('td', null, el('div', { class: 'pname' }, l.name, FEAT[l.id] ? el('span', { class: 'featured' }, 'Brief') : null), el('div', { class: 'psub' }, [l.city, l.st].filter(Boolean).join(', ') || (l.nprops > 1 ? l.nprops + ' properties' : '—'))),
      el('td', { style: 'min-width:190px' }, el('div', { style: 'max-width:230px;font-size:12.5px' }, l.msa)),
      el('td', null, l.type),
      el('td', null, el('div', { class: 'num' }, fmy(l.mat)), el('div', { class: 'psub' }, s.monthsToMat < 0 ? 'past due' : `in ${Math.max(0, Math.round(s.monthsToMat))} mo`)),
      el('td', { class: 'r num' }, fm(s.bal), l.wholeEst ? el('div', { class: 'psub' }, 'est.') : null),
      el('td', { class: 'r num' }, l.rate.toFixed(2) + '% → ' + (s.best ? s.best.rate.toFixed(2) + '%' : '—'), el('div', { class: 'psub' }, s.rateShockBps != null ? `+${s.rateShockBps} bps` : '')),
      el('td', { class: 'r num' }, fp(s.inPlaceDY)),
      el('td', null, s.best ? el('div', null, el('span', { style: 'font-weight:500' }, PNAME[s.best.id]), ' ', el('span', { class: 'num' }, fm(s.seniorProceeds))) : '—', s.best ? el('div', { class: 'psub' }, s.best.binding + '-bound') : null),
      el('td', { class: 'r num ' + (s.gap > 0 ? 'delta-up' : 'delta-dn') }, fmS(s.gap)),
      el('td', null, pill(s.bucket)),
      el('td', { title: sev.map(f => f.t).join('\n') }, el('span', { class: 'flagdots' }, sev.slice(0, 4).map(f => el('i', { style: `background:${SEVC[f.sev]}` }))), sev.length ? '' : el('span', { class: 'note' }, '—')));
    body.append(tr);
  }
  $('#moreWrap').hidden = S.length <= limit;
  $('#moreBtn').textContent = `Show ${Math.min(120, S.length - limit)} more of ${S.length - limit}`;
}
function extraFilterNote() {
  const parts = [];
  if (F.dyMax != null) parts.push(`debt yield ≤ ${F.dyMax}%`);
  if (F.dyMin != null) parts.push(`debt yield ≥ ${F.dyMin}%`);
  if (F.flag) parts.push({ ss: 'with special servicer', dq: 'delinquent', mat: 'past maturity', mod: 'modified', occ: 'occupancy drop', ncf: 'cash-flow decline', roll: 'top tenant rollover', stale: 'stale financials', pp: 'pari passu' }[F.flag] || F.flag);
  return parts.length ? ` · also: ${esc(parts.join(', '))}` : '';
}

// ---------- MSA view ----------
function renderMsa(rows) {
  const g = {};
  for (const r of rows) { const m = r.l.msa; (g[m] = g[m] || []).push(r); }
  const list = Object.entries(g).map(([m, rs]) => {
    const bal = rs.reduce((a, r) => a + r.s.bal, 0);
    const dys = rs.map(r => r.s.inPlaceDY).filter(v => v != null).sort((a, b) => a - b);
    return { m, rs, n: rs.length, bal, next6: rs.filter(r => r.s.monthsToMat <= 6).reduce((a, r) => a + r.s.bal, 0), dy: dys.length ? dys[Math.floor(dys.length / 2)] : null,
      gap: rs.reduce((a, r) => a + (r.s.gap > 0 ? r.s.gap : 0), 0), top: rs.slice().sort((a, b) => b.s.bal - a.s.bal)[0] };
  });
  const keyf = { m: x => x.m, n: x => x.n, bal: x => x.bal, next6: x => x.next6, dy: x => x.dy ?? 9, gap: x => x.gap }[msaSortKey] || (x => x.bal);
  list.sort((a, b) => { const x = keyf(a), y = keyf(b); return (x < y ? -1 : x > y ? 1 : 0) * msaSortDir; });
  const h = $('#mhead'); h.textContent = '';
  const MC = [['m', 'MSA', ''], ['n', 'Loans', 'r'], ['bal', 'Whole-loan balance', 'r'], ['next6', 'Due ≤ 6 mo', 'r'], ['dy', 'Median debt yield', 'r'], ['gap', 'Refi gap', 'r'], ['mix', 'Outcome mix', ''], ['top', 'Largest loan', '']];
  for (const [k, lab, cls] of MC) {
    const on = msaSortKey === k;
    h.append(el('th', { class: cls, scope: 'col', tabindex: k === 'mix' || k === 'top' ? null : '0', 'aria-sort': on ? (msaSortDir > 0 ? 'ascending' : 'descending') : 'none',
      onclick: () => { if (k === 'mix' || k === 'top') return; if (msaSortKey === k) msaSortDir *= -1; else { msaSortKey = k; msaSortDir = k === 'm' || k === 'dy' ? 1 : -1; } renderList(); } },
      lab, el('span', { class: 'ar' }, on ? (msaSortDir > 0 ? '↑' : '↓') : '')));
  }
  const b = $('#mbody'); b.textContent = '';
  for (const x of list) {
    const mix = el('div', { class: 'msabar' });
    for (const bk of BUCKETS) { const v = x.rs.filter(r => r.s.bucket === bk.k).reduce((a, r) => a + r.s.bal, 0); if (v) mix.append(el('span', { style: `width:${v / x.bal * 100}%;background:var(--b-${bk.c})`, title: `${bk.k}: ${fm(v)}` })); }
    b.append(el('tr', { tabindex: '0', onclick: () => pickMsa(x.m), onkeydown: e => { if (e.key === 'Enter') pickMsa(x.m); } },
      el('td', null, el('div', { class: 'pname' }, x.m)), el('td', { class: 'r num' }, x.n), el('td', { class: 'r num' }, fm(x.bal)), el('td', { class: 'r num' }, x.next6 ? fm(x.next6) : '—'),
      el('td', { class: 'r num' }, fp(x.dy)), el('td', { class: 'r num delta-up' }, x.gap ? fm(x.gap) : '—'), el('td', null, mix),
      el('td', null, el('div', { style: 'font-size:12.5px' }, x.top.l.name), el('div', { class: 'psub num' }, fm(x.top.s.bal) + ' · ' + fmy(x.top.l.mat)))));
  }
  $('#moreWrap').hidden = true;
}
function pickMsa(m) { F.msa = m; $('#fMsa').value = m; view = 'loans'; setView(); renderList(); window.scrollTo({ top: $('#tblLoans').getBoundingClientRect().top + scrollY - 90, behavior: 'smooth' }); }
function setView() { $('#vLoans').setAttribute('aria-pressed', String(view === 'loans')); $('#vMsa').setAttribute('aria-pressed', String(view === 'msa')); $('#tblLoans').hidden = view !== 'loans'; $('#tblMsa').hidden = view !== 'msa'; }

// ---------- drawer ----------
let lastFocus = null;
function openLoan(id, keep) {
  const r = R.find(x => x.l.id === id); if (!r) return;
  const { l, s } = r; selectedId = id; const fe = FEAT[id];
  if (!keep) lastFocus = document.activeElement;
  const d = $('#drawer'); const prevScroll = keep ? d.scrollTop : 0; d.textContent = '';
  const loc = [l.city, l.st].filter(Boolean).join(', ');
  d.append(el('div', { class: 'dhead' },
    el('div', null, el('h2', { id: 'dTitle' }, l.name), el('div', { class: 'sub' }, [loc || (l.nprops > 1 ? `${l.nprops} properties` : null), l.msa, l.type].filter(Boolean).join(' · ')),
      el('div', { class: 'row', style: 'margin-top:8px' }, pill(s.bucket), el('span', { class: 'score' + (s.score >= 80 ? ' hi' : '') }, s.score), el('span', { class: 'note' }, 'opportunity score'))),
    el('button', { class: 'x', 'aria-label': 'Close', onclick: closeLoan }, '×')));
  const body = el('div', { class: 'dbody' }); d.append(body);

  // facts
  const fact = (k, v, sub) => el('div', { class: 'fact' }, el('div', { class: 'k' }, k), el('div', { class: 'v' }, v, sub ? el('small', null, ' ' + sub) : null));
  const occ = l.occSec != null || l.occRec != null ? `${fp(l.occSec, 0)} → ${fp(l.occRec, 0)}` : '—';
  body.append(el('section', { class: 'card' }, el('h3', null, 'The loan today'), el('div', { class: 'facts' },
    fact('Maturity', fd(l.mat), s.monthsToMat < 0 ? '(past due)' : `(${Math.round(s.monthsToMat)} mo)`),
    fact('Whole-loan balance', fm(s.bal), l.wholeEst ? 'est.' : ''),
    fact('This trust’s share', fm(l.trustBal), `${(l.deals || []).length} deal${(l.deals || []).length > 1 ? 's' : ''}`),
    fact('Coupon', l.rate.toFixed(3) + '%', l.io ? 'interest-only' : `${l.amort ? Math.round(l.amort / 12) + '-yr am' : 'amortizing'}`),
    fact('Latest cash flow', fm(s.ncf), s.cf.basis === 'Most recent NCF' ? `NCF, ${fmy(l.finEnd)}${l.finMonths && l.finMonths < 11 ? ' annualized' : ''}` : s.cf.basis),
    fact('At securitization', fm(l.ncfSec), 'NCF'),
    fact('In-place debt yield', fp(s.inPlaceDY)),
    fact('DSCR', `${fx(l.dscrSec)} → ${fx(l.dscrRec)}`, 'NCF'),
    fact('Occupancy', occ),
    fact('Value today', fm(s.value), `at ${s.cap}% cap`),
    fact('Implied LTV', fp(s.ltvNow, 0), `vs ${fm(l.valSec)} at issue`),
    fact('Top tenant', l.topTenant || '—', l.topExp ? 'exp. ' + fmy(l.topExp) : ''),
    fact('Originated', fmy(l.orig), (l.originator || '').replace(/\s+/g, ' ')),
    fact('Servicer', l.servicer || '—'),
  )));

  // comparison
  const cmp = el('div', { class: 'cmp' }); const t = el('table');
  t.append(el('thead', null, el('tr', null, ['Program', 'All-in rate', 'Spread', 'Constant', 'LTV limit', 'DSCR limit', 'DY limit', 'Max loan', '% of payoff'].map((h, i) => el('th', { scope: 'col' }, h)))));
  const tb = el('tbody');
  for (const q of s.quotes) {
    const isBest = s.best && q.id === s.best.id;
    const cov = s.need ? q.proceeds / s.need : 0;
    tb.append(el('tr', { class: (isBest ? 'best ' : '') + (q.eligible ? '' : 'ineligible') },
      el('td', null, el('b', null, q.name), el('div', { class: 'bind' }, q.term + (isBest ? ' · best execution' : ''))),
      el('td', { class: 'num' }, q.rate.toFixed(2) + '%'), el('td', { class: 'num' }, `+${q.spread} / ${q.index === 'sofr' ? 'SOFR' : 'UST'}`), el('td', { class: 'num' }, (q.constant * 100).toFixed(2) + '%'),
      ...(q.eligible ? [el('td', { class: 'num' }, fm(q.byLtv)), el('td', { class: 'num' }, fm(q.byDscr)), el('td', { class: 'num' }, fm(q.byDy)),
        el('td', { class: 'num' }, el('b', null, fm(q.proceeds)), el('div', { class: 'bind' }, q.binding + '-bound')),
        el('td', { class: 'num' }, el('span', { class: 'cover' }, el('i', { style: `width:${Math.min(100, cov * 100)}%;${cov >= 1 ? 'background:var(--b-cash)' : ''}` })), Math.round(cov * 100) + '%')]
        : [el('td', { colspan: 5, class: 'note', style: 'text-align:left' }, `Doesn’t lend on ${l.type.toLowerCase()}`)])));
  }
  t.append(tb); cmp.append(t);
  body.append(el('section', { class: 'card' }, el('h3', null, 'Refinance comparison at today’s spreads'), cmp,
    el('p', { class: 'note', style: 'margin:8px 0 0' }, `Payoff to cover: ${fm(s.need)} (balance plus ${A.closingPct}% closing costs). Max loan is the lowest of the three limits. Edit spreads and limits in the rate sheet.`)));

  // stack
  const senior = Math.min(s.seniorProceeds, s.need);
  const excess = s.bucket === 'Cash-out refi' ? s.permMax - s.need : 0;
  const segs = [
    { v: senior, c: 'var(--accent)', lab: `Senior · ${s.best ? PNAME[s.best.id] + ' ' + s.best.rate.toFixed(2) + '%' : ''}` },
    { v: s.mezzUsed, c: 'var(--b-mezz)', lab: `Mezz · ${A.mezz.rate}%` },
    { v: s.prefUsed, c: 'var(--b-pref)', lab: `Pref · ${A.pref.rate}%` },
    { v: s.equityShort, c: 'var(--b-gap)', lab: 'Equity gap (sponsor check or discount)' },
    { v: excess, c: 'var(--b-cash)', lab: 'Cash-out capacity' },
  ].filter(x => x.v > 1);
  const scale = segs.reduce((a, x) => a + x.v, 0) || 1;
  const sb = el('div', { class: 'stackbar' });
  segs.forEach(x => sb.append(el('span', { style: `width:${x.v / scale * 100}%;background:${x.c}`, title: `${x.lab}: ${fm(x.v)}` }, x.v / scale > 0.12 ? fm(x.v) : '')));
  sb.append(el('i', { class: 'payoff', style: `left:calc(${Math.min(100, s.need / scale * 100)}% - 1px)`, title: 'Payoff' }));
  const shock = s.paymentShock;
  body.append(el('section', { class: 'card' }, el('h3', null, 'Proposed capital stack'),
    el('div', { class: 'stack' }, sb, el('div', { class: 'stackleg' }, segs.map(x => el('span', null, el('i', { style: `background:${x.c}` }), `${x.lab}: `, el('b', { class: 'num' }, fm(x.v)))), el('span', null, '▏payoff ', el('b', { class: 'num' }, fm(s.need))))),
    el('p', { class: 'note', style: 'margin:10px 0 0' }, s.currentDS ? `Annual debt service ${fm(s.currentDS)} today → ${fm(s.newStackDS)} on this stack (${shock >= 0 ? '+' : ''}${Math.round(shock * 100)}%). ` : '', s.bridge ? `Bridge alternative: ${fm(s.bridge.proceeds)} at ${s.bridge.rate.toFixed(2)}% floating (${Math.round(s.bridge.proceeds / s.need * 100)}% of payoff).` : '')));

  // flags
  const fl = s.flags.slice().sort((a, b) => b.sev - a.sev);
  body.append(el('section', { class: 'card' }, el('h3', null, 'Risk flags'), fl.length ? el('ul', { class: 'flags' }, fl.map(f => el('li', null, el('i', { style: `background:${SEVC[f.sev]}` }), f.t))) : el('p', { class: 'note', style: 'margin:0' }, 'No flags in the servicer data.')));

  // brief
  const bc = el('section', { class: 'card' }, el('h3', null, (fe || sample) ? el('span', { class: 'ai-tag' }, 'Claude') : null, fe || sample ? 'Pitch brief' : 'Pitch notes'));
  if (fe) {
    const bb = el('div', { class: 'brief' });
    bb.append(el('h4', null, 'Sponsor (from the prospectus)'), el('p', null, fe.sponsor), el('p', { class: 'src' }, 'Source: ', el('a', { href: fe.srcUrl, target: '_blank', rel: 'noopener' }, fe.srcLabel), fe.sponsorNote ? ' · ' + fe.sponsorNote : ''));
    for (const [h, key] of [['Why now', 'whyNow'], ['The pitch', 'pitch'], ['Talking points for the first call', 'points'], ['Verify before calling', 'verify']]) {
      if (!fe[key]) continue; bb.append(el('h4', null, h));
      if (Array.isArray(fe[key])) bb.append(el('ul', null, fe[key].map(x => el('li', null, x)))); else bb.append(el('p', null, fe[key]));
    }
    bb.append(el('p', { class: 'note', style: 'margin-top:8px' }, 'Written by Claude from the SEC data and prospectus on Sep 23, 2026, and checked by Campbell. The rates quoted in the brief are from that day; the tables above use today’s rates.'));
    bc.append(bb);
  } else if (sample) {
    bc.append(el('p', { class: 'note', style: 'margin:0 0 4px' }, 'No saved brief for this loan. Claude can draft one from the numbers above. The sponsor isn’t in the servicer data, so the brief lists how to confirm it.'));
  } else {
    bc.append(autoBrief(r));
  }
  const out = el('div', { class: 'gen', hidden: '' , 'aria-live': 'polite'});
  const status = el('span', { class: 'note' });
  const gBtn = el('button', { class: 'btn primary', type: 'button', id: 'genBtn' }, fe ? 'Redraft with current assumptions' : 'Draft a pitch brief');
  const stopBtn = el('button', { class: 'btn', type: 'button', hidden: '' }, 'Stop');
  const copyBtn = el('button', { class: 'btn', type: 'button', hidden: '' }, 'Copy');
  const gRow = el('div', { class: 'row', style: 'margin-top:10px' }, gBtn, stopBtn, copyBtn, status);
  bc.append(gRow, out);
  body.append(bc);
  wireGenerate(r, gBtn, stopBtn, copyBtn, status, out, gRow);

  // sources
  body.append(el('section', { class: 'card' }, el('h3', null, 'Sources'), el('ul', { class: 'flags' },
    (l.deals || []).map((dn, i) => el('li', null, el('i', { style: 'background:var(--line)' }), el('span', null, `${dn} · loan-level data (Ex-102, Aug 2026): `, el('a', { href: l.srcs[i], target: '_blank', rel: 'noopener' }, 'SEC EDGAR')))),
    fe ? el('li', null, el('i', { style: 'background:var(--line)' }), el('span', null, 'Loan description and sponsor: ', el('a', { href: fe.srcUrl, target: '_blank', rel: 'noopener' }, fe.srcLabel))) : null)));

  $('#scrim').hidden = false; d.hidden = false; document.body.style.overflow = 'hidden';
  if (keep) d.scrollTop = prevScroll; else d.querySelector('.x').focus();
  document.querySelectorAll('#tbody tr').forEach(tr => tr.classList.remove('sel'));
}
function closeLoan() { $('#drawer').hidden = true; $('#scrim').hidden = true; document.body.style.overflow = ''; selectedId = null; renderList(); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
$('#scrim').onclick = closeLoan;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#drawer').hidden) closeLoan(); });

// ---------- Claude: sample ----------
let sample = null;
const ERR = { not_granted: 'Claude isn’t enabled for this page. Allow it when prompted to use AI features.', sampling_disabled: 'Claude isn’t available on this account.', rate_limited: 'Too many requests right now. Try again in a minute.', session_expired: 'Sign in again to use Claude.', refused: 'Claude declined that request. Try rephrasing.', invalid_json: 'Claude’s answer couldn’t be read as filters. Try rephrasing.', prompt_too_large: 'That request is too long.', upstream_error: 'The request was interrupted. Try again.' };
const errText = e => ERR[e && e.code] || 'Something went wrong. Try again.';

function loanFacts(r) {
  const { l, s } = r; const fe = FEAT[l.id];
  const q = s.quotes.filter(x => x.eligible).map(x => `- ${x.name} (${x.term}): ${x.rate.toFixed(2)}% all-in (+${x.spread} bps over ${x.index === 'sofr' ? 'SOFR' : '10-yr UST'}), max loan ${fm(x.proceeds)} (${x.binding}-bound), ${Math.round(x.proceeds / s.need * 100)}% of payoff`).join('\n');
  return `Property: ${l.name}, ${[l.city, l.st].filter(Boolean).join(', ') || l.nprops + ' properties'} — MSA: ${l.msa}; type: ${l.type}; ${l.units ? l.units + ' units/keys; ' : ''}${l.sf ? l.sf.toLocaleString() + ' SF; ' : ''}built ${l.yb || 'n/a'}
Loan: matures ${l.mat} (${Math.round(s.monthsToMat)} months from ${RR_DEFAULTS.asOf}); whole-loan balance ${fm(s.bal)}${l.wholeEst ? ' (estimated; pari passu across trusts)' : ''}; coupon ${l.rate}%; ${l.io ? 'interest-only' : 'amortizing'}; originated ${l.orig} by ${l.originator}; servicer ${l.servicer}; securitized in ${(l.deals || []).join(', ')}
Performance: latest cash flow ${fm(s.ncf)} (${s.cf.basis}, period ending ${l.finEnd || 'n/a'}); at securitization NCF ${fm(l.ncfSec)}; occupancy ${fp(l.occSec, 0)} at issue → ${fp(l.occRec, 0)} now; DSCR ${l.dscrSec ?? 'n/a'}× → ${l.dscrRec ?? 'n/a'}×; in-place debt yield ${fp(s.inPlaceDY)}; value at ${s.cap}% cap ≈ ${fm(s.value)} (implied LTV ${fp(s.ltvNow, 0)}) vs ${fm(l.valSec)} appraised at issue; top tenant ${l.topTenant || 'n/a'}${l.topExp ? ' (lease exp. ' + l.topExp + ')' : ''}
Refinance quotes today (10-yr UST ${A.ust10}%, SOFR ${A.sofr}%):
${q}
Model outcome: ${s.bucket}. Payoff incl. ${A.closingPct}% costs ${fm(s.need)}; best execution ${s.best ? s.best.name + ' ' + fm(s.seniorProceeds) : 'none'}; gap ${fmS(s.gap)}; mezz ${fm(s.mezzUsed)} at ${A.mezz.rate}% (to ${A.mezz.maxCltv}% CLTV); pref ${fm(s.prefUsed)} at ${A.pref.rate}% (to ${A.pref.maxCltv}% CLTV); remaining equity gap ${fm(s.equityShort)}; debt service ${fm(s.currentDS)} now → ${fm(s.newStackDS)} (${s.paymentShock != null ? Math.round(s.paymentShock * 100) + '%' : 'n/a'})
Flags: ${s.flags.map(f => f.t).join('; ') || 'none'}
Sponsor: ${fe ? fe.sponsor + ' (per ' + fe.srcLabel + ', 2017; ownership may have changed)' : 'NOT in the data — do not guess a name.'}`;
}
function wireGenerate(r, gBtn, stopBtn, copyBtn, status, out, row) {
  if (!sample) { row.hidden = true; return; }
  let ctl = null;
  gBtn.onclick = async () => {
    ctl = new AbortController(); gBtn.disabled = true; stopBtn.hidden = false; copyBtn.hidden = true; out.hidden = false; out.textContent = ''; status.textContent = 'Thinking…';
    const prompt = `You are a senior commercial real estate debt broker (capital markets advisor) preparing to pitch a refinancing mandate. Using ONLY the facts below, write a tight pitch brief for the borrower's first call. Plain text, no markdown symbols like ** or #. Use these section labels on their own lines, in caps: SITUATION, WHY NOW, PROPOSED SOLUTION, TALKING POINTS, OUTREACH EMAIL (under 120 words), VERIFY BEFORE CALLING. Keep it under 380 words total. Be specific with the numbers given; do not invent tenants, sponsors, or market data. If the sponsor is not provided, say how to identify it (deal prospectus loan summary, county deed records, the servicer).\n\n${loanFacts(r)}`;
    try {
      const res = await sample(prompt, { signal: ctl.signal, cache: false, onText: ({ text }) => { status.textContent = ''; out.textContent = text; } });
      status.textContent = res.truncated ? 'Cut short. Try again for a shorter brief.' : ''; copyBtn.hidden = false;
    } catch (e) { out.textContent = e.text || ''; if (e.code !== 'cancelled') status.textContent = errText(e); if (!out.textContent) out.hidden = true; }
    finally { gBtn.disabled = false; stopBtn.hidden = true; }
  };
  stopBtn.onclick = () => ctl && ctl.abort();
  copyBtn.onclick = async () => { try { await navigator.clipboard.writeText(out.textContent); status.textContent = 'Copied'; } catch (e) { const rg = document.createRange(); rg.selectNodeContents(out); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg); status.textContent = 'Selected. Press ⌘C to copy.'; } };
}

// ask
const CHIPS = ['Office loans in the New York MSA due before July 2027', 'Hotels that need mezz or pref, largest first', 'Retail with debt yield under 8%', 'Loans over $100M due in the next 6 months', 'Multifamily cash-out candidates', 'Loans with the special servicer in Texas'];
function setupAsk() {
  $('#askSec').hidden = false;
  const ch = $('#askChips'); CHIPS.forEach(c => ch.append(el('button', { class: 'chip', type: 'button', onclick: () => { $('#askIn').value = c; runAsk(); } }, c)));
  $('#askForm').onsubmit = e => { e.preventDefault(); runAsk(); };
}
let askCtl = null;
async function runAsk() {
  const q = $('#askIn').value.trim(); if (!q) return;
  askCtl?.abort(); askCtl = new AbortController();
  const out = $('#askOut'); out.className = 'askout'; out.textContent = 'Reading your request…'; $('#askBtn').disabled = true;
  const msas = [...new Set(LOANS.map(l => l.msa))].sort();
  const prompt = `Convert a CRE debt broker's request into filters for a table of CMBS loans maturing Oct 2026–Dec 2027. Reply with ONLY a JSON object with any of these keys (omit keys you don't need):
{"msa": one exact value from MSAS or null, "type": one of TYPES or null, "bucket": one of OUTCOMES or null, "mat": one of "all","past","0-6","6-12","12+", "min": minimum whole-loan balance in $ millions (one of 0,10,25,50,100,250), "dyMax": max in-place debt yield in percent, "dyMin": min debt yield in percent, "flag": one of "ss","dq","mat","mod","occ","ncf","roll","stale", "q": free-text search terms (city, state abbreviation, tenant, sponsor, property name) or "", "sort": one of "score","mat","bal","msa","msaVol","gap","shock","dy", "explanation": one short sentence saying how you read the request}
Notes: "mat" counts months from ${RR_DEFAULTS.asOf} (pick the closest bucket). For a state, put its 2-letter code in "q". "ss" = with special servicer, "dq" = delinquent, "roll" = top tenant lease expiring near maturity. Outcome meanings: Cash-out refi (new senior loan exceeds payoff by 10%+), Refi-ready, Recap: mezz, Recap: mezz + pref, Equity gap, Workout, Insufficient data. "Needs mezz or pref" with no preference: pick "Recap: mezz + pref" only if they say pref, else "Recap: mezz".
TYPES: ${JSON.stringify([...new Set(LOANS.map(l => l.type))])}
OUTCOMES: ${JSON.stringify(BUCKETS.map(b => b.k))}
MSAS: ${JSON.stringify(msas)}
Request: ${JSON.stringify(q)}`;
  try {
    const j = await sample.json(prompt, { modelTier: 'quick', signal: askCtl.signal });
    if (!j || typeof j !== 'object') throw { code: 'invalid_json' };
    Object.assign(F, { q: '', msa: '', type: '', bucket: '', mat: 'all', min: 0, dyMax: null, dyMin: null, flag: '' });
    if (j.msa && msas.includes(j.msa)) F.msa = j.msa;
    if (j.type && LOANS.some(l => l.type === j.type)) F.type = j.type;
    if (j.bucket && BC[j.bucket]) F.bucket = j.bucket;
    if (['all', 'past', '0-6', '6-12', '12+'].includes(j.mat)) F.mat = j.mat;
    if ([0, 10, 25, 50, 100, 250].includes(+j.min)) F.min = +j.min;
    if (isFinite(+j.dyMax) && j.dyMax != null && j.dyMax !== '') F.dyMax = +j.dyMax;
    if (isFinite(+j.dyMin) && j.dyMin != null && j.dyMin !== '') F.dyMin = +j.dyMin;
    if (typeof j.flag === 'string' && j.flag) F.flag = j.flag;
    if (typeof j.q === 'string') F.q = j.q.trim();
    if (j.sort && (SORTS[j.sort] || j.sort === 'msaVol')) { sortKey = j.sort; sortDir = (SORTS[j.sort] || [0, -1])[1]; $('#fSort').value = j.sort; }
    syncControls(); view = 'loans'; setView(); limit = 120; renderSummary(); renderList();
    out.textContent = (j.explanation ? String(j.explanation) : 'Filters applied.') + ' ';
    out.append(el('button', { class: 'linkbtn', type: 'button', onclick: clearAll }, 'Clear'));
  } catch (e) { if (e && e.code === 'cancelled') return; out.className = 'askout err'; out.textContent = errText(e); if (e && (e.code === 'not_granted' || e.code === 'sampling_disabled')) $('#askSec').hidden = true; }
  finally { $('#askBtn').disabled = false; }
}
function syncControls() { $('#fQ').value = F.q; $('#fMsa').value = F.msa; $('#fType').value = F.type; $('#fBucket').value = F.bucket; $('#fMat').value = F.mat; $('#fMin').value = String(F.min); }
function clearAll() { Object.assign(F, { q: '', msa: '', type: '', bucket: '', mat: 'all', min: 0, dyMax: null, dyMin: null, flag: '' }); syncControls(); $('#askOut').textContent = ''; limit = 120; renderSummary(); renderList(); }


// ---------- rule-based pitch notes (no AI needed) ----------
function autoBrief(r) {
  const { l, s } = r; const b = s.best; const bb = el('div', { class: 'brief' });
  const ncfChg = l.ncfSec && s.ncf && !s.cf.stale ? Math.round((s.ncf / l.ncfSec - 1) * 100) : null;
  const sit = `The ${fm(s.bal)}${l.wholeEst ? ' (est.)' : ''} ${l.io ? 'interest-only ' : ''}loan at ${l.rate.toFixed(2)}% matures ${fd(l.mat)}${s.monthsToMat < 0 ? ' and is past due' : `, ${Math.round(s.monthsToMat)} months out`}. Latest cash flow is ${fm(s.ncf)}${ncfChg != null ? ` (${ncfChg >= 0 ? 'up' : 'down'} ${Math.abs(ncfChg)}% since securitization)` : ''}${l.occRec != null ? `, with occupancy at ${fp(l.occRec, 0)}` : ''}. That's a ${fp(s.inPlaceDY)} debt yield, and at today's ${s.cap}% cap rate the loan is about ${fp(s.ltvNow, 0)} of today's value.`;
  const second = s.quotes.filter(q => q.eligible && q.proceeds > 0 && (!b || q.id !== b.id)).sort((x, y) => y.proceeds - x.proceeds)[0];
  const P = {
    'Cash-out refi': () => `A ${b.name.toLowerCase()} loan sizes to about ${fm(s.permMax)}, roughly ${fm(s.permMax - s.need)} above the payoff. Pitch a cash-out refinance, or a lower-leverage loan at tighter pricing.`,
    'Refi-ready': () => `${b.name} at about ${b.rate.toFixed(2)}% covers the payoff (${Math.round(b.proceeds / s.need * 100)}% of the ${fm(s.need)} needed). Pitch a straight refinance${second ? `, and run ${second.name.toLowerCase()} bids against it for price` : ''}.`,
    'Recap: mezz': () => `Senior debt sizes to about ${fm(s.seniorUsed)} (${b.binding}-bound). About ${fm(s.mezzUsed)} of mezz at ${A.mezz.rate}% closes the gap inside ${A.mezz.maxCltv}% CLTV, with no new equity required.`,
    'Recap: mezz + pref': () => `Senior debt sizes to about ${fm(s.seniorUsed)}. Close the gap with ${fm(s.mezzUsed)} of mezz and ${fm(s.prefUsed)} of preferred equity, or a sponsor paydown. The owner would need a structured recapitalization.`,
    'Equity gap': () => `Senior, mezz and pref together reach about ${fm(s.seniorUsed + s.mezzUsed + s.prefUsed)}, leaving roughly ${fm(s.equityShort)} the market won't lend. Pitch a recapitalization: a new equity partner, a discounted payoff, or a structured extension.`,
    'Workout': () => `The loan is ${s.inSS ? 'with the special servicer' : 'delinquent'}. The mandate is advisory: negotiate an extension or modification, sell the note, or bring rescue capital.`,
    'Insufficient data': () => `The servicer file has no usable cash flow. Get current operating statements before sizing.`,
  };
  const pts = [];
  if (s.currentDS && s.paymentShock != null) pts.push(`Debt service goes from ${fm(s.currentDS)} to about ${fm(s.newStackDS)} a year (${s.paymentShock >= 0 ? '+' : ''}${Math.round(s.paymentShock * 100)}%) at today's rates.`);
  if (l.dscrRec) pts.push(`In-place DSCR is ${fx(l.dscrRec)}${l.dscrRec >= 1.5 ? ', so current cash flow covers today’s payments. The constraint is how much a new lender will fund' : ''}.`);
  s.flags.filter(f => f.sev >= 2).slice(0, 2).forEach(f => pts.push(f.t + '.'));
  const ver = ['The sponsor: not in the servicer data. Check the deal prospectus loan summary or county deed records.'];
  if (l.wholeEst) ver.push('The whole-loan balance, estimated from reported debt service.');
  if (s.cf.stale || s.flags.some(f => f.k === 'stale')) ver.push('Current operating statements (the servicer data is stale).');
  bb.append(el('h4', null, 'Situation'), el('p', null, sit), el('h4', null, 'The pitch'), el('p', null, P[s.bucket] ? P[s.bucket]() : ''));
  if (pts.length) bb.append(el('h4', null, 'Talking points'), el('ul', null, pts.map(x => el('li', null, x))));
  bb.append(el('h4', null, 'Verify before calling'), el('ul', null, ver.map(x => el('li', null, x))));
  bb.append(el('p', { class: 'note', style: 'margin-top:8px' }, 'Generated from the loan data and the rate sheet above. Change the assumptions and these notes update.'));
  return bb;
}
function setupQuick() {
  const sec = $('#quickSec'); if (!sec) return; sec.hidden = false;
  const Q = [
    ['New York office due within 6 months', { msa: 'New York-Newark-Jersey City, NY-NJ', type: 'Office', mat: '0-6' }, 'bal'],
    ['Hotels that need mezz', { type: 'Hotel', bucket: 'Recap: mezz' }, 'bal'],
    ['Cash-out candidates $50M+', { bucket: 'Cash-out refi', min: 50 }, 'bal'],
    ['Retail with debt yield under 8%', { type: 'Retail', dyMax: 8 }, 'bal'],
    ['With the special servicer', { flag: 'ss' }, 'bal'],
    ['Top tenant rolling near maturity', { flag: 'roll' }, 'score'],
    ['Largest equity gaps', { bucket: 'Equity gap' }, 'gap'],
  ];
  const box = $('#quickChips');
  Q.forEach(([lab, f, sort]) => box.append(el('button', { class: 'chip', type: 'button', onclick: () => {
    Object.assign(F, { q: '', msa: '', type: '', bucket: '', mat: 'all', min: 0, dyMax: null, dyMin: null, flag: '' }, f);
    sortKey = sort; sortDir = (SORTS[sort] || [0, -1])[1]; $('#fSort').value = sort;
    syncControls(); view = 'loans'; setView(); limit = 120; renderSummary(); renderList();
    $('#quickOut').textContent = 'Showing: ' + lab + ' ';
    $('#quickOut').append(el('button', { class: 'linkbtn', type: 'button', onclick: () => { clearAll(); $('#quickOut').textContent = ''; } }, 'Clear'));
  } }, lab)));
}

// ---------- CSV ----------
async function setupCsv() {
  let dl = null; try { dl = await claude.use('downloads'); } catch (e) {}
  if (!dl) return;
  const b = $('#csvBtn'); b.hidden = false;
  b.onclick = async () => {
    const rows = sorted(R.filter(passes));
    const H = ['Property', 'City', 'State', 'MSA', 'Type', 'Maturity', 'Whole-loan balance', 'Coupon %', 'Latest NCF', 'Debt yield %', 'DSCR (recent)', 'Occupancy (recent)', 'Best execution', 'Best rate %', 'Senior proceeds', 'Gap', 'Mezz', 'Pref', 'Equity gap', 'Outcome', 'Score', 'Flags', 'Deals'];
    const q = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [H.join(',')].concat(rows.map(({ l, s }) => [l.name, l.city, l.st, l.msa, l.type, l.mat, Math.round(s.bal), l.rate, Math.round(s.ncf || 0), s.inPlaceDY != null ? (s.inPlaceDY * 100).toFixed(2) : '', l.dscrRec ?? '', l.occRec ?? '', s.best ? s.best.name : '', s.best ? s.best.rate.toFixed(2) : '', Math.round(s.seniorProceeds), Math.round(s.gap), Math.round(s.mezzUsed), Math.round(s.prefUsed), Math.round(s.equityShort), s.bucket, s.score, s.flags.map(f => f.t).join('; '), (l.deals || []).join('; ')].map(q).join(',')));
    try { await dl.save({ filename: 'refi-radar-' + (F.msa ? F.msa.split(/[-,]/)[0].trim().toLowerCase().replace(/\s+/g, '-') + '-' : '') + 'loans.csv', data: lines.join('\n') }); } catch (e) {}
  };
}

// ---------- wiring ----------
function wire() {
  $('#aboutBtn').onclick = () => { const a = $('#about'); a.hidden = !a.hidden; $('#aboutBtn').setAttribute('aria-expanded', String(!a.hidden)); };
  $('#editBtn').onclick = () => { const a = $('#assump'); a.hidden = !a.hidden; $('#editBtn').setAttribute('aria-expanded', String(!a.hidden)); $('#editBtn').textContent = a.hidden ? 'Edit assumptions' : 'Hide assumptions'; };
  $('#resetBtn').onclick = () => { A = clone(RR_DEFAULTS); saveA(); renderAssumpEditor(); changed(); };
  let qT; $('#fQ').oninput = e => { clearTimeout(qT); qT = setTimeout(() => { F.q = e.target.value.trim(); limit = 120; renderList(); }, 150); };
  $('#fMsa').onchange = e => { F.msa = e.target.value; limit = 120; renderList(); };
  $('#fType').onchange = e => { F.type = e.target.value; limit = 120; renderList(); };
  $('#fBucket').onchange = e => { F.bucket = e.target.value; limit = 120; renderSummary(); renderList(); };
  $('#fMat').onchange = e => { F.mat = e.target.value; limit = 120; renderList(); };
  $('#fMin').onchange = e => { F.min = +e.target.value; limit = 120; renderList(); };
  $('#fSort').onchange = e => { sortKey = e.target.value; sortDir = (SORTS[sortKey] || [0, -1])[1]; limit = 120; renderList(); };
  $('#vLoans').onclick = () => { view = 'loans'; setView(); renderList(); };
  $('#vMsa').onclick = () => { view = 'msa'; setView(); renderList(); };
  $('#clearBtn').onclick = clearAll;
  $('#moreBtn').onclick = () => { limit += 120; renderList(); };
}

(function stamp(){ const e = document.getElementById('asOf'); if (e) e.textContent = fdl(RR_DEFAULTS.ust10Date) + ' close'; const l = document.getElementById('loanAsOf'); if (l && RR_DEFAULTS.loansFiled) { const [y, m] = RR_DEFAULTS.loansFiled.split('-'); l.textContent = 'SEC Form ABS-EE, filings through ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1] + ' ' + y; } })();
compute(); fillSelects(); renderRates(); renderAssumpEditor(); renderSummary(); wire(); setView(); renderList();
(async () => {
  try { sample = await claude.use('sample'); } catch (e) { sample = null; }
  if (sample) setupAsk(); else setupQuick();
  setupCsv();
})();
})();
