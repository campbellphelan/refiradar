"""Fetch the latest 10-year Treasury close (U.S. Treasury) and SOFR (New York Fed).

Writes data/rates.json. If a source is unreachable, the previous value is kept.
"""
import csv, io, json
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / 'data'
UA = {'User-Agent': 'Mozilla/5.0 (RefiRadar daily rate update)'}
TREASURY = ('https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/'
            '{y}/all?type=daily_treasury_yield_curve&field_tdr_date_value={y}&page&_format=csv')
SOFR = 'https://markets.newyorkfed.org/api/rates/secured/sofr/last/1.json'


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read().decode('utf-8-sig')


def treasury_10y():
    y = date.today().year
    for year in (y, y - 1):  # early January can have no rows yet for the new year
        rows = list(csv.DictReader(io.StringIO(fetch(TREASURY.format(y=year)))))
        rows = [r for r in rows if (r.get('10 Yr') or '').strip()]
        if rows:
            latest = max(rows, key=lambda r: datetime.strptime(r['Date'], '%m/%d/%Y'))
            return float(latest['10 Yr']), datetime.strptime(latest['Date'], '%m/%d/%Y').date().isoformat()
    raise RuntimeError('no Treasury rows')


def sofr():
    r = json.loads(fetch(SOFR))['refRates'][0]
    return float(r['percentRate']), r['effectiveDate']


def refresh():
    path = DATA / 'rates.json'
    old = json.loads(path.read_text()) if path.exists() else {}
    new = dict(old)
    try:
        new['ust10'], new['ust10Date'] = treasury_10y()
    except Exception as e:  # noqa: BLE001
        print('Treasury fetch failed, keeping', old.get('ust10'), e)
    try:
        new['sofr'], new['sofrDate'] = sofr()
    except Exception as e:  # noqa: BLE001
        print('SOFR fetch failed, keeping', old.get('sofr'), e)
    new['today'] = date.today().isoformat()
    new['checkedAt'] = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ')
    path.write_text(json.dumps(new, indent=1))
    print(f"10-yr {new.get('ust10')}% ({new.get('ust10Date')}), SOFR {new.get('sofr')}% ({new.get('sofrDate')})")
    return new


if __name__ == '__main__':
    refresh()
