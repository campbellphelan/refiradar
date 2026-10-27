(function(){
'use strict';
const $ = s => document.querySelector(s);
const fm = v => v == null || !isFinite(v) ? '—' : Math.abs(v) >= 1e9 ? '$' + (v / 1e9).toFixed(1) + 'B' : '$' + Math.round(v / 1e6) + 'M';
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const BK = [['Self-funded','cash'],['Revolver covers it','ready'],['Routine refinance','mezz'],['Needs new capital','gap'],['Stretched','work'],['Insufficient data','na']];
const BC = Object.fromEntries(BK);
const A0 = RW_DEFAULTS;
const winEnd = m => { const d = new Date(RW_TODAY); d.setMonth(d.getMonth() + m); return d; };
const fmy = d => MON[d.getMonth()] + ' ' + d.getFullYear();
const fdl = iso => { const [y, m, d] = iso.split('-'); return MON[+m - 1] + ' ' + (+d) + ', ' + y; };
const R = REITS.map(r => ({ r, s: rwSize(r) }));
const sum = (xs, f) => xs.reduce((a, x) => a + (f(x) || 0), 0);
const due = sum(R, x => x.s.due), due12 = sum(R, x => x.s.due12), need = sum(R, x => x.s.need);
const end = winEnd(A0.windowMonths);

// hero
$('#hMonth').textContent = MONL[RW_TODAY.getMonth()] + ' ' + RW_TODAY.getFullYear();
$('#hDue').textContent = fm(due); $('#hDue2').textContent = fm(due); $('#hNeed').textContent = fm(need);
$('#h10').textContent = `10-year is at ${A0.ust10.toFixed(2)}%.`;
$('#hN').textContent = R.length; $('#mN').textContent = R.length; $('#footN').textContent = R.length;
$('#hEnd').textContent = MONL[end.getMonth()] + ' ' + end.getFullYear();
$('#wallRange').textContent = `Next ${A0.windowMonths} months · to ${fmy(end)}`;
const cnt = {}; R.forEach(x => { if (x.r.asOf) cnt[x.r.asOf] = (cnt[x.r.asOf] || 0) + 1; }); const modal = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];  // most common balance-sheet date
if (modal) { const [y, m, d] = modal.split('-'); $('#footAsOf').textContent = MONL[+m - 1] + ' ' + (+d) + ', ' + y; }

// largest funding gaps
const segsFor = s => {
  const cash = Math.min(s.cash, s.due);
  const rcf = Math.max(Math.min(Math.max(s.rcfWin, 0), s.due - cash), 0);
  const rev = Math.max(Math.min(s.revolver || 0, s.due - cash - rcf), 0);
  return [[cash, 'var(--b-cash)', 'Cash'], [rcf, 'var(--b-ready)', 'Retained cash flow'], [rev, 'var(--accent)', 'Revolver'], [s.need, 'var(--b-gap)', 'Shortfall']];
};
const top = R.filter(x => x.s.need > 0).sort((a, b) => b.s.need - a.s.need).slice(0, 12);
const maxDue = Math.max(...top.map(x => x.s.due));
const gl = $('#gapList');
for (const { r, s } of top) {
  const row = document.createElement('div'); row.className = 'gap-row';
  const nm = document.createElement('div'); nm.className = 'nm';
  nm.innerHTML = `<b>${r.ticker}</b>${r.name}<small>${r.sector} · ${s.bucket}</small>`;
  const bar = document.createElement('div'); bar.className = 'msa-bar'; bar.style.width = Math.max(6, s.due / maxDue * 100) + '%';
  for (const [v, c, t] of segsFor(s)) { if (v <= 1) continue; const sp = document.createElement('span'); sp.style.width = v / s.due * 100 + '%'; sp.style.background = c; sp.title = `${t}: ${fm(v)}`; bar.append(sp); }
  const v = document.createElement('div'); v.className = 'v'; v.innerHTML = `${fm(s.need)}<small>of ${fm(s.due)} due</small>`;
  row.append(nm, bar, v); gl.append(row);
}
$('#gapLegend').innerHTML = [['var(--b-cash)', 'Cash'], ['var(--b-ready)', 'Retained cash flow'], ['var(--accent)', 'Undrawn revolver'], ['var(--b-gap)', 'Shortfall: capital needed from outside']].map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');

// stats
const rates = R.map(x => x.s.rate).filter(v => v != null).sort((a, b) => a - b); const med = rates[Math.floor(rates.length / 2)];
const igR = A0.ust10 + A0.tiers[0].spread / 100;
const str = R.filter(x => x.s.bucket === 'Stretched');
[[fm(due), `of debt due by ${fmy(end)}`], [fm(due12), 'due in the next 12 months'],
 [`${med.toFixed(2)}<small>%</small> → ${igR.toFixed(2)}<small>%</small>`, 'median rate on REIT debt today vs. a 10-year investment-grade REIT bond'],
 [fm(need), 'that cash, cash flow and credit lines don’t cover'], [String(str.length), `REITs stretched, with ${fm(sum(str, x => x.s.due))} due`]]
  .forEach(([v, l]) => { const d = document.createElement('div'); d.className = 'stat'; d.innerHTML = `<div class="v">${v}</div><div class="l">${l}</div>`; $('#stats').append(d); });

// sectors
const bySec = {}; for (const x of R) (bySec[x.r.sector] = bySec[x.r.sector] || []).push(x);
const secs = Object.entries(bySec).map(([k, xs]) => ({ k, xs, due: sum(xs, x => x.s.due), need: sum(xs, x => x.s.need) })).filter(x => x.due > 0).sort((a, b) => b.due - a.due);
const maxS = secs[0].due; const sl = $('#secList');
for (const x of secs) {
  const row = document.createElement('div'); row.className = 'msa-row';
  const nm = document.createElement('div'); nm.textContent = `${x.k} (${x.xs.length})`;
  const bar = document.createElement('div'); bar.className = 'msa-bar'; bar.style.width = Math.max(4, x.due / maxS * 100) + '%';
  for (const [k, c] of BK) { const v = sum(x.xs.filter(y => y.s.bucket === k), y => y.s.due); if (!v) continue; const sp = document.createElement('span'); sp.style.width = v / x.due * 100 + '%'; sp.style.background = `var(--b-${c})`; sp.title = `${k}: ${fm(v)}`; bar.append(sp); }
  const v = document.createElement('div'); v.className = 'v'; v.textContent = fm(x.need); v.title = `${fm(x.need)} shortfall of ${fm(x.due)} due`;
  row.append(nm, bar, v); sl.append(row);
}
const hd = document.createElement('div'); hd.className = 'msa-row'; hd.style.cssText = 'color:var(--muted);font-size:12px;padding-top:0';
hd.innerHTML = '<div>Sector (REITs)</div><div>Due in the window, by outcome</div><div class="v" style="font-family:var(--display)">Shortfall</div>'; sl.prepend(hd);
$('#secLegend').innerHTML = BK.filter(([k]) => R.some(x => x.s.bucket === k && x.s.due > 0)).map(([k, c]) => `<span><i style="background:var(--b-${c})"></i>${k}</span>`).join('');
const topNeed = secs.slice().sort((a, b) => b.need - a.need)[0];
if (topNeed) $('#secH').textContent = `${topNeed.k} REITs need the most outside capital: ${fm(topNeed.need)}.`;

// window slider
function win(m) {
  const A = JSON.parse(JSON.stringify(A0)); A.windowMonths = m;
  const S = REITS.map(r => rwSize(r, A)); const d = sum(S, s => s.due), n = sum(S, s => s.need);
  $('#oDue').textContent = fm(d); $('#oNeed').textContent = fm(n); $('#oShare').textContent = Math.round(n / (d || 1) * 100) + '%';
  $('#winOut').textContent = `${m} months · to ${fmy(winEnd(m))}`;
}
$('#winShift').addEventListener('input', e => win(+e.target.value)); win(A0.windowMonths);

// rate sheet
$('#spDate').textContent = fdl(A0.ust10Date);
let h = '<thead><tr><th>Execution</th><th>Index</th><th>Spread</th><th>All-in</th><th>Book leverage</th></tr></thead><tbody>';
let lo = 0;
for (const t of A0.tiers) { const r = A0.ust10 + t.spread / 100; h += `<tr><td>${t.name}<small>${t.term}</small></td><td>10-yr ${A0.ust10.toFixed(2)}%</td><td class="n">+${t.spread}</td><td class="n"><b>${r.toFixed(2)}%</b></td><td class="n">${t.maxLev >= 999 ? 'over ' + lo + '%' : (lo ? lo + '% to ' : 'up to ') + t.maxLev + '%'}</td></tr>`; lo = t.maxLev; }
h += `<tr><td>Bank term loan<small>3 to 5-yr, floating</small></td><td>SOFR ${A0.sofr.toFixed(2)}%</td><td class="n">+${A0.bank.spread}</td><td class="n"><b>${(A0.sofr + A0.bank.spread / 100).toFixed(2)}%</b></td><td class="n">—</td></tr>`;
h += `<tr><td>Preferred or JV equity<small>target return</small></td><td>fixed</td><td class="n">—</td><td class="n"><b>${A0.pref.rate.toFixed(2)}%</b></td><td class="n">—</td></tr>`;
h += `<tr class="old"><td>For comparison: median rate on REIT debt today<small>from the latest filings</small></td><td>—</td><td class="n">—</td><td class="n">${med.toFixed(2)}%</td><td class="n">—</td></tr></tbody>`;
$('#spTable').innerHTML = h;
$('#addInt').textContent = fm(sum(R, x => x.s.addedInterest));

// case
const cs = R.find(x => x.r.ticker === 'GOOD' && x.s.need > 0) || R.filter(x => x.s.bucket === 'Needs new capital').sort((a, b) => b.s.score - a.s.score)[0];
if (cs) {
  const { r, s } = cs; const own = s.due - s.need;
  $('#caseH').textContent = `${r.name}: ${fm(s.due)} due, ${fm(s.need)} it can’t cover.`;
  const kv = [['Due by ' + fmy(end), fm(s.due)], ['Cash', fm(s.cash)], ['Retained cash flow', fm(s.rcf) + ' / yr'], ['Undrawn revolver', s.revolver == null ? 'not tagged' : fm(s.revolver)],
    ['Book leverage', s.lev == null ? '—' : Math.round(s.lev * 100) + '%'], ['Dividend coverage', s.divCover == null ? '—' : s.divCover.toFixed(2) + '×'],
    ['Rate today', s.rate == null ? '—' : s.rate.toFixed(2) + '%'], ['Refinance rate', s.newRate.toFixed(2) + '%']];
  $('#caseKv').innerHTML = kv.map(([k, v]) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  const segs = segsFor(s).filter(x => x[0] > 1); const tot = sum(segs, x => x[0]) || 1;
  $('#caseStack').innerHTML = segs.map(([v, c]) => `<span style="width:${v / tot * 100}%;background:${c}">${v / tot > .12 ? fm(v) : ''}</span>`).join('');
  $('#caseLeg').innerHTML = segs.map(([v, c, t]) => `<span><i style="background:${c}"></i>${t}: <b class="num">${fm(v)}</b></span>`).join('');
  const lev = s.lev != null ? `At ${Math.round(s.lev * 100)}% book leverage, the rest` : 'The rest';
  const rateTxt = s.rate != null ? `, against the ${s.rate.toFixed(2)}% it pays now` : '';
  const divTxt = s.divCover != null && s.divCover < 1.1 ? ' Its dividend uses up nearly all of its operating cash flow, so there is little retained cash to help.' : '';
  $('#caseNote').innerHTML = `<span class="by">From the pitch notes</span>${r.name} has ${fm(s.due)} coming due by ${fmy(end)} and about ${fm(own)} of its own to pay it. ${lev} prices as ${s.tier.name.toLowerCase()} debt near ${s.newRate.toFixed(2)}%${rateTxt}.${divTxt} Preferred or JV equity could close the ${fm(s.need)} gap without adding to its debt.`;
}

// method facts
const src = {}; for (const { r } of R) if (r.ladderSrc) src[r.ladderSrc] = (src[r.ladderSrc] || 0) + 1;
const tags = (src['XBRL maturity tags'] || 0) + (src['XBRL maturity tags by debt type'] || 0);
const tables = (src['Maturity table in the 10-K debt note'] || 0) + (src['Loan and bond list in the 10-K debt note'] || 0);
const hand = src['Read from the 10-K debt note'] || 0;
$('#mSrc').textContent = `Debt maturities by year from the XBRL tags (${tags} REITs), the debt-note table in the 10-K (${tables}), or read by hand from the 10-K where neither parses (${hand}).`;
const chk = R.map(x => x.r.ladderCheck).filter(v => v != null);
const within = chk.filter(v => v >= 0.95 && v <= 1.05).length, low = chk.filter(v => v < 0.9).length;
$('#mChk').textContent = `Each maturity schedule is added up and compared with the total debt on the balance sheet. ${within} of ${chk.length} come within 5%. ${low} cover less than 90%, usually because a credit line isn’t broken out by year, and those are flagged.`;
const miss = R.filter(x => x.s.bucket === 'Insufficient data').map(x => x.r.ticker);
$('#mMissN').textContent = miss.length;
const list = miss.length > 1 ? miss.slice(0, -1).join(', ') + ' and ' + miss[miss.length - 1] : miss.join('');
$('#mMiss').textContent = `${list} don’t publish a maturity schedule the reader can use, so they’re shown as insufficient data instead of guessed.`;

// grid illustration
const gr = R.filter(x => x.s.need > 0).sort((a, b) => b.s.need - a.s.need).slice(0, 4);
$('#gridBody').innerHTML = gr.map(({ r, s }) => `<tr><td><b>${r.ticker}</b> ${r.name}</td><td class="num">${fm(s.due)}<span class="cite">10-K, FY${(r.fyEnd || '').slice(0, 4)}</span></td><td class="num">${fm(s.need)}</td><td>${s.bucket}</td><td class="q">ask the credit agreement</td><td class="q">ask the transcript</td></tr>`).join('');

// copy buttons
document.querySelectorAll('.copy').forEach(b => b.addEventListener('click', async () => {
  const t = b.dataset.copy; try { await navigator.clipboard.writeText(t); b.textContent = 'Copied'; } catch (e) { const rg = document.createRange(); rg.selectNodeContents(b.previousElementSibling); const sl2 = getSelection(); sl2.removeAllRanges(); sl2.addRange(rg); b.textContent = 'Selected'; }
  setTimeout(() => b.textContent = 'Copy', 1800);
}));
})();
