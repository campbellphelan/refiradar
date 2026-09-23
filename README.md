# Refi Radar

Deal sourcing for CRE lenders and debt brokers. The site lives at https://refiradar.netlify.app.

## How the daily update works

A GitHub Actions job (`.github/workflows/daily-update.yml`) runs every weekday evening after the Treasury posts closing yields.

1. `scripts/rates.py` pulls the 10-year Treasury close from the U.S. Treasury's daily par yield curve and SOFR from the New York Fed, and writes `data/rates.json`.
2. `scripts/sec_loans.py` checks the SEC for new Form ABS-EE filings from the 15 tracked CMBS trusts. When a trust has filed a new monthly tape, it downloads all 15 loan tapes, cleans them and writes `data/loans.json`. Otherwise it leaves the loan data alone.
3. `scripts/build.py` rebuilds `public/index.html` (the website) and `public/radar/index.html` (the tool).
4. The job commits any changes. Netlify is linked to this repository and publishes `public/` within about a minute.

## One-time settings

- **Repository variable `SEC_USER_AGENT`** (Settings → Secrets and variables → Actions → Variables): your name and email, for example `Jane Doe jane@example.com`. The SEC asks automated users to identify themselves this way. Without it, rates still update daily but the loan data does not.
- **Netlify**: link the site to this repository, with no build command and `public` as the publish directory.

## Running it by hand

Actions → Daily data update → Run workflow. Tick "Rebuild loan data" to force a full loan refresh.

## What stays manual

- Lender spreads, leverage limits and cap rates are defaults in `src/engine.js` (`RR_DEFAULTS`). Update them when a new lender survey comes out.
- The 11 Claude-written briefs are in `src/briefs.json`. The pitch notes for every other loan are generated from the numbers and update on their own.

Built by Campbell Phelan from public SEC filings. Not investment advice.
