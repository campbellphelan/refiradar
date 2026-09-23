"""Build public/index.html (website) and public/radar/index.html (tool) from src/ and data/."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC, DATA, OUT = ROOT / 'src', ROOT / 'data', ROOT / 'public'
SITE_URL = 'https://refiradar.netlify.app'
ICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Ccircle cx='20' cy='20' r='18' fill='%230C1220'/%3E"
        "%3Ccircle cx='20' cy='20' r='11' fill='none' stroke='%23556' stroke-width='2'/%3E%3Cline x1='20' y1='20' x2='35' y2='12' stroke='%237C9BFF' "
        "stroke-width='3' stroke-linecap='round'/%3E%3Ccircle cx='28' cy='10' r='3' fill='%23E6A24B'/%3E%3C/svg%3E")
TOOL_ARTIFACT = 'https://claude.ai/artifact/TPJcjwUwE8AEpJvmUMqexS'
SITE_ARTIFACT = 'https://claude.ai/artifact/91qMe7uCZyfN8FPf5HwzxL'
SITE_KEEP = ['id', 'name', 'city', 'st', 'msa', 'type', 'sf', 'mat', 'rate', 'io', 'amort', 'trustBal', 'wholeBal', 'wholeEst', 'pay', 'ssXfer',
             'msReturn', 'mod', 'occSec', 'occRec', 'noiRec', 'ncfSec', 'ncfRec', 'dsRec', 'finEnd', 'topExp', 'topSf', 'partialDef', 'valSec']


def wrap(src, extra_head=''):
    i = src.index('</style>') + len('</style>')
    head, body = src[:i], src[i:]
    return ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            f'<link rel="icon" href="{ICON}">\n<style>[hidden]{{display:none!important}}img{{max-width:100%}}</style>\n'
            f'{extra_head}{head}\n</head>\n<body>{body}\n</body>\n</html>\n')


def og(title, desc):
    return (f'<meta property="og:type" content="website">\n<meta property="og:url" content="{SITE_URL}/">\n'
            f'<meta property="og:title" content="{title}">\n<meta property="og:description" content="{desc}">\n'
            f'<meta property="og:image" content="{SITE_URL}/og.png">\n<meta name="twitter:card" content="summary_large_image">\n')


def main():
    loans = json.loads((DATA / 'loans.json').read_text())
    rates = json.loads((DATA / 'rates.json').read_text())
    deals = json.loads((DATA / 'deals.json').read_text())
    filed = [d['filed'] for d in deals if d.get('filed')]
    rates['loansFiled'] = max(filed) if filed else rates.get('loansFiled', '2026-08-31')
    rates_js = 'const RR_RATES = ' + json.dumps(rates) + ';\n'
    engine = rates_js + (SRC / 'engine.js').read_text()

    names = {l['name']: l['id'] for l in loans}
    briefs = []
    for b in json.loads((SRC / 'briefs.json').read_text()):
        n = b.pop('name')
        if n in names:  # a loan that paid off drops out of the data, and its brief with it
            b['id'] = names[n]
            briefs.append(b)

    tool = (SRC / 'tool_template.html').read_text()
    tool = (tool.replace('/*__ENGINE__*/', engine).replace('/*__DATA__*/', json.dumps(loans, separators=(',', ':')))
                .replace('/*__BRIEFS__*/', json.dumps(briefs, separators=(',', ':'), ensure_ascii=False))
                .replace('/*__APP__*/', (SRC / 'app.js').read_text()).replace(SITE_ARTIFACT, '/'))
    (OUT / 'radar').mkdir(parents=True, exist_ok=True)
    (OUT / 'radar' / 'index.html').write_text(wrap(tool, og('Refi Radar · Campbell Phelan',
        'CMBS loans coming due through 2027, sized for refinancing at today’s rates.')))

    site_data = [{k: l.get(k) for k in SITE_KEEP} for l in loans]
    site = (SRC / 'site_template.html').read_text()
    site = (site.replace('__TOOL_URL__', '/radar/').replace(TOOL_ARTIFACT, '/radar/').replace('/*__ENGINE__*/', engine)
                .replace('/*__DATA__*/', json.dumps(site_data, separators=(',', ':'))).replace('/*__SITEJS__*/', (SRC / 'site.js').read_text()))
    site = site.replace(' target="_blank" rel="noopener">Open Refi Radar', '>Open Refi Radar')
    (OUT / 'index.html').write_text(wrap(site, og('The 2017 Maturity Wall · Campbell Phelan',
        'A deal-sourcing tool for CRE lenders and debt brokers, built from SEC data on CMBS loans that come due by the end of 2027.')))
    print(f"Built public/ with {len(loans)} loans, {len(briefs)} briefs, 10-yr {rates.get('ust10')}% ({rates.get('ust10Date')}), "
          f"SOFR {rates.get('sofr')}% ({rates.get('sofrDate')}), loan filings through {rates['loansFiled']}")


if __name__ == '__main__':
    main()
