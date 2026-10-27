"""Daily job: refresh rates, refresh loans if the SEC has new tapes, refresh REITs that have filed a new 10-K or 10-Q,
and write data/live.json and data/reits_live.json.

The pages read data/live.json when they open, so the daily update doesn't touch public/ and Netlify doesn't redeploy.
Pass --site to also rebuild public/ (the workflow does this when the design changes).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rates, sec_loans, reits, build  # noqa: E402

if __name__ == '__main__':
    rates.refresh()
    try:
        sec_loans.refresh(force='--force-loans' in sys.argv)
    except Exception as e:  # noqa: BLE001  (a failed SEC pull should never block the rate update)
        print('Loan refresh failed; keeping the previous loan data.', e)
    try:
        reits.refresh(force='--force-reits' in sys.argv)
    except Exception as e:  # noqa: BLE001  (same: never block the rate update)
        print('REIT refresh failed; keeping the previous REIT data.', e)
    if '--site' in sys.argv:
        build.main()
    else:
        build.write_live()
