(function(){
'use strict';
const $ = s => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, a) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
const fm = v => Math.abs(v) >= 1e9 ? '$' + (v / 1e9).toFixed(1) + 'B' : '$' + Math.round(v / 1e6) + 'M';
const BK = [['Cash-out refi','cash'],['Refi-ready','ready'],['Recap: mezz','mezz'],['Recap: mezz + pref','pref'],['Equity gap','gap'],['Workout','work'],['Insufficient data','na']];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONL_ = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const R = LOANS.map(l => ({ l, s: rrSize(l) }));
const tot = R.reduce((a, r) => a + r.s.bal, 0);

// hero numbers
$('#hN').textContent = R.length; $('#hBal').textContent = fm(tot);
$('#hMsa').textContent = new Set(R.map(r => r.l.msa).filter(m => !/^Multiple|^Unknown/.test(m))).size;
const fdl = iso => { const [y, m, d] = iso.split('-'); return MON[+m - 1] + ' ' + (+d) + ', ' + y; };
$('#hMonth').textContent = MONL_[RR_TODAY.getMonth()] + ' ' + RR_TODAY.getFullYear();
$('#h10').textContent = `10-year is at ${RR_DEFAULTS.ust10.toFixed(2)}%.`;
$('#spDate').textContent = fdl(RR_DEFAULTS.ust10Date);
$('#mN').textContent = R.length;
if (RR_DEFAULTS.loansFiled) { const [fy, fmn] = RR_DEFAULTS.loansFiled.split('-'); $('#footLoan').textContent = 'filings through ' + MONL_[+fmn - 1] + ' ' + fy; }

// wall chart: current month through Dec 2027; loans already past maturity fold into the first bar
const months = []; for (let y = RR_TODAY.getFullYear(), m = RR_TODAY.getMonth(); y < 2028; ) { months.push(`${y}-${String(m + 1).padStart(2, '0')}`); m++; if (m === 12) { m = 0; y++; } }
const buckets = months.map(() => Object.fromEntries(BK.map(b => [b[0], 0])));
for (const r of R) { let k = r.l.mat.slice(0, 7); let i = months.indexOf(k); if (i < 0) i = k < months[0] ? 0 : months.length - 1; buckets[i][r.s.bucket] += r.s.bal; }
const totals = buckets.map(b => Object.values(b).reduce((a, v) => a + v, 0));
const W = 1060, H = 330, pl = 54, pr = 10, pt = 16, pb = 44;
const maxV = Math.max(...totals); const step = maxV > 3e9 ? 1e9 : 5e8; const top = Math.ceil(maxV / step) * step;
const y = v => pt + (H - pt - pb) * (1 - v / top);
const bw = (W - pl - pr) / months.length;
const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Monthly maturities by outcome' });
for (let v = 0; v <= top + 1; v += step) {
  svg.append(sv('line', { x1: pl, x2: W - pr, y1: y(v), y2: y(v), stroke: 'var(--rule-2)', 'stroke-width': 1 }));
  const t = sv('text', { x: pl - 8, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11.5, fill: 'var(--muted)' }); t.textContent = v === 0 ? '0' : (v / 1e9).toFixed(1).replace('.0', '') + 'B'; svg.append(t);
}
months.forEach((m, i) => {
  let acc = 0; const x = pl + i * bw + bw * 0.14, w = bw * 0.72;
  for (const [k, c] of BK) { const v = buckets[i][k]; if (!v) continue; const r = sv('rect', { x, y: y(acc + v), width: w, height: Math.max(0, y(acc) - y(acc + v)), fill: `var(--b-${c})` }); const tt = sv('title', {}); tt.textContent = `${MON[+m.slice(5) - 1]} ${m.slice(0, 4)} · ${k}: ${fm(v)}`; r.append(tt); svg.append(r); acc += v; }
  if (totals[i] > 0) { const t = sv('text', { x: x + w / 2, y: y(totals[i]) - 5, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--ink-2)' }); t.textContent = fm(totals[i]).replace('$', ''); svg.append(t); }
  const lb = sv('text', { x: x + w / 2, y: H - pb + 16, 'text-anchor': 'middle', 'font-size': 11.5, fill: 'var(--muted)' }); lb.textContent = MON[+m.slice(5) - 1]; svg.append(lb);
  if (m.endsWith('-01') || i === 0) { const yl = sv('text', { x: x + w / 2, y: H - pb + 32, 'text-anchor': 'middle', 'font-size': 11.5, fill: 'var(--ink-2)', 'font-weight': 600 }); yl.textContent = m.slice(0, 4); svg.append(yl); }
});
$('#wallChart').append(svg);
$('#wallRange').textContent = `$ millions · ${MON[+months[0].slice(5) - 1]} ${months[0].slice(0, 4)} to Dec 2027`;
const lg = $('#wallLegend'); for (const [k, c] of BK) { if (!R.some(r => r.s.bucket === k)) continue; const s = document.createElement('span'); s.innerHTML = `<i style="background:var(--b-${c})"></i>${k}`; lg.append(s); }

// stats
const cov = R.filter(r => ['Cash-out refi', 'Refi-ready'].includes(r.s.bucket)).reduce((a, r) => a + r.s.bal, 0);
const mp = R.reduce((a, r) => a + r.s.mezzUsed + r.s.prefUsed, 0);
const eq = R.reduce((a, r) => a + r.s.equityShort, 0);
const coupons = LOANS.map(l => l.rate).sort((a, b) => a - b); const med = coupons[Math.floor(coupons.length / 2)];
const cm = RR_DEFAULTS.programs[0]; const cmR = RR_DEFAULTS.ust10 + cm.spread / 100;
const st = $('#stats');
$('#hCpn').textContent = med.toFixed(2) + '%'; $('#hNew').textContent = cmR.toFixed(2) + '%'; $('#hCov').textContent = Math.round(cov / tot * 100) + '%';
[[fm(tot), 'whole-loan balance due by Dec 2027'], [`${med.toFixed(2)}<small>%</small> → ${cmR.toFixed(2)}<small>%</small>`, 'median coupon on these loans vs. a 10-year CMBS loan today'], [Math.round(cov / tot * 100) + '<small>%</small>', 'of balance refinances at the same size with senior debt alone'], [fm(mp), 'of mezz and preferred equity needed to close the gaps'], [fm(eq), 'of new equity that lenders won’t provide']]
  .forEach(([v, l]) => { const d = document.createElement('div'); d.className = 'stat'; d.innerHTML = `<div class="v">${v}</div><div class="l">${l}</div>`; st.append(d); });

// MSA list
const byM = {}; for (const r of R) { (byM[r.l.msa] = byM[r.l.msa] || []).push(r); }
const ms = Object.entries(byM).filter(([m]) => !/^Multiple|^Unknown/.test(m)).map(([m, rs]) => ({ m, rs, bal: rs.reduce((a, r) => a + r.s.bal, 0) })).sort((a, b) => b.bal - a.bal).slice(0, 12);
const maxB = ms[0].bal; const ml = $('#msaList');
for (const x of ms) {
  const row = document.createElement('div'); row.className = 'msa-row';
  const nm = document.createElement('div'); nm.textContent = x.m.replace(/,.*$/, '') + ', ' + x.m.split(', ').pop(); nm.title = x.m;
  const bar = document.createElement('div'); bar.className = 'msa-bar'; bar.style.width = Math.max(4, x.bal / maxB * 100) + '%';
  for (const [k, c] of BK) { const v = x.rs.filter(r => r.s.bucket === k).reduce((a, r) => a + r.s.bal, 0); if (!v) continue; const s = document.createElement('span'); s.style.width = v / x.bal * 100 + '%'; s.style.background = `var(--b-${c})`; s.title = `${k}: ${fm(v)}`; bar.append(s); }
  const v = document.createElement('div'); v.className = 'v'; v.textContent = fm(x.bal);
  row.append(nm, bar, v); ml.append(row);
}
const nyShare = (byM['New York-Newark-Jersey City, NY-NJ'] || []).reduce((a, r) => a + r.s.bal, 0) / tot;
if (nyShare > 0) $('#nyH').textContent = `New York accounts for ${Math.round(nyShare * 100)}% of the balance.`;

// LTV binding share
const lb = R.filter(r => r.s.best && r.s.best.binding === 'LTV').reduce((a, r) => a + r.s.bal, 0);
$('#ltvShare').textContent = Math.round(lb / tot * 100) + '%';

// stress slider
const clone = o => JSON.parse(JSON.stringify(o));
function stress(d) {
  const A = clone(RR_DEFAULTS); for (const k in A.caps) A.caps[k] += d / 100;
  const S = LOANS.map(l => rrSize(l, A)); const t = S.reduce((a, s) => a + s.bal, 0);
  const ok = S.filter(s => !['Equity gap', 'Workout', 'Insufficient data'].includes(s.bucket)).reduce((a, s) => a + s.bal, 0);
  $('#oShare').textContent = Math.round(ok / t * 100) + '%'; $('#oGap').textContent = fm(S.reduce((a, s) => a + s.equityShort, 0));
  $('#capOut').textContent = (d > 0 ? '+' : d < 0 ? '−' : '+') + Math.abs(d) + ' bps';
}
$('#capShift').addEventListener('input', e => stress(+e.target.value)); stress(0);

// spread table
const spt = $('#spTable');
let html = '<thead><tr><th>Lender</th><th>Index</th><th>Spread</th><th>All-in</th><th>Max LTV</th><th>Min DSCR</th><th>Min debt yield</th></tr></thead><tbody>';
for (const p of RR_DEFAULTS.programs) {
  const r = (p.index === 'sofr' ? RR_DEFAULTS.sofr : RR_DEFAULTS.ust10) + p.spread / 100;
  html += `<tr><td>${p.name}<small>${p.term}${p.amort ? ', ' + p.amort + '-yr amortization' : ', interest-only'}</small></td><td>${p.index === 'sofr' ? 'SOFR ' + RR_DEFAULTS.sofr.toFixed(2) + '%' : '10-yr ' + RR_DEFAULTS.ust10.toFixed(2) + '%'}</td><td class="n">+${p.spread}</td><td class="n"><b>${r.toFixed(2)}%</b></td><td class="n">${p.ltv}%</td><td class="n">${p.dscr.toFixed(2)}×</td><td class="n">${p.dy.toFixed(1)}%</td></tr>`;
}
html += `<tr><td>Mezzanine<small>current pay</small></td><td>fixed</td><td class="n">—</td><td class="n"><b>${RR_DEFAULTS.mezz.rate.toFixed(2)}%</b></td><td class="n">to ${RR_DEFAULTS.mezz.maxCltv}%</td><td class="n">—</td><td class="n">—</td></tr>`;
html += `<tr><td>Preferred equity<small>preferred return</small></td><td>fixed</td><td class="n">—</td><td class="n"><b>${RR_DEFAULTS.pref.rate.toFixed(2)}%</b></td><td class="n">to ${RR_DEFAULTS.pref.maxCltv}%</td><td class="n">—</td><td class="n">—</td></tr>`;
html += `<tr class="old"><td>For comparison: median coupon on these loans<small>set in 2016 and 2017</small></td><td>—</td><td class="n">—</td><td class="n">${med.toFixed(2)}%</td><td class="n">—</td><td class="n">—</td><td class="n">—</td></tr></tbody>`;
spt.innerHTML = html;

// case: Olympic Tower
const ot = R.find(r => r.l.name === 'Olympic Tower');
if (ot) {
  const { l, s } = ot;
  if (l.occRec != null) $('#caseH').textContent = s.gap > 0 ? `Olympic Tower: ${Math.round(l.occRec * 100)}% occupied, still ${fm(s.gap)} short.` : `Olympic Tower: ${Math.round(l.occRec * 100)}% occupied, and senior debt now covers the payoff.`;
  const kv = [['Matures', MON[+l.mat.slice(5, 7) - 1] + ' ' + l.mat.slice(0, 4)], ['Whole loan', fm(s.bal) + ' (est.)'], ['Coupon', l.rate.toFixed(2) + '% IO'], ['Occupancy', Math.round(l.occRec * 100) + '%'], ['Cash flow (NCF)', fm(s.ncf)], ['Debt yield', (s.inPlaceDY * 100).toFixed(1) + '%'], ['Value at 7.0% cap', fm(s.value)], ['Best senior', (s.best.name.replace(' conduit', '')) + ' ' + s.best.rate.toFixed(2) + '%']];
  $('#caseKv').innerHTML = kv.map(([k, v]) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  const segs = [[Math.min(s.seniorProceeds, s.need), 'var(--accent)', 'Senior at 65% LTV'], [s.mezzUsed, 'var(--b-mezz)', `Mezz at ${RR_DEFAULTS.mezz.rate}%`], [s.prefUsed, 'var(--b-pref)', 'Pref'], [s.equityShort, 'var(--b-gap)', 'Equity gap']].filter(x => x[0] > 1);
  const sum = segs.reduce((a, x) => a + x[0], 0);
  $('#caseStack').innerHTML = segs.map(([v, c]) => `<span style="width:${v / sum * 100}%;background:${c}">${v / sum > .1 ? fm(v) : ''}</span>`).join('');
  $('#caseLeg').innerHTML = segs.map(([v, c, t]) => `<span><i style="background:${c}"></i>${t}: <b class="num">${fm(v)}</b></span>`).join('') + `<span><i style="background:transparent;border:1.5px solid var(--ink)"></i>Payoff incl. costs: <b class="num">${fm(s.need)}</b></span>`;
}

// grid illustration
const G = [['Hilton Hawaiian Village', 'Park Hotels & Resorts', 'WFCM 2016-C37'], ['Olympic Tower', 'OMERS / Oxford; Crown Acquisitions', 'GSMS 2017-GS7'], ['General Motors Building', 'Boston Properties (BXP) et al.', 'WFCM 2017-C38'], ['The Summit Birmingham', 'Bayer Properties principals; IMI', 'BANK 2017-BNK4']];
$('#gridBody').innerHTML = G.map(([n, sp, d]) => { const r = R.find(x => x.l.name === n); if (!r) return ''; return `<tr><td><b>${n}</b></td><td>${sp}<span class="cite">${d} prospectus</span></td><td class="num">${MON[+r.l.mat.slice(5, 7) - 1]} ${r.l.mat.slice(0, 4)}</td><td>${r.s.bucket}<span class="cite">gap ${r.s.gap > 0 ? '+' : '−'}${fm(Math.abs(r.s.gap))}</span></td><td class="q">ask the loan agreement</td><td class="q">ask the prospectus</td></tr>`; }).join('');

// copy buttons
document.querySelectorAll('.copy').forEach(b => b.addEventListener('click', async () => {
  const t = b.dataset.copy; try { await navigator.clipboard.writeText(t); b.textContent = 'Copied'; } catch (e) { const r = document.createRange(); r.selectNodeContents(b.previousElementSibling); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = 'Selected'; }
  setTimeout(() => b.textContent = 'Copy', 1800);
}));
})();
