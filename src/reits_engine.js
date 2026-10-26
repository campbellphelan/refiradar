// REIT Runway engine: sizes each REIT's next 24 months of debt maturities against what it can fund itself.
const RW_R = (typeof RW_RATES !== 'undefined' && RW_RATES) ? RW_RATES : { ust10: 4.96, ust10Date: '2026-09-22', sofr: 3.87, sofrDate: '2026-09-22', today: '2026-09-23' };
const RW_TODAY = new Date(RW_R.today + 'T12:00:00');
const RW_DEFAULTS = {
  asOf: RW_R.today,
  ust10: RW_R.ust10, ust10Date: RW_R.ust10Date,
  sofr: RW_R.sofr, sofrDate: RW_R.sofrDate,
  windowMonths: 24,          // how far ahead to count maturities
  // what a refinance costs today, by leverage (debt ÷ gross real estate at cost)
  tiers: [
    { id: 'ig', name: 'Investment-grade unsecured', term: '10-yr bond', maxLev: 45, index: 'ust10', spread: 135 },
    { id: 'xo', name: 'Crossover / secured', term: '7 to 10-yr', maxLev: 60, index: 'ust10', spread: 210 },
    { id: 'hy', name: 'High-yield or secured', term: '5 to 7-yr', maxLev: 999, index: 'ust10', spread: 340 },
  ],
  bank: { spread: 135 },     // bank term loan over SOFR
  pref: { rate: 11.0 },      // pref / JV equity target return
  levRefi: 50,               // at or below this leverage, the market refinances maturities routinely (%)
  levHigh: 65,               // above this, leverage alone marks a REIT as stretched (%)
};

function rwOverlap(y, start, end) {
  // share of calendar year y that falls between start and end
  const a = new Date(y, 0, 1), b = new Date(y + 1, 0, 1);
  const lo = Math.max(a, start), hi = Math.min(b, end);
  return hi > lo ? (hi - lo) / (b - a) : 0;
}
function rwMonthsAgo(iso) { const d = new Date(iso + 'T12:00:00'); return (RW_TODAY - d) / (30.44 * 864e5); }

function rwSize(r, A) {
  A = A || RW_DEFAULTS;
  const s = { flags: [] };
  const end = new Date(RW_TODAY); end.setMonth(end.getMonth() + A.windowMonths);
  const end12 = new Date(RW_TODAY); end12.setMonth(end12.getMonth() + 12);
  const lad = r.ladder || null;
  let due = 0, due12 = 0;
  if (lad) for (const [y, v] of Object.entries(lad)) {
    if (y === 'later') continue;
    due += v * rwOverlap(+y, RW_TODAY, end);
    due12 += v * rwOverlap(+y, RW_TODAY, end12);
  }
  s.due = due; s.due12 = due12;
  s.debt = r.debt || r.ladderTotal || 0;
  s.cash = r.cash || 0;
  s.revolver = r.revolverLeft ?? null;
  s.ocf = r.ocf ?? null; s.div = r.dividends ?? null; s.interest = r.interest ?? null;
  s.rcf = s.ocf != null && s.div != null ? s.ocf - s.div : null;          // retained cash flow, trailing 12 months
  s.rcfWin = s.rcf != null ? s.rcf * A.windowMonths / 12 : 0;
  s.selfFund = s.cash + Math.max(s.rcfWin, 0);
  s.need = Math.max(due - s.cash - s.rcfWin - (s.revolver || 0), 0);   // capital that has to come from outside
  s.needNoRev = Math.max(due - s.cash - s.rcfWin, 0);
  // leverage on book: debt over the larger of real estate at cost and total assets
  const base = Math.max(r.realEstate || 0, r.assets || 0) || null;
  s.lev = base ? s.debt / base : null;
  s.levBasis = base && base === r.realEstate ? 'real estate at cost' : 'total assets';
  s.rate = r.rate != null ? r.rate : (s.interest && s.debt ? s.interest / s.debt * 100 : null);
  s.rateEst = r.rate == null;
  s.divCover = s.ocf != null && s.div ? s.ocf / s.div : null;
  s.intCover = s.ocf != null && s.interest ? (s.ocf + s.interest) / s.interest : null;
  // book leverage overstates risk when cash flow covers interest 3.5× or more (towers, data centers): price those as investment grade
  s.strongCover = s.intCover != null && s.intCover >= 3.5 && (s.divCover == null || s.divCover >= 1);
  s.tier = s.strongCover ? A.tiers[0] : (A.tiers.find(t => (s.lev ?? 0.5) * 100 <= t.maxLev) || A.tiers[A.tiers.length - 1]);
  s.newRate = A.ust10 + s.tier.spread / 100;
  s.shockBps = s.rate != null ? Math.round((s.newRate - s.rate) * 100) : null;
  s.addedInterest = s.rate != null ? due * (s.newRate - s.rate) / 100 : null;
  s.dueShare = s.debt ? due / s.debt : null;
  s.coverage = due > 0 ? (s.cash + s.rcfWin + (s.revolver || 0)) / due : null;

  // outcome
  // book leverage alone doesn't mark a REIT stretched when cash flow covers interest 3× or more (towers, data centers)
  const strongCover = s.strongCover;
  const stretched = (s.divCover != null && s.divCover < 1) || (s.intCover != null && s.intCover < 1.75)
    || (s.lev != null && s.lev * 100 > A.levHigh && !(s.intCover != null && s.intCover >= 3));
  if (!lad || !s.debt) s.bucket = 'Insufficient data';
  else if (due <= s.selfFund) s.bucket = 'Self-funded';
  else if (s.revolver != null && s.need <= 0) s.bucket = 'Revolver covers it';
  else if (stretched) s.bucket = 'Stretched';
  else if ((s.lev ?? 1) * 100 <= A.levRefi || strongCover) s.bucket = 'Routine refinance';
  else s.bucket = 'Needs new capital';

  // flags (severity 3 = high)
  const F = (k, sev, t) => s.flags.push({ k, sev, t });
  if (s.divCover != null && s.divCover < 1) F('div', 3, `Dividends (${rwFm(s.div)}) exceed operating cash flow (${rwFm(s.ocf)}) over the last 12 months.`);
  else if (s.divCover != null && s.divCover < 1.15) F('div', 2, `Thin dividend coverage: operating cash flow is ${s.divCover.toFixed(2)}× dividends.`);
  if (s.lev != null && s.lev * 100 > A.levHigh) F('lev', s.strongCover ? 1 : 3, `Leverage of ${(s.lev * 100).toFixed(0)}% of ${s.levBasis} (book).`);
  else if (s.lev != null && s.lev * 100 > A.levRefi) F('lev', 2, `Leverage of ${(s.lev * 100).toFixed(0)}% of ${s.levBasis} (book).`);
  if (s.intCover != null && s.intCover < 2) F('int', s.intCover < 1.5 ? 3 : 2, `Interest coverage of ${s.intCover.toFixed(2)}× (operating cash flow plus interest, over interest).`);
  if (s.dueShare != null && s.due12 > 0.15 * s.debt) F('wall', 2, `${rwFm(s.due12)} (${Math.round(s.due12 / s.debt * 100)}% of debt) comes due in the next 12 months.`);
  if (s.shockBps != null && s.shockBps >= 150) F('shock', 2, `Maturing debt reprices about +${s.shockBps} bps at today's ${s.tier.name.toLowerCase()} rate.`);
  if (r.ladderCheck != null && r.ladderCheck < 0.9) F('partial', 1, `The 10-K schedule covers ${Math.round(r.ladderCheck * 100)}% of reported debt; the rest (usually the credit line or term loans) isn't broken out by year.`);
  if (s.revolver == null) F('rev', 1, 'Undrawn revolver capacity isn’t tagged in the filing data, so it isn’t counted as a source.');
  if (r.asOf && rwMonthsAgo(r.asOf) > 7) F('stale', 1, `Latest financials are as of ${r.asOf}.`);

  // capital-need score: size of what's due, how much must come from outside, and stress
  const lg = v => Math.max(0, Math.min(1, (Math.log10(Math.max(v, 1)) - Math.log10(5e7)) / (Math.log10(5e9) - Math.log10(5e7))));
  const sSize = lg(due);
  const sNeed = due > 0 ? Math.min(1, s.needNoRev / due) : 0;
  const parts = [];
  if (s.lev != null) parts.push(s.strongCover ? 0 : Math.max(0, Math.min(1, (s.lev - 0.30) / 0.40)));
  if (s.divCover != null) parts.push(Math.max(0, Math.min(1, (1.5 - s.divCover) / 0.6)));
  if (s.shockBps != null) parts.push(Math.max(0, Math.min(1, s.shockBps / 300)));
  const sStress = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
  s.score = s.bucket === 'Insufficient data' ? 0 : Math.round(100 * (0.35 * sSize + 0.35 * sNeed + 0.30 * sStress));
  return s;
}
function rwFm(v) { return v == null || !isFinite(v) ? '—' : Math.abs(v) >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : '$' + Math.round(v / 1e6) + 'M'; }
