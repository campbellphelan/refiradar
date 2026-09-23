// Refi Radar sizing engine — shared by the tool and the website build.
const RR_R = (typeof RR_RATES !== 'undefined' && RR_RATES) ? RR_RATES : { ust10: 4.96, ust10Date: '2026-09-22', sofr: 3.87, sofrDate: '2026-09-22', today: '2026-09-23', loansFiled: '2026-08-31' };
const RR_TODAY = new Date(RR_R.today + 'T12:00:00');
const RR_DEFAULTS = {
  asOf: RR_R.today,
  ust10: RR_R.ust10,       // 10-yr Treasury close (U.S. Treasury daily par yield curve)
  ust10Date: RR_R.ust10Date,
  sofr: RR_R.sofr,         // SOFR (New York Fed)
  sofrDate: RR_R.sofrDate,
  loansFiled: RR_R.loansFiled,
  closingPct: 1.5,
  feeSeniorBps: 50,
  feeSubBps: 100,
  mezz: { rate: 12.5, maxCltv: 80 },
  pref: { rate: 15.0, maxCltv: 88 },
  caps: { 'Multifamily': 5.50, 'Industrial': 5.75, 'Self storage': 6.00, 'Manufactured housing': 5.75,
          'Co-op housing': 5.25, 'Retail': 7.00, 'Mixed use': 7.00, 'Office': 8.75, 'Hotel': 8.50,
          'Healthcare': 7.50, 'Portfolio / other': 7.25, 'Other': 7.25 },
  programs: [
    { id: 'cmbs',   name: 'CMBS conduit', term: '10-yr fixed', index: 'ust10', spread: 190, ltv: 65, dscr: 1.30, dy: 9.5, amort: 0,
      types: null },
    { id: 'life',   name: 'Life company', term: '10-yr fixed', index: 'ust10', spread: 175, ltv: 60, dscr: 1.35, dy: 10.0, amort: 30,
      types: ['Multifamily','Industrial','Retail','Office','Mixed use','Self storage','Manufactured housing','Co-op housing'] },
    { id: 'agency', name: 'Agency (Fannie/Freddie)', term: '10-yr fixed', index: 'ust10', spread: 115, ltv: 75, dscr: 1.25, dy: 7.0, amort: 30,
      types: ['Multifamily','Manufactured housing','Co-op housing','Healthcare'] },
    { id: 'bank',   name: 'Bank', term: '5-yr, swapped', index: 'sofr', spread: 235, ltv: 65, dscr: 1.25, dy: 9.5, amort: 30,
      types: null },
    { id: 'bridge', name: 'Debt fund / bridge', term: '3+1+1 floating', index: 'sofr', spread: 325, ltv: 72, dscr: 1.00, dy: 7.5, amort: 0,
      types: null },
  ],
};

function rrConstant(ratePct, amortYrs) {
  const r = ratePct / 100;
  if (!amortYrs) return r;
  const m = r / 12, n = amortYrs * 12;
  return (m / (1 - Math.pow(1 + m, -n))) * 12;
}
function rrMonthsBetween(a, b) { return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() - a.getDate()) / 30; }

function rrCashFlow(l) {
  if (l.ncfRec != null && l.ncfRec !== 0) return { ncf: l.ncfRec, basis: 'Most recent NCF', stale: false };
  if (l.noiRec != null && l.noiRec !== 0) return { ncf: l.noiRec * 0.95, basis: 'Recent NOI less 5% reserves', stale: false };
  if (l.ncfSec != null) return { ncf: l.ncfSec, basis: 'Underwritten NCF (no recent financials)', stale: true };
  return { ncf: null, basis: 'No cash flow reported', stale: true };
}

function rrSize(l, A) {
  A = A || RR_DEFAULTS;
  const cf = rrCashFlow(l);
  const ncf = cf.ncf;
  const cap = A.caps[l.type] ?? 7.25;
  const value = ncf && ncf > 0 ? ncf / (cap / 100) : null;
  const bal = l.wholeBal || l.trustBal || 0;
  const need = bal * (1 + A.closingPct / 100);
  const mat = new Date(l.mat);
  const monthsToMat = rrMonthsBetween(RR_TODAY, mat);

  const quotes = A.programs.map(p => {
    const eligible = !p.types || p.types.includes(l.type);
    const rate = (p.index === 'sofr' ? A.sofr : A.ust10) + p.spread / 100;
    const k = rrConstant(rate, p.amort);
    let byLtv = value ? value * p.ltv / 100 : 0;
    let byDscr = ncf > 0 ? ncf / (p.dscr * k) : 0;
    let byDy = ncf > 0 ? ncf / (p.dy / 100) : 0;
    const proceeds = Math.max(0, Math.min(byLtv, byDscr, byDy));
    const binding = proceeds === byLtv ? 'LTV' : proceeds === byDscr ? 'DSCR' : 'Debt yield';
    return { id: p.id, name: p.name, term: p.term, index: p.index, spread: p.spread, rate, constant: k, eligible,
             byLtv, byDscr, byDy, proceeds: eligible ? proceeds : 0, binding, coverage: bal ? proceeds / bal : 0,
             annualDS: proceeds * k };
  });
  const elig = quotes.filter(q => q.eligible && q.proceeds > 0);
  const perm = elig.filter(q => q.id !== 'bridge');
  const bridge = elig.find(q => q.id === 'bridge') || null;
  const covering = perm.filter(q => q.proceeds >= need).sort((a, b) => a.rate - b.rate);
  const maxPerm = perm.slice().sort((a, b) => b.proceeds - a.proceeds)[0] || null;
  // Best execution: cheapest permanent lender that covers the payoff; otherwise the largest permanent quote.
  const best = covering[0] || maxPerm || bridge;
  const seniorProceeds = best ? best.proceeds : 0;
  const permMax = maxPerm ? maxPerm.proceeds : 0;
  const gap = need - seniorProceeds;
  const bridgeCovers = !!bridge && bridge.proceeds >= need;

  const mezzCap = value ? Math.max(0, value * A.mezz.maxCltv / 100 - seniorProceeds) : 0;
  const prefCap = value ? Math.max(0, value * A.pref.maxCltv / 100 - Math.max(seniorProceeds, value * A.mezz.maxCltv / 100)) : 0;
  const mezzUsed = Math.max(0, Math.min(gap, mezzCap));
  const prefUsed = Math.max(0, Math.min(gap - mezzUsed, prefCap));
  const equityShort = Math.max(0, gap - mezzUsed - prefUsed);

  // Status flags
  const delinquent = ['1', '2', '3', '5'].includes(String(l.pay));
  const inSS = !!l.ssXfer && (!l.msReturn || l.msReturn < l.ssXfer);
  const matured = monthsToMat < 0;
  const flags = [];
  if (inSS) flags.push({ k: 'ss', t: 'With special servicer since ' + l.ssXfer, sev: 3 });
  if (delinquent) flags.push({ k: 'dq', t: { '1': '30–59 days delinquent', '2': '60–89 days delinquent', '3': '90+ days delinquent', '5': 'Matured, non-performing balloon' }[l.pay], sev: 3 });
  if (String(l.pay) === '4') flags.push({ k: 'mat', t: 'Matured, performing balloon', sev: 2 });
  if (matured && !delinquent && String(l.pay) !== '4') flags.push({ k: 'mat', t: 'Past stated maturity', sev: 2 });
  if (l.mod) flags.push({ k: 'mod', t: 'Loan has been modified', sev: 2 });
  if (l.occSec != null && l.occRec != null && l.occSec - l.occRec >= 0.10) flags.push({ k: 'occ', t: `Occupancy down ${Math.round((l.occSec - l.occRec) * 100)} pts since securitization`, sev: 2 });
  if (l.ncfSec && ncf != null && !cf.stale && (ncf / l.ncfSec - 1) <= -0.20) flags.push({ k: 'ncf', t: `Cash flow down ${Math.round((1 - ncf / l.ncfSec) * 100)}% vs underwriting`, sev: 2 });
  if (l.topExp && l.sf && l.topSf && l.topSf / l.sf >= 0.15) {
    const te = new Date(l.topExp); const mo = rrMonthsBetween(mat, te);
    if (mo <= 24) flags.push({ k: 'roll', t: `Top tenant (${Math.round(l.topSf / l.sf * 100)}% of SF) expires ${l.topExp}`, sev: 2 });
  }
  if (cf.stale) flags.push({ k: 'stale', t: cf.basis, sev: 1 });
  else if (l.finEnd && rrMonthsBetween(new Date(l.finEnd), RR_TODAY) > 15) flags.push({ k: 'stale', t: 'Financials older than 15 months (' + l.finEnd + ')', sev: 1 });
  if (l.wholeEst) flags.push({ k: 'pp', t: 'Pari passu — whole-loan balance estimated from reported debt service', sev: 0 });
  if (l.partialDef) flags.push({ k: 'def', t: 'Partially defeased', sev: 0 });

  let bucket;
  if (inSS || delinquent) bucket = 'Workout';
  else if (!ncf || ncf <= 0) bucket = 'Insufficient data';
  else if (permMax >= need + 0.10 * bal) bucket = 'Cash-out refi';
  else if (gap <= 0) bucket = 'Refi-ready';
  else if (equityShort <= 0 && prefUsed <= 0) bucket = 'Recap: mezz';
  else if (equityShort <= 0) bucket = 'Recap: mezz + pref';
  else bucket = 'Equity gap';

  const currentDS = l.dsRec || (l.io && bal ? bal * l.rate / 100 : null);
  const seniorUsed = Math.min(seniorProceeds, need);
  const newSeniorDS = best ? seniorUsed * best.constant : 0;
  const newStackDS = newSeniorDS + mezzUsed * A.mezz.rate / 100 + prefUsed * A.pref.rate / 100;
  const paymentShock = currentDS ? newStackDS / currentDS - 1 : null;
  const inPlaceDY = ncf && bal ? ncf / bal : null;
  const ltvNow = value && bal ? bal / value : null;
  const rateShockBps = best ? Math.round((best.rate - l.rate) * 100) : null;
  const feeSenior = (bucket === 'Cash-out refi' ? permMax : seniorUsed) * A.feeSeniorBps / 10000;
  const feeSub = (mezzUsed + prefUsed) * A.feeSubBps / 10000;
  const fee = bucket === 'Insufficient data' ? 0 : feeSenior + feeSub;

  // Broker opportunity score (0–100): mandate size, timing, solvability
  const sizeScore = Math.min(1, Math.log10(Math.max(bal, 1e6) / 1e6) / Math.log10(500)); // $1M→0, $500M→1
  const t = monthsToMat;
  const timeScore = t < 0 ? 0.7 : t <= 3 ? 0.8 : t <= 12 ? 1 : t <= 18 ? 0.75 : 0.5;
  const solv = { 'Recap: mezz': 1, 'Recap: mezz + pref': 0.95, 'Cash-out refi': 0.85, 'Refi-ready': 0.7, 'Equity gap': 0.55, 'Workout': 0.45, 'Insufficient data': 0.1 }[bucket];
  const score = Math.round(100 * (0.45 * sizeScore + 0.25 * timeScore + 0.30 * solv));

  return { cf, ncf, cap, value, bal, need, monthsToMat, quotes, best, bridge, bridgeCovers, permMax, seniorUsed, seniorProceeds, gap, mezzCap, prefCap, mezzUsed, prefUsed,
           equityShort, bucket, flags, currentDS, newStackDS, paymentShock, inPlaceDY, ltvNow, rateShockBps, fee, score, inSS, delinquent };
}

if (typeof module !== 'undefined') module.exports = { RR_DEFAULTS, rrSize, rrConstant };
