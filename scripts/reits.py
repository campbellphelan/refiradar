"""REIT Runway: refresh the public-REIT capital needs dataset from SEC 10-K and 10-Q filings.

For each REIT in src/reit_universe.json this reads the XBRL instance of its latest 10-K and of any 10-Q filed since,
then pulls the debt maturity schedule, liquidity, cash flow and dividends. It runs only for REITs that have filed
since the last run. Writes data/reits.json (one record per REIT) and data/reit_filings.json (what was read).

Maturity schedules are the hard part. Companies tag them three ways, so each 10-K is tried in this order:
  1. the standard us-gaap maturity tags with no dimensions (one total per year)
  2. the same tags split by debt type (summed across types)
  3. the maturity table printed in the debt footnote, parsed from the HTML text block
Each candidate is checked against the company's reported total debt, and the closest one is kept, with its source.
"""
import gzip, html, json, math, re, sys
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA, SRC = ROOT / 'data', ROOT / 'src'

# ---------------------------------------------------------------- XBRL instance → facts
NS_PREFIX = (('fasb.org/us-gaap', 'us-gaap'), ('xbrl.sec.gov/dei', 'dei'), ('fasb.org/srt', 'srt'))


def _prefix(ns):
    for k, p in NS_PREFIX:
        if k in ns:
            return p
    return 'ext'


class Fact:
    __slots__ = ('p', 'n', 'dims', 'start', 'end', 'v', 'unit', 'dec')

    def __init__(self, p, n, dims, start, end, v, unit, dec):
        self.p, self.n, self.dims, self.start, self.end, self.v, self.unit, self.dec = p, n, dims, start, end, v, unit, dec

    @property
    def num(self):
        try:
            return float(self.v)
        except (TypeError, ValueError):
            return None

    @property
    def instant(self):
        return self.start is None


def parse_instance(xml_bytes):
    root = ET.fromstring(xml_bytes)
    ctx = {}
    for c in root.iter():
        if not isinstance(c.tag, str) or not c.tag.endswith('}context'):
            continue
        dims = tuple(sorted((m.get('dimension'), (m.text or '').strip()) for m in c.iter() if isinstance(m.tag, str) and m.tag.endswith('explicitMember')))
        typed = any(isinstance(m.tag, str) and m.tag.endswith('typedMember') for m in c.iter())
        if typed:
            dims = dims + (('typed', '1'),)
        st = en = None
        for m in c.iter():
            if not isinstance(m.tag, str):
                continue
            if m.tag.endswith('}instant'):
                en = m.text.strip()
            elif m.tag.endswith('}startDate'):
                st = m.text.strip()
            elif m.tag.endswith('}endDate'):
                en = m.text.strip()
        ctx[c.get('id')] = (dims, st, en)
    facts = []
    for el in root:
        cr = el.get('contextRef')
        if not cr or cr not in ctx or not isinstance(el.tag, str):
            continue
        ns, name = el.tag[1:].split('}')
        dims, st, en = ctx[cr]
        if el.get('{http://www.w3.org/2001/XMLSchema-instance}nil') == 'true':
            continue
        facts.append(Fact(_prefix(ns), name, dims, st, en, (el.text or '').strip(), el.get('unitRef'), el.get('decimals')))
    return facts


class Filing:
    """Lookups over one filing's facts."""

    def __init__(self, facts, meta):
        self.facts, self.meta = facts, meta
        self.by = {}
        for f in facts:
            self.by.setdefault(f.n, []).append(f)
        dpe = [f.v for f in self.by.get('DocumentPeriodEndDate', []) if not f.dims]
        self.period = meta.get('period') or (dpe[0] if dpe else None)
        # the balance sheet date is the most common instant among cash facts; fall back to the period end
        self.bs = self.period

    def inst(self, names, when=None, nodim=True):
        when = when or self.bs
        for n in names:
            for f in self.by.get(n, []):
                if f.instant and f.end == when and (not nodim or not f.dims) and f.num is not None:
                    return f.num, n
        if nodim:  # combined parent / operating partnership filings tag everything by legal entity
            for n in names:
                vals = [f.num for f in self.by.get(n, []) if f.instant and f.end == when and f.num is not None and f.dims
                        and all(d == 'dei:LegalEntityAxis' for d, _ in f.dims)]
                if vals:
                    return max(vals), n
        return None, None

    def dur(self, names, end=None, months=None, nodim=True):
        """Value for a duration ending on `end` whose length is about `months` months."""
        end = end or self.period
        for n in names:
            best = None
            pool = self.all_dur(n, nodim)
            for f in pool:
                if f.end != end:
                    continue
                m = _months(f.start, f.end)
                if months is None or abs(m - months) <= 1:
                    if best is None or abs(m - (months or m)) < abs(_months(best.start, best.end) - (months or m)):
                        best = f
            if best:
                return best.num, n, best.start
        return None, None, None

    def all_dur(self, name, nodim=True):
        out = [f for f in self.by.get(name, []) if not f.instant and (not nodim or not f.dims) and f.num is not None]
        if not out and nodim:
            out = [f for f in self.by.get(name, []) if not f.instant and f.num is not None and f.dims
                   and all(d == 'dei:LegalEntityAxis' for d, _ in f.dims)]
        return out


def _d(s):
    y, m, d = map(int, s[:10].split('-'))
    return date(y, m, d)


def _months(a, b):
    a, b = _d(a), _d(b)
    return (b.year - a.year) * 12 + (b.month - a.month) + (b.day - a.day + 1) / 30.4


# ---------------------------------------------------------------- maturity ladders
LTDM = 'LongTermDebtMaturitiesRepaymentsOfPrincipal'
STD_KEYS = [('RemainderOfFiscalYear', 0), ('InNextTwelveMonths', 1), ('InYearTwo', 2), ('InYearThree', 3), ('InYearFour', 4),
            ('InYearFive', 5), ('AfterYearFive', 6)]
DEBT_AXES = ('us-gaap:LongtermDebtTypeAxis', 'us-gaap:DebtInstrumentAxis', 'us-gaap:ShortTermDebtTypeAxis',
             'us-gaap:LineOfCreditFacilityAxis', 'us-gaap:CreditFacilityAxis', 'srt:ConsolidatedEntitiesAxis')


def ladder_from_tags(F, when):
    """Returns (no-dim ladder, dimension-summed ladder) as {slot: amount}; slot 0 = rest of this fiscal year."""
    nod, dims = {}, {}
    per_axis = {}
    for key, slot in STD_KEYS:
        for f in F.by.get(LTDM + key, []):
            if not f.instant or f.end != when or f.num is None:
                continue
            if not f.dims:
                nod[slot] = f.num
                continue
            axes = [d for d, _ in f.dims]
            if any(a == 'dei:LegalEntityAxis' for a in axes) or len(axes) != 1 or axes[0] not in DEBT_AXES:
                continue
            per_axis.setdefault(axes[0], {}).setdefault(f.dims[0][1], {})[slot] = f.num
    # use the axis with the most members; sum members (skip members that look like subtotals)
    if per_axis:
        ax = max(per_axis, key=lambda a: len(per_axis[a]))
        mem = per_axis[ax]
        for m, sl in mem.items():
            if re.search(r'Total|Consolidated', m, re.I) and len(mem) > 1:
                continue
            for s, v in sl.items():
                dims[s] = dims.get(s, 0) + v
    return nod, dims


class _Tables(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self._t, self._r, self._c, self._in = [], None, None, None, 0
        self.text = []

    def handle_starttag(self, tag, a):
        if tag == 'table':
            self._t = []
        elif tag == 'tr' and self._t is not None:
            self._r = []
        elif tag in ('td', 'th') and self._r is not None:
            self._c = []
            span = dict(a).get('colspan')
            self._span = int(span) if span and span.isdigit() else 1

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self._c is not None and self._r is not None:
            self._r.append(' '.join(''.join(self._c).split()))
            self._c = None
        elif tag == 'tr' and self._r is not None and self._t is not None:
            if any(x for x in self._r):
                self._t.append(self._r)
            self._r = None
        elif tag == 'table' and self._t is not None:
            self.tables.append(self._t)
            self._t = None

    def handle_data(self, d):
        d = d.replace('\u200b', ' ').replace('\ufeff', ' ')
        if self._c is not None:
            self._c.append(d)
        else:
            self.text.append(d)


NUM = re.compile(r'^\(?-?\$?\s*\(?([\d,]+(?:\.\d+)?)\)?%?$')


def _cellnum(s):
    s = s.replace('$', '').replace('—', '').replace('–', '').strip()
    if s in ('', '-', '—'):
        return None
    neg = s.startswith('(') and s.endswith(')')
    m = NUM.match(s)
    if not m:
        return None
    v = float(m.group(1).replace(',', ''))
    return -v if neg else v


def _merge_row(r):
    """Collapse '$', '(', ')' and '%' fragments that sit in their own cells."""
    out = []
    for c in r:
        if c in ('$', ')', '%', ')%') and out:
            if c.startswith(')') and out:
                out[-1] = out[-1] + ')'
            continue
        out.append(c)
    return out


def ladder_from_tables(F, fy_end):
    """Parse debt maturity tables out of the debt footnote text blocks. Returns one candidate per numeric column."""
    fy1 = _d(fy_end).year + (1 if _d(fy_end).month == 12 else 0)
    cands = []
    for f in F.facts:
        if not f.n.endswith('TextBlock') or not re.search(r'Debt|Maturit|Borrowing|Notes|Mortgage|LineOfCredit|CreditFacilit|Financing|Indebtedness', f.n):
            continue
        if re.search(r'Lease|Lessor|Lessee|Rent|Receivable|Investment|Derivative|Hedg|Swap|Fair|Interest(?!Bearing)|Securities', f.n):
            continue
        p = _Tables()
        try:
            p.feed(html.unescape(f.v) if '&lt;' in f.v[:200] else f.v)
        except Exception:  # noqa: BLE001
            continue
        before = ' '.join(p.text)[-4000:].lower()
        for t in p.tables:
            rows = [_merge_row(r) for r in t]
            yr_rows, total_row = {}, None
            hdr_rows = []
            for r in rows:
                lab = r[0].strip().lower() if r else ''
                lab = re.sub(r'\(\d\)|\*', '', lab).strip(' :')
                slot = None
                m = re.match(r'^(?:\d+\s+months\s+ending\s+.*?|remainder of |rest of |year ending |years ending |\(?\w+\s\d{1,2},?\s)?(20\d\d)(?:\s*\(.*\))?$', lab)
                if m:
                    slot = int(m.group(1)) - fy1 + 1
                elif lab.startswith(('thereafter', 'after', 'later years', 'beyond')) or re.match(r'^20\d\d\s*(and|&|-|through)\s*(thereafter|beyond|later|20\d\d)', lab):
                    slot = 6
                elif lab.startswith('total'):
                    nums = [x for x in (_cellnum(c) for c in r[1:]) if x is not None]
                    if nums and total_row is None and yr_rows:
                        total_row = nums
                    continue
                elif not yr_rows:
                    hdr_rows.append(' '.join(r))
                    continue
                if slot is None or slot < 0:
                    continue
                nums = [x for x in (_cellnum(c) for c in r[1:]) if x is not None]
                if not nums:
                    continue
                if slot >= 6:   # years past year five, and 'thereafter', all go to the last bucket
                    prev = yr_rows.get(6)
                    yr_rows[6] = nums if prev is None or len(prev) != len(nums) else [a + b for a, b in zip(prev, nums)]
                else:
                    yr_rows.setdefault(slot, nums)
            if len(yr_rows) < 4 or 6 not in yr_rows:
                continue
            hdr = ' | '.join(hdr_rows).lower()
            if re.search(r'lease|rent|receiv|tenant|ground', hdr) and not re.search(r'debt|principal|mortgage|notes', hdr):
                continue
            ncol = max(len(v) for v in yr_rows.values())
            scale = 1e6 if re.search(r'in millions|\(millions\)|\$ millions|millions of', before + hdr) else 1e3 if re.search(r'in thousands|\(thousands\)|000s|\$000|thousands of', before + hdr) else None
            for ci in range(ncol):
                lad = {sl: v[ci] for sl, v in yr_rows.items() if len(v) == ncol}
                if len(lad) < 4 or 6 not in lad:
                    continue
                tot = total_row[ci] if total_row and len(total_row) == ncol else None
                cands.append({'lad': lad, 'scale': scale, 'block': f.n, 'col': ci, 'ncol': ncol, 'hdr': hdr[:200], 'total': tot,
                              'selfsum': bool(tot) and abs(sum(lad.values()) - tot) <= max(2, 0.006 * abs(tot)), 'kind': 'table'})
        cands += _instrument_tables(p.tables, before, f.n, fy1)
    return cands


DATE_RX = re.compile(r'(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+(20\d\d))|(?:\d{1,2}/\d{1,2}/(20\d\d|\d\d))'
                     r'|(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[\s-]+(20\d\d|\d\d))$|^(20\d\d)$', re.I)


def _instrument_tables(tables, before, block, fy1):
    """Tables that list each loan or bond with its own maturity date: bucket principal by maturity year."""
    out = []
    for t in tables:
        rows = [_merge_row(r) for r in t]
        head = ' '.join(' '.join(r) for r in rows[:3]).lower()
        if 'matur' not in head or not re.search(r'principal|amount|balance|outstanding|face', head):
            continue
        lad, n = {}, 0
        for r in rows[1:]:
            lab = (r[0] if r else '').lower()
            if lab.startswith(('total', 'less', 'unamortized', 'deferred', 'net', 'premium', 'discount', 'fair value')):
                continue
            yr, amt = None, None
            for c in r[1:]:
                if yr is None:
                    m = DATE_RX.search(c.strip())
                    if m:
                        g = next(x for x in m.groups() if x)
                        yr = int(g) if len(g) == 4 else 2000 + int(g)
                        continue
                if amt is None and '%' not in c and not re.search(r'sofr|libor|\+', c.lower()):
                    v = _cellnum(c)
                    if v is not None and v >= 1 and not (1990 <= v <= 2100 and float(v).is_integer() and len(c.strip()) == 4):
                        amt = v
            if yr and amt:
                sl = min(max(yr - fy1 + 1, 0), 6)
                lad[sl] = lad.get(sl, 0) + amt
                n += 1
        if n >= 3 and len(lad) >= 2:
            scale = 1e6 if re.search(r'in millions|millions of', before + head) else 1e3 if re.search(r'in thousands|thousands of', before + head) else None
            out.append({'lad': lad, 'scale': scale, 'block': block, 'col': 0, 'ncol': 1, 'hdr': head[:200], 'total': None, 'selfsum': False,
                        'kind': 'instruments', 'n': n})
    return out


def _tot(lad):
    return sum(v for v in lad.values() if v)


# ---------------------------------------------------------------- per-REIT extraction
TOTAL_DEBT = ['LongTermDebt', 'DebtInstrumentCarryingAmount', 'DebtLongtermAndShorttermCombinedAmount', 'LongTermDebtAndCapitalLeaseObligations',
              'DebtAndCapitalLeaseObligations', 'LongTermDebtNoncurrent']
PARTS = [('SecuredDebt', 'MortgageLoansOnRealEstateCommercialAndConsumerNet', 'NotesPayableSecured', 'SecuredLongTermDebt'),
         ('UnsecuredDebt', 'SeniorNotes', 'UnsecuredLongTermDebt', 'SeniorLongTermNotes', 'NotesPayable'),
         ('LineOfCredit', 'LongTermLineOfCredit', 'LinesOfCreditCurrent'),
         ('UnsecuredTermLoan', 'LoansPayable', 'TermLoan', 'OtherLongTermDebt')]


def total_debt(F, when):
    best = None
    for n in TOTAL_DEBT:
        v, _ = F.inst([n], when)
        if v and v > 0:
            best = max(best or 0, v)
    parts = 0
    for group in PARTS:
        for n in group:
            v, _ = F.inst([n], when)
            if v and v > 0:
                parts += v
                break
    return best, (parts or None)


CASH = ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents', 'Cash',
        'CashAndDueFromBanks']
OCF = ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations']
DIV_COMMON = ['PaymentsOfDividendsCommonStock', 'PaymentsOfDividends', 'PaymentsOfOrdinaryDividendsCommonStockAndPreferredStock',
              'PaymentsOfOrdinaryDividends', 'PaymentsOfOrdinaryDividendsCommonStockAndShareBasedPaymentArrangement',
              'PaymentsOfCapitalDistribution', 'DistributionMadeToLimitedPartnerCashDistributionsPaid']
DIV_PREF = ['PaymentsOfDividendsPreferredStockAndPreferenceStock']
DIV_NCI = ['PaymentsOfDividendsMinorityInterest', 'PaymentsToMinorityShareholders']
INTEREST = ['InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt', 'InterestAndDebtExpense', 'InterestExpenseOperating',
            'InterestPaidNet', 'InterestPaid']
RATE = ['LongTermDebtWeightedAverageInterestRate', 'DebtWeightedAverageInterestRate', 'LongtermDebtWeightedAverageInterestRate',
        'DebtInstrumentInterestRateEffectivePercentage', 'DebtInstrumentInterestRateStatedPercentage']
REAL_ESTATE = ['RealEstateInvestmentPropertyAtCost', 'RealEstateGrossAtCarryingValue', 'RealEstateInvestmentPropertyNet',
               'PropertyPlantAndEquipmentGross', 'PropertyPlantAndEquipmentNet']
REVOLVER_LEFT = ['LineOfCreditFacilityRemainingBorrowingCapacity', 'LineOfCreditFacilityCurrentBorrowingCapacity']
REVOLVER_MAX = ['LineOfCreditFacilityMaximumBorrowingCapacity']


def ttm(K, Q, names):
    """Trailing twelve months: the 10-K year, plus this year's 10-Q year-to-date, less last year's."""
    fy, n, _ = K.dur(names, K.period, 12)
    if fy is None:
        return None, None, None
    if Q is None or Q.period <= K.period:
        return fy, n, K.period
    f = Q.all_dur(n)
    cur = [x for x in f if x.end == Q.period and _months(x.start, x.end) < 11.5]
    if not cur:
        return fy, n, K.period
    cur = max(cur, key=lambda x: _months(x.start, x.end))
    m = round(_months(cur.start, cur.end))
    py_end = (_d(Q.period) - timedelta(days=365)).isoformat()
    prior = [x for x in f if abs((_d(x.end) - _d(py_end)).days) <= 6 and abs(_months(x.start, x.end) - m) <= 1]
    if not prior:
        return fy, n, K.period
    return fy + cur.num - prior[0].num, n, Q.period


def best_inst(F, names, when):
    v, n = F.inst(names, when)
    if v is not None:
        return v, n
    # fall back to a single dimensional value on a revolver member (main facility)
    for nm in names:
        vals = [f.num for f in F.by.get(nm, []) if f.instant and f.end == when and f.num is not None and len(f.dims) == 1
                and re.search(r'Revolv|LineOfCredit|CreditFacilit|Unsecured', f.dims[0][1])]
        if vals:
            return max(vals), nm + ' (by facility)'
    return None, None


NOT_REVOLVER = re.compile(r'Term|Mortgage|Construction|Bridge|Delayed|NotesMember|NoteMember|Bond|(?<!Un)Secured(?!Revolv)|Swap|Letter|'
                          r'JointVenture|VariableInterest|FairValue|Carrying|Estimate|CommercialPaper|Prior', re.I)


def _facility_key(f):
    """Member names other than the legal entity, or None when the fact is about something other than a revolver."""
    mem = [m for d, m in f.dims if d != 'dei:LegalEntityAxis']
    if any(NOT_REVOLVER.search(m) for m in mem):
        return None
    return '|'.join(sorted(mem))


def revolver_left(F, when):
    """Undrawn revolver capacity: tagged remaining capacity, else facility size less amount drawn."""
    def pick(names):
        best = {}
        for n in names:
            for f in F.by.get(n, []):
                if not f.instant or f.end != when or f.num is None:
                    continue
                k = _facility_key(f)
                if k is None:
                    continue
                best[k] = max(best.get(k, 0), f.num)
        return best
    rem = pick(REVOLVER_LEFT + ['DebtInstrumentUnusedBorrowingCapacityAmount'])
    if rem:
        return (rem[''], 'tagged') if '' in rem else (max(rem.values()), 'tagged by facility')
    cap = pick(REVOLVER_MAX)
    drawn = pick(['LineOfCredit', 'LongTermLineOfCredit', 'LinesOfCreditCurrent'])
    if cap:
        m = '' if '' in cap else max(cap, key=cap.get)
        return max(cap[m] - drawn.get(m, drawn.get('', 0)), 0), 'facility size less drawn'
    return None, None


def extract(meta, K, Q, override=None):
    """Build one REIT record from its 10-K (K) and latest 10-Q (Q, may be None)."""
    fy_end = K.period
    L = Q if (Q is not None and Q.period and Q.period > fy_end) else K
    rec = {'fyEnd': fy_end, 'asOf': L.period, 'filed10K': meta['k']['filed'], 'acc10K': meta['k']['acc'],
           'doc10K': meta['k']['doc']}
    if L is Q:
        rec.update({'filed10Q': meta['q']['filed'], 'acc10Q': meta['q']['acc'], 'doc10Q': meta['q']['doc']})

    # total debt at the 10-K date and today
    td_k, parts_k = total_debt(K, fy_end)
    td_l, parts_l = total_debt(L, L.period)
    rec['debtRef10K'] = max(td_k or 0, parts_k or 0) or None
    rec['debt'] = max(td_l or 0, parts_l or 0) or rec['debtRef10K']

    # ladder candidates
    cands = []
    for F, when, form in ((K, fy_end, '10-K'),):  # 10-Q maturity tags are labelled inconsistently, so the schedule comes from the 10-K
        nod, dimsum = ladder_from_tags(F, when)
        if len(nod) >= 4:
            cands.append({'lad': nod, 'src': 'XBRL maturity tags', 'form': form, 'when': when})
        if len(dimsum) >= 4:
            cands.append({'lad': dimsum, 'src': 'XBRL maturity tags by debt type', 'form': form, 'when': when})
    liab, _ = K.inst(['Liabilities'], fy_end)
    # a total-debt tag is only trusted when it isn't smaller than the sum of the debt lines
    tagref = td_k if td_k and (not parts_k or td_k >= 0.9 * parts_k) else None
    lower = max(td_k or 0, parts_k or 0) or None
    for c in ladder_from_tables(K, fy_end):
        raw = _tot(c['lad'])
        scales = [c['scale']] if c['scale'] else [1e3, 1e6, 1]
        for sc in scales:
            cand = {'lad': {sl: v * sc for sl, v in c['lad'].items()}, 'form': '10-K', 'when': fy_end, 'block': c['block'],
                    'selfsum': c['selfsum'], 'kind': c['kind'],
                    'src': 'Maturity table in the 10-K debt note' if c['kind'] == 'table' else 'Loan and bond list in the 10-K debt note'}
            cands.append(cand)

    R = tagref or lower

    def valid(c):
        t = _tot(c['lad'])
        if t <= 0 or (liab and t > 1.02 * liab):
            return False
        if c['src'] == 'XBRL maturity tags':        # the company's own tagged schedule
            return not R or (t >= 0.5 * R and (6 in c['lad'] or t >= 0.85 * R))
        if R and 0.65 * R <= t <= 1.35 * R:
            return True
        return bool(c.get('selfsum')) and bool(liab) and t <= 0.95 * liab and (not R or t >= 0.65 * R)

    ref = tagref or lower

    def fit(c):
        t = _tot(c['lad'])
        return abs(math.log(t / ref)) if ref and t > 0 else 0.5

    def rank(c):
        strong = 0 if c['src'] == 'XBRL maturity tags' else 1 if c.get('selfsum') else 2
        return (strong, round(min(fit(c), 0.4), 1), 0 if c.get('kind') != 'instruments' else 1, fit(c))
    good = sorted([c for c in cands if valid(c)], key=rank)
    choice = good[0] if good else None
    if override and override.get('acc10K') == meta['k']['acc']:
        # read by hand from this same 10-K, because no table in it parses cleanly; see src/reit_overrides.json
        choice = {'lad': None, 'years': override['ladder'], 'src': 'Read from the 10-K debt note', 'note': override['src'],
                  'form': '10-K', 'when': fy_end}
    ref = ref or ((_tot(choice['lad']) if choice['lad'] else sum(choice['years'].values())) if choice else None)
    rec['debtRef10K'] = ref
    if choice:
        w = _d(choice['when'])
        y0 = w.year + (1 if w.month == 12 else 0)   # first year after the 10-K date (Dec year ends)
        yrs = dict(choice.get('years') or {})
        for sl, v in (choice['lad'] or {}).items():
            if v is None:
                continue
            if sl == 6:
                y = 'later'
            elif choice['form'] == '10-Q':
                y = w.year + sl            # slot 0 = rest of this year, slot 1 = next year, ...
            else:
                y = max(y0 + sl - 1, y0)   # slot 1 = first year after the 10-K date
            yrs[str(y)] = yrs.get(str(y), 0) + round(v)
        rec['ladder'] = yrs
        rec['ladderSrc'] = choice['src']
        rec['ladderForm'] = choice['form']
        rec['ladderAsOf'] = choice['when']
        lt = sum(yrs.values())
        rec['ladderCheck'] = round(lt / ref, 3) if ref else None
        rec['ladderTotal'] = round(lt)
        if choice.get('note'):
            rec['ladderNote'] = choice['note']

    liab_l, _ = L.inst(['Liabilities'], L.period)
    if rec.get('ladderTotal') and (not rec['debt'] or rec['debt'] < 0.8 * rec['ladderTotal']):
        rec['debt'], rec['debtEst'] = rec['ladderTotal'], True   # debt tags missing or partial: use the 10-K schedule
    if rec['debt'] and liab_l and rec['debt'] > liab_l:
        rec['debt'] = td_l or td_k or rec.get('ladderTotal')
    # liquidity
    cash, cn = L.inst(CASH, L.period)
    rec['cash'] = cash
    left, ln = revolver_left(L, L.period)
    rec['revolverLeft'] = left
    rec['revolverSrc'] = ln

    # cash flow (trailing twelve months)
    ocf, _, _ = ttm(K, Q if L is Q else None, OCF)
    divc, dn = None, None
    extra = [n for n in K.by if re.match(r'^(Payments?Of(Ordinary)?(Dividends|Distributions)|(Cash)?(Dividends|Distributions)Paid)', n)
             and not re.search(r'Minority|Noncontrolling|Affiliate|PerShare|Payable|Declared|ToRelated|Subsidiar', n)
             and not (('Preferred' in n or 'Preference' in n) and 'Common' not in n)]
    for nm in DIV_COMMON + [n for n in extra if n not in DIV_COMMON]:   # the largest tag is the all-in common dividend
        v, n, _ = ttm(K, Q if L is Q else None, [nm])
        if v is not None and (divc is None or v > divc):
            divc, dn = v, n
    divp, _, _ = ttm(K, Q if L is Q else None, DIV_PREF) if dn in ('PaymentsOfDividendsCommonStock',) else (None, None, None)
    divn, _, _ = ttm(K, Q if L is Q else None, DIV_NCI)
    rec['ocf'] = ocf
    rec['dividends'] = abs(divc or 0) + abs(divp or 0) + abs(divn or 0) if divc is not None else None
    intr, iname, _ = ttm(K, Q if L is Q else None, INTEREST)
    rec['interest'] = intr
    rate, _ = L.inst(RATE, L.period)
    if rate is None:
        rate, _ = K.inst(RATE, fy_end)
    rec['rate'] = round(rate * 100, 3) if rate is not None and rate < 1 else rate
    re_, _ = L.inst(REAL_ESTATE, L.period)
    rec['realEstate'] = re_
    assets, _ = L.inst(['Assets'], L.period)
    rec['assets'] = assets
    for k, v in list(rec.items()):
        if isinstance(v, float) and k not in ('ladderCheck', 'rate'):
            rec[k] = round(v)
    return rec


OVERRIDES = json.loads((SRC / 'reit_overrides.json').read_text()) if (SRC / 'reit_overrides.json').exists() else {}


# ---------------------------------------------------------------- SEC refresh (runs in the daily GitHub job)
def latest_filings(cik, get):
    s = json.loads(get(f'https://data.sec.gov/submissions/CIK{int(cik):010d}.json'))
    r = s['filings']['recent']
    k = q = None
    for i, form in enumerate(r['form']):
        o = {'form': form, 'acc': r['accessionNumber'][i], 'doc': r['primaryDocument'][i], 'filed': r['filingDate'][i],
             'period': r['reportDate'][i]}
        if k is None and form == '10-K':
            k = o
        if q is None and form == '10-Q':
            q = o
        if k and q:
            break
    if q and k and q['filed'] < k['filed']:
        q = None
    return {'k': k, 'q': q}


def instance_xml(cik, acc, get):
    base = f'https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc.replace("-", "")}'
    idx = json.loads(get(base + '/index.json'))
    names = [i['name'] for i in idx['directory']['item']]
    x = next((n for n in names if n.endswith('_htm.xml')), None)
    return (x, get(base + '/' + x)) if x else (None, None)


def refresh(force=False):
    """Re-read every REIT that has filed a 10-K or 10-Q since the last run. Returns True when data/reits.json changed."""
    import sec_loans  # same SEC user agent and polite request pacing as the loan refresh
    if not sec_loans.ua():
        print('SEC_USER_AGENT is not set (needs a name and email); skipping the REIT refresh.')
        return False
    universe = json.loads((SRC / 'reit_universe.json').read_text())
    state_f, recs_f = DATA / 'reit_filings.json', DATA / 'reits.json'
    state = json.loads(state_f.read_text()) if state_f.exists() else {}
    recs = {r['ticker']: r for r in json.loads(recs_f.read_text())} if recs_f.exists() else {}
    changed = 0
    for u in universe:
        t = u['ticker']
        try:
            fl = latest_filings(u['cik'], sec_loans.get)
        except Exception as e:  # noqa: BLE001
            print(t, 'could not check filings:', e)
            continue
        old = state.get(t, {})
        same = (fl['k'] or {}).get('acc') == (old.get('k') or {}).get('acc') and (fl['q'] or {}).get('acc') == (old.get('q') or {}).get('acc')
        if same and not force and t in recs:
            recs[t].update({k: v for k, v in u.items()})
            continue
        if not fl['k']:
            recs[t] = {**u, 'error': 'no 10-K on file'}
            state[t] = fl
            continue
        try:
            _, kx = instance_xml(u['cik'], fl['k']['acc'], sec_loans.get)
            K = Filing(parse_instance(kx), fl['k'])
            Q = None
            if fl['q']:
                _, qx = instance_xml(u['cik'], fl['q']['acc'], sec_loans.get)
                Q = Filing(parse_instance(qx), fl['q']) if qx else None
            recs[t] = {**u, **extract(fl, K, Q, OVERRIDES.get(t))}
            state[t] = fl
            changed += 1
            print(f"{t}: 10-K {fl['k']['period']}" + (f", 10-Q {fl['q']['period']}" if fl['q'] else '') + f" -> {recs[t].get('ladderSrc') or 'no maturity schedule'}")
        except Exception as e:  # noqa: BLE001
            print(t, 'could not read filings; keeping the previous record:', e)
    keep = {u['ticker'] for u in universe}
    out = [recs[t] for t in sorted(recs) if t in keep]
    recs_f.write_text(json.dumps(out, separators=(',', ':')))
    state_f.write_text(json.dumps(state, indent=0))
    print(f'reits.json: {len(out)} REITs, {changed} re-read from new filings')
    return changed > 0


def build_from_cache(cache_dir):
    """Development path: build every record from a folder of <TICKER>_k.xml / _q.xml files and meta.json."""
    cache = Path(cache_dir)
    meta = json.loads((cache / 'meta.json').read_text())
    out = []
    for u in meta['universe']:
        t = u['ticker']
        m = meta['meta'].get(t) or {}
        kf, qf = cache / f'{t}_k.xml', cache / f'{t}_q.xml'
        if not m.get('k') or not kf.exists():
            out.append({**u, 'error': 'no 10-K XBRL'})
            continue
        K = Filing(parse_instance(kf.read_bytes()), m['k'])
        Q = Filing(parse_instance(qf.read_bytes()), m['q']) if qf.exists() and m.get('q') else None
        try:
            out.append({**u, **extract(m, K, Q, OVERRIDES.get(t))})
        except Exception as e:  # noqa: BLE001
            out.append({**u, 'error': repr(e)})
    return out


if __name__ == '__main__':
    if len(sys.argv) == 3:   # development: python scripts/reits.py <cache dir> <out.json>
        json.dump(build_from_cache(sys.argv[1]), open(sys.argv[2], 'w'), indent=0)
    else:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        refresh(force='--force' in sys.argv)
