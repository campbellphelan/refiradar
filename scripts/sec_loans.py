"""Refresh the CMBS loan dataset from SEC Form ABS-EE (Exhibit 102) filings.

Runs only when at least one trust has filed a new monthly tape since the last run.
Writes data/loans.json and data/deals.json.
"""
import json, os, re, time, math
import xml.etree.ElementTree as ET
from pathlib import Path
from datetime import date
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
WINDOW_END = '2027-12-31'   # loans maturing on or before this date are kept

TY = {'MF': 'Multifamily', 'RT': 'Retail', 'OF': 'Office', 'LO': 'Hotel', 'IN': 'Industrial', 'MU': 'Mixed use',
      'SS': 'Self storage', 'MH': 'Manufactured housing', 'CH': 'Co-op housing', 'HC': 'Healthcare', 'WH': 'Industrial',
      'OT': 'Other', '98': 'Other', '': 'Portfolio / other'}
STATES = {'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut',
          'DE': 'Delaware', 'DC': 'District of Columbia', 'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois',
          'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
          'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi', 'MO': 'Missouri', 'MT': 'Montana',
          'NE': 'Nebraska', 'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
          'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania',
          'RI': 'Rhode Island', 'SC': 'South Carolina', 'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
          'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming',
          'PR': 'Puerto Rico'}
CT_COUNTIES = {'fairfield': 'Bridgeport-Stamford-Danbury, CT', 'hartford': 'Hartford-West Hartford-East Hartford, CT',
               'middlesex': 'Hartford-West Hartford-East Hartford, CT', 'tolland': 'Hartford-West Hartford-East Hartford, CT',
               'new haven': 'New Haven, CT', 'new london': 'Norwich-New London-Willimantic, CT',
               'windham': 'Norwich-New London-Willimantic, CT', 'litchfield': 'Torrington, CT (micro)'}


# ---------------------------------------------------------------- SEC access
def ua():
    v = os.environ.get('SEC_USER_AGENT', '').strip()
    return v if '@' in v else None


def get(url, tries=5):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': ua(), 'Accept-Encoding': 'identity'})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
            time.sleep(0.25)  # stay well under SEC's 10 requests/second limit
            return body
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))


def latest_absee(cik):
    j = json.loads(get(f'https://data.sec.gov/submissions/CIK{int(cik):010d}.json'))
    r = j['filings']['recent']
    for i, form in enumerate(r['form']):
        if form == 'ABS-EE':
            acc = r['accessionNumber'][i]
            return {'accession': acc, 'filed': r['filingDate'][i],
                    'base': f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc.replace('-', '')}/"}
    return None


def ex102_url(base):
    idx = json.loads(get(base + 'index.json'))
    names = [it['name'] for it in idx['directory']['item']]
    x = next((n for n in names if re.search(r'102.*\.xml$', n, re.I)), None)
    return base + x if x else None


# ---------------------------------------------------------------- parsing
def _ln(tag):
    return tag.rsplit('}', 1)[-1]


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _date(s):
    m = re.match(r'(\d{2})-(\d{2})-(\d{4})', s or '')
    return f'{m.group(3)}-{m.group(1)}-{m.group(2)}' if m else None


def _months(start, end):
    a, b = _date(start), _date(end)
    if not a or not b:
        return None
    da, db = date.fromisoformat(a), date.fromisoformat(b)
    m = round(((db - da).days + 1) / 30.44)
    return m if m > 0 else None


def parse_ex102(xml_bytes, deal, src, zipmap=None):
    """Returns loans with a balance. Property locations from every asset (portfolio loans list their
    properties as zero-balance sub-assets) are collected into zipmap[(deal, base asset number)]."""
    root = ET.fromstring(xml_bytes)
    rows = []
    if zipmap is None:
        zipmap = {}
    for a in root.iter():
        if _ln(a.tag) != 'assets':
            continue
        o, props = {}, []
        for ch in a:
            t = _ln(ch.tag)
            if t == 'property':
                props.append({_ln(c.tag): (c.text or '').strip() for c in ch})
            else:
                o[t] = (ch.text or '').strip()
        base = (re.match(r'\d+', o.get('assetNumber', '')) or [o.get('assetNumber', '')])[0]
        zipmap.setdefault((deal, base), set()).update(
            (q.get('propertyZip', ''), q.get('propertyState', ''), q.get('propertyCity', '')) for q in props)
        bal = _f(o.get('reportPeriodEndActualBalanceAmount')) or _f(o.get('reportPeriodEndScheduledLoanBalanceAmount')) or 0
        if bal <= 0:
            continue
        p = props[0] if props else {}
        dcodes = [q.get('DefeasedStatusCode', '') for q in props]
        dflag = 'F' if dcodes and all(c == 'F' for c in dcodes) else ('P' if any(c in ('F', 'X') for c in dcodes) else 'N')

        def s(field):
            vals = [_f(q.get(field)) for q in props]
            vals = [v for v in vals if v is not None]
            return sum(vals) if vals else None

        name = (p.get('propertyName', '') or '')[:40] + (f' +{len(props) - 1}' if len(props) > 1 else '')
        rows.append(dict(
            deal=deal, src=src, asset=o.get('assetNumber', ''), name=name.strip(), city=p.get('propertyCity', ''), st=p.get('propertyState', ''),
            type=p.get('propertyTypeCode', ''), units=_f(p.get('unitsBedsRoomsNumber')), sf=_f(p.get('netRentableSquareFeetNumber')),
            yb=_f(p.get('yearBuiltNumber')), orig=_date(o.get('originationDate')), mat=_date(o.get('maturityDate')),
            rate=(_f(o.get('reportPeriodInterestRatePercentage')) or 0) * 100, io=o.get('interestOnlyIndicator') == 'true',
            amort=_f(o.get('originalAmortizationTermNumber')), ioterm=_f(o.get('originalInterestOnlyTermNumber')),
            bal=bal, pi_mo=_f(o.get('periodicPrincipalAndInterestPaymentSecuritizationAmount')) or 0,
            pay=o.get('paymentStatusLoanCode', ''), ss_xfer=_date(o.get('mostRecentSpecialServicerTransferDate')),
            ms_return=_date(o.get('mostRecentMasterServicerReturnDate')), mod=o.get('modifiedIndicator') == 'true',
            occ_sec=_f(p.get('physicalOccupancySecuritizationPercentage')), occ_rec=_f(p.get('mostRecentPhysicalOccupancyPercentage')),
            noi_sec=s('netOperatingIncomeSecuritizationAmount'), noi_rec=s('mostRecentNetOperatingIncomeAmount'),
            ncf_sec=s('netCashFlowFlowSecuritizationAmount'), ncf_rec=s('mostRecentNetCashFlowAmount'), ds_rec=s('mostRecentDebtServiceAmount'),
            dscr_sec=_f(p.get('debtServiceCoverageNetCashFlowSecuritizationPercentage')),
            dscr_rec=_f(p.get('mostRecentDebtServiceCoverageNetCashFlowpercentage')),
            val_sec=s('valuationSecuritizationAmount'), fin_end=_date(p.get('mostRecentFinancialsEndDate')),
            fin_months=_months(p.get('mostRecentFinancialsStartDate'), p.get('mostRecentFinancialsEndDate')),
            top_tenant=p.get('largestTenant', ''), top_exp=_date(p.get('leaseExpirationLargestTenantDate')), top_sf=_f(p.get('squareFeetLargestTenantNumber')),
            defc=dflag, nprops=len(props), originator=(o.get('originatorName', '') or '')[:20], servicer=(o.get('primaryServicerName', '') or '')[:20],
            zips=[(q.get('propertyZip', ''), q.get('propertyState', ''), q.get('propertyCity', '')) for q in props],
        ))
    return rows


# ---------------------------------------------------------------- MSA lookup
class MsaLookup:
    def __init__(self):
        import csv, zipcodes  # noqa: F401  (zipcodes is installed by the workflow)
        self.zipcodes = zipcodes
        self.cb, self.kind = {}, {}
        with open(DATA / 'cbsa_county.csv') as f:
            for r in csv.DictReader(f):
                k = r['county'].lower().strip() + '|' + r['state']
                self.cb[k], self.kind[k] = r['cbsa'], r['kind']

    def county(self, z, st, city):
        z = (z or '').strip()[:5]
        r = []
        if len(z) == 5 and z.isdigit():
            try:
                r = self.zipcodes.matching(z)
            except Exception:  # noqa: BLE001
                r = []
        if not r and city and st:
            try:
                r = self.zipcodes.filter_by(city=city.title(), state=st)
            except Exception:  # noqa: BLE001
                r = []
        return (r[0]['county'], r[0]['state']) if r else (None, None)

    def msa(self, z, st, city):
        cn, s = self.county(z, st, city)
        if not cn:
            return None
        k = cn.lower().strip() + '|' + STATES.get(s, '')
        if k in self.cb:
            return self.cb[k] if self.kind[k].startswith('Metro') else self.cb[k] + ' (micro)'
        if s == 'CT':
            return CT_COUNTIES.get(cn.lower().replace(' county', '').strip(), 'Non-metro CT')
        return 'Non-metro ' + s


# ---------------------------------------------------------------- cleaning (same rules as the original build)
def tc(s):
    return s.title().replace("'S ", "'s ") if s and s.isupper() else s


def clean(rows, zipmap):
    look = MsaLookup()
    cache = {}

    def msa_of(z):
        if z not in cache:
            cache[z] = look.msa(*z)
        return cache[z]
    for r in rows:
        fac = 12 / r['fin_months'] if r['fin_months'] and r['fin_months'] < 11 else 1.0
        for k in ('noi_rec', 'ncf_rec', 'ds_rec'):
            if r[k] is not None:
                r[k] *= fac
        for k in ('occ_sec', 'occ_rec'):
            if r[k] is not None and r[k] > 1.5:
                r[k] /= 100
        base = (re.match(r'\d+', r['asset']) or [r['asset']])[0]
        r['msas'] = sorted({m for z in zipmap.get((r['deal'], base), set()) | set(r['zips']) for m in [msa_of(z)] if m})
    rows = [r for r in rows if r['defc'] != 'F' and r['type'] != 'SE']

    # merge split notes (1A, 1B...) into one loan per deal
    groups = {}
    for r in rows:
        base = (re.match(r'\d+', r['asset']) or [r['asset']])[0]
        groups.setdefault((r['deal'], base), []).append(r)
    merged = []
    for (_, _), g in groups.items():
        has = [x for x in g if x['noi_rec'] is not None or (x['name'] not in ('', 'NA'))]
        main = dict(has[0] if has else g[0])
        main['bal'] = sum(x['bal'] for x in g)
        main['pi_mo'] = sum(x['pi_mo'] for x in g)
        main['msas'] = sorted({m for x in g for m in x['msas']})
        merged.append(main)

    # merge pari passu pieces held by several of the tracked trusts
    by = {}
    for r in merged:
        by.setdefault(r['name'].upper().strip() + '|' + r['city'].upper().strip() + '|' + (r['mat'] or ''), []).append(r)
    loans = []
    for g in by.values():
        withnoi = [x for x in g if x['noi_rec'] is not None]
        r = dict(max(withnoi, key=lambda x: x['noi_rec']) if withnoi else g[0])
        r['trust_bal'] = sum(x['bal'] for x in g)
        r['trust_pi'] = sum(x['pi_mo'] for x in g)
        r['deals'] = [x['deal'] for x in g]
        r['srcs'] = [x['src'] for x in g]
        r['msas'] = sorted({m for x in g for m in x['msas']})
        b, ds, rate = r['trust_bal'], r['ds_rec'], r['rate'] / 100
        w, est = b, False
        if ds and ds > 0 and b:
            if r['io'] and rate > 0:
                w = ds / rate
            elif r['trust_pi'] > 0:
                w = b * ds / (r['trust_pi'] * 12)
            if w >= b * 1.08:
                est = True
            else:
                w = b
        r['whole'], r['whole_est'] = w, est
        loans.append(r)

    out = []
    for r in loans:
        if not r['mat'] or r['mat'] > WINDOW_END:
            continue
        ms = r['msas']
        msa = 'Unknown' if not ms else (ms[0] if len(ms) == 1 else f'Multiple MSAs ({len(ms)})')
        rd = lambda v, d=0: None if v is None or (isinstance(v, float) and math.isnan(v)) else round(v, d) if d else round(v)
        out.append(dict(
            name=tc(r['name']), city=tc(r['city']), st=r['st'], msa=msa, type=TY.get(r['type'], 'Other'),
            units=rd(r['units']), sf=rd(r['sf']), yb=rd(r['yb']), orig=r['orig'], mat=r['mat'], rate=round(r['rate'], 3),
            io=int(r['io']), amort=rd(r['amort']), ioterm=rd(r['ioterm']), trustBal=rd(r['trust_bal']), wholeBal=rd(r['whole']),
            wholeEst=r['whole_est'], struct='', pay=r['pay'], ssXfer=r['ss_xfer'], msReturn=r['ms_return'], mod=int(r['mod']),
            occSec=rd(r['occ_sec'], 3), occRec=rd(r['occ_rec'], 3), noiSec=rd(r['noi_sec']), noiRec=rd(r['noi_rec']),
            ncfSec=rd(r['ncf_sec']), ncfRec=rd(r['ncf_rec']), dsRec=rd(r['ds_rec']), dscrSec=rd(r['dscr_sec'], 2),
            dscrRec=rd(r['dscr_rec'], 2), valSec=rd(r['val_sec']), valRec=None, valRecDate=None, finEnd=r['fin_end'],
            finMonths=r['fin_months'], topTenant=tc(r['top_tenant']), topExp=r['top_exp'], topSf=rd(r['top_sf']),
            partialDef=r['defc'] == 'P', nprops=r['nprops'], originator=r['originator'], servicer=r['servicer'],
            deals=r['deals'], srcs=r['srcs']))

    # a pari passu loan can appear under slightly different names in different trusts
    seen, final = {}, []
    for l in out:
        k = (l['mat'], l['type'], round((l['wholeBal'] or 0) / 1e6))
        if l['wholeEst'] and k in seen:
            m = seen[k]
            m['deals'] += [d for d in l['deals'] if d not in m['deals']]
            m['srcs'] += [x for x in l['srcs'] if x not in m['srcs']]
            m['trustBal'] += l['trustBal']
            continue
        seen[k] = l
        final.append(l)
    final.sort(key=lambda l: (l['mat'], -(l['wholeBal'] or 0)))
    for i, l in enumerate(final):
        l['id'] = i + 1
    return final


# ---------------------------------------------------------------- entry point
def refresh(force=False, bundle=None):
    """Returns True when loans.json was rewritten."""
    deals = json.loads((DATA / 'deals.json').read_text())
    if bundle is None and not ua():
        print('SEC_USER_AGENT is not set (needs a name and email); skipping the loan refresh.')
        return False
    changed = force
    if bundle is None:
        for d in deals:
            try:
                f = latest_absee(d['cik'])
            except Exception as e:  # noqa: BLE001
                print('Could not check', d['deal'], e)
                return False
            if f and f['accession'] != d.get('accession'):
                d.update(f)
                d['xml'] = None
                changed = True
        if not changed:
            print('No new ABS-EE filings; loan data unchanged.')
            return False
    rows, zipmap = [], {}
    for d in deals:
        if bundle is not None:
            xml, src = bundle[d['deal']]
        else:
            if not d.get('xml'):
                d['xml'] = ex102_url(d['base'])
            src, xml = d['xml'], get(d['xml'])
        got = parse_ex102(xml, d['deal'], src, zipmap)
        print(f"{d['deal']}: {len(got)} loans with a balance (filed {d.get('filed')})")
        rows += got
    loans = clean(rows, zipmap)
    (DATA / 'loans.json').write_text(json.dumps(loans, separators=(',', ':')))
    (DATA / 'deals.json').write_text(json.dumps(deals, indent=1))
    print(f'loans.json: {len(loans)} loans, ${sum(l["wholeBal"] for l in loans) / 1e9:.2f}B whole-loan balance')
    return True


if __name__ == '__main__':
    refresh()
