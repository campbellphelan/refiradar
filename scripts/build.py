"""Build the site from src/ and data/.

write_live() writes data/live.json: today's rates, the loan data and the briefs. The daily job runs only this step.
The pages load data/live.json from GitHub each time someone opens them, so a data update needs no Netlify deploy.

main() also rebuilds public/index.html (website) and public/radar/index.html (tool). Each page carries a copy of the
data from the day it was built, used only if GitHub can't be reached. Netlify deploys only when public/ changes.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC, DATA, OUT = ROOT / 'src', ROOT / 'data', ROOT / 'public'
SITE_URL = 'https://refiradar.netlify.app'
REITS_SITE_URL = 'https://reitrunway.netlify.app'
ROUT = ROOT / 'reits-site' / 'public'  # REIT Runway is its own Netlify site, deployed from reits-site/
ICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Ccircle cx='20' cy='20' r='18' fill='%230C1220'/%3E"
        "%3Ccircle cx='20' cy='20' r='11' fill='none' stroke='%23556' stroke-width='2'/%3E%3Cline x1='20' y1='20' x2='35' y2='12' stroke='%237C9BFF' "
        "stroke-width='3' stroke-linecap='round'/%3E%3Ccircle cx='28' cy='10' r='3' fill='%23E6A24B'/%3E%3C/svg%3E")
REIT_ICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Ccircle cx='20' cy='20' r='18' fill='%230C1220'/%3E"
             "%3Crect x='11' y='21' width='4' height='8' rx='1' fill='%237C9BFF'/%3E%3Crect x='16.5' y='15' width='4' height='14' rx='1' fill='%23E6A24B'/%3E"
             "%3Crect x='22' y='18' width='4' height='11' rx='1' fill='%237C9BFF'/%3E%3Crect x='27.5' y='23' width='2.5' height='6' rx='1' fill='%237C9BFF'/%3E%3C/svg%3E")
LIVE_URL = 'https://raw.githubusercontent.com/campbellphelan/refiradar/main/data/live.json'
REITS_LIVE_URL = 'https://raw.githubusercontent.com/campbellphelan/refiradar/main/data/reits_live.json'
TOOL_ARTIFACT = 'https://claude.ai/artifact/TPJcjwUwE8AEpJvmUMqexS'
SITE_ARTIFACT = 'https://claude.ai/artifact/91qMe7uCZyfN8FPf5HwzxL'
SITE_KEEP = ['id', 'name', 'city', 'st', 'msa', 'type', 'sf', 'mat', 'rate', 'io', 'amort', 'trustBal', 'wholeBal', 'wholeEst', 'pay', 'ssXfer',
             'msReturn', 'mod', 'occSec', 'occRec', 'noiRec', 'ncfSec', 'ncfRec', 'dsRec', 'finEnd', 'topExp', 'topSf', 'partialDef', 'valSec']


def wrap(src, extra_head='', icon=ICON):
    i = src.index('</style>') + len('</style>')
    head, body = src[:i], src[i:]
    head += '\n<style>html{background:var(--bg)}html.rr-wait body{visibility:hidden}</style>'
    return ('<!doctype html>\n<html lang="en" class="rr-wait">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            f'<link rel="icon" href="{icon}">\n<style>[hidden]{{display:none!important}}img{{max-width:100%}}</style>\n'
            f'{extra_head}{head}\n</head>\n<body>{body}\n</body>\n</html>\n')


def og(title, desc, path='/', image=True, site=SITE_URL):
    pic = (f'<meta property="og:image" content="{site}/og.png">\n<meta name="twitter:card" content="summary_large_image">\n' if image
           else '<meta name="twitter:card" content="summary">\n')  # og.png shows the CMBS chart, so other tools share without it
    return (f'<meta property="og:type" content="website">\n<meta property="og:url" content="{site}{path}">\n'
            f'<meta property="og:title" content="{title}">\n<meta property="og:description" content="{desc}">\n' + pic)


LOADER = """<script>
(function () {
  var done = false;
  function run(live) {
    if (done) return; done = true;
    var ok = live && live.rates && live.rates.today >= '__BUILT__' && Array.isArray(live.__KEY__) && live.__KEY__.length > 0;
    window.RR_LIVE = ok ? live : null;
    document.querySelectorAll('script[type="text/rr-deferred"]').forEach(function (old) {
      var s = document.createElement('script'); s.text = old.text; old.parentNode.replaceChild(s, old);
    });
    document.documentElement.classList.remove('rr-wait');
  }
  setTimeout(function () { run(null); }, 4000);
  try {
    fetch('__LIVE_URL__', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(run, function () { run(null); });
  } catch (e) { run(null); }
})();
</script>
<noscript><style>html.rr-wait body{visibility:visible}</style></noscript>"""


def defer(template, today, url=LIVE_URL, key='loans'):
    """Hold the template's scripts until the day's data arrives, and add the loader that fetches it.
    If GitHub can't be reached within 4 seconds, the scripts run with the copy of the data built into the page."""
    template = template.replace('<script>\n', '<script type="text/rr-deferred">\n')
    return template + '\n' + LOADER.replace('__BUILT__', today).replace('__LIVE_URL__', url).replace('__KEY__', key)


def live_data():
    loans = json.loads((DATA / 'loans.json').read_text())
    rates = json.loads((DATA / 'rates.json').read_text())
    deals = json.loads((DATA / 'deals.json').read_text())
    filed = [d['filed'] for d in deals if d.get('filed')]
    rates['loansFiled'] = max(filed) if filed else rates.get('loansFiled', '2026-08-31')
    names = {l['name']: l['id'] for l in loans}
    briefs = []
    for b in json.loads((SRC / 'briefs.json').read_text()):
        n = b.pop('name')
        if n in names:  # a loan that paid off drops out of the data, and its brief with it
            b['id'] = names[n]
            briefs.append(b)
    return loans, rates, briefs


REIT_KEEP = ['cik', 'ticker', 'name', 'sector', 'fyEnd', 'asOf', 'filed10K', 'acc10K', 'doc10K', 'filed10Q', 'acc10Q', 'doc10Q', 'debt', 'debtEst',
             'ladder', 'ladderSrc', 'ladderNote', 'ladderCheck', 'ladderTotal', 'cash', 'revolverLeft', 'ocf', 'dividends', 'interest', 'rate',
             'realEstate', 'assets']


def reits_data():
    f = DATA / 'reits.json'
    if not f.exists():
        return []
    return [{k: r[k] for k in REIT_KEEP if r.get(k) is not None} for r in json.loads(f.read_text()) if not r.get('error')]


def write_live():
    loans, rates, briefs = live_data()
    (DATA / 'live.json').write_text(json.dumps({'rates': rates, 'loans': loans, 'briefs': briefs},
                                               separators=(',', ':'), ensure_ascii=False) + '\n')
    reits = reits_data()
    if reits:
        (DATA / 'reits_live.json').write_text(json.dumps({'rates': rates, 'reits': reits}, separators=(',', ':'), ensure_ascii=False) + '\n')
        print(f'Wrote data/reits_live.json with {len(reits)} REITs')
    print(f"Wrote data/live.json with {len(loans)} loans, {len(briefs)} briefs, 10-yr {rates.get('ust10')}% "
          f"({rates.get('ust10Date')}), SOFR {rates.get('sofr')}% ({rates.get('sofrDate')}), loan filings through {rates['loansFiled']}")


def main(only=None):
    """Rebuild the pages. only='reits' rebuilds just REIT Runway, so a REIT change doesn't redeploy Refi Radar."""
    write_live()
    if only != 'reits':
        build_radar()
    build_reits()


def build_radar():
    loans, rates, briefs = live_data()
    live = '(window.RR_LIVE && window.RR_LIVE.{}) || '
    rates_js = 'const RR_RATES = ' + live.format('rates') + json.dumps(rates) + ';\n'
    engine = rates_js + (SRC / 'engine.js').read_text()

    tool = defer((SRC / 'tool_template.html').read_text(), rates['today'])
    tool = (tool.replace('/*__ENGINE__*/', engine).replace('/*__DATA__*/', live.format('loans') + json.dumps(loans, separators=(',', ':')))
                .replace('/*__BRIEFS__*/', live.format('briefs') + json.dumps(briefs, separators=(',', ':'), ensure_ascii=False))
                .replace('/*__APP__*/', (SRC / 'app.js').read_text()).replace(SITE_ARTIFACT, '/'))
    (OUT / 'radar').mkdir(parents=True, exist_ok=True)
    (OUT / 'radar' / 'index.html').write_text(wrap(tool, og('Refi Radar · Campbell Phelan',
        'CMBS loans coming due through 2027, sized for refinancing at today’s rates.')))

    site_data = [{k: l.get(k) for k in SITE_KEEP} for l in loans]
    site = defer((SRC / 'site_template.html').read_text(), rates['today'])
    site = (site.replace('__TOOL_URL__', '/radar/').replace(TOOL_ARTIFACT, '/radar/').replace('/*__ENGINE__*/', engine)
                .replace('/*__DATA__*/', live.format('loans') + json.dumps(site_data, separators=(',', ':'))).replace('/*__SITEJS__*/', (SRC / 'site.js').read_text()))
    site = site.replace(' target="_blank" rel="noopener">Open Refi Radar', '>Open Refi Radar')
    (OUT / 'index.html').write_text(wrap(site, og('The 2017 Maturity Wall · Campbell Phelan',
        'A deal-sourcing tool for CRE lenders and debt brokers, built from SEC data on CMBS loans that come due by the end of 2027.')))
    print(f"Rebuilt public/ with {len(loans)} loans, {len(briefs)} briefs, 10-yr {rates.get('ust10')}% ({rates.get('ust10Date')}), "
          f"SOFR {rates.get('sofr')}% ({rates.get('sofrDate')}), loan filings through {rates['loansFiled']}")



def build_reits():
    """REIT Runway: the write-up at reits-site/public/ and the tool at reits-site/public/runway/."""
    reits = reits_data()
    if not reits:
        return
    rates = live_data()[1]
    live = '(window.RR_LIVE && window.RR_LIVE.{}) || '
    engine = 'const RW_RATES = ' + live.format('rates') + json.dumps(rates) + ';\n' + (SRC / 'reits_engine.js').read_text()
    data = live.format('reits') + json.dumps(reits, separators=(',', ':'))
    tool = defer((SRC / 'reits_template.html').read_text(), rates['today'], REITS_LIVE_URL, 'reits')
    tool = tool.replace('/*__ENGINE__*/', engine).replace('/*__DATA__*/', data).replace('/*__APP__*/', (SRC / 'reits_app.js').read_text())
    (ROUT / 'runway').mkdir(parents=True, exist_ok=True)
    (ROUT / 'runway' / 'index.html').write_text(wrap(tool, og('REIT Runway · Campbell Phelan',
        'Which public REITs need capital in the next 24 months, read from their SEC filings.', '/runway/', False, REITS_SITE_URL), REIT_ICON))
    home = defer((SRC / 'reits_site_template.html').read_text(), rates['today'], REITS_LIVE_URL, 'reits')
    home = home.replace('/*__ENGINE__*/', engine).replace('/*__DATA__*/', data).replace('/*__SITEJS__*/', (SRC / 'reits_site.js').read_text())
    (ROUT / 'index.html').write_text(wrap(home, og('REIT Runway · Campbell Phelan',
        'A capital-sourcing tool built from the SEC filings of every listed U.S. equity REIT: who has debt due in the next 24 months, and how much they can’t cover.',
        '/', False, REITS_SITE_URL), REIT_ICON))
    print(f'Rebuilt reits-site/public/ with {len(reits)} REITs')


if __name__ == '__main__':
    main('reits' if '--reits-only' in sys.argv else None)
