"""Daily job: refresh rates, refresh loans if the SEC has new tapes, rebuild the site."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rates, sec_loans, build  # noqa: E402

if __name__ == '__main__':
    rates.refresh()
    try:
        sec_loans.refresh(force='--force-loans' in sys.argv)
    except Exception as e:  # noqa: BLE001  (a failed SEC pull should never block the rate update)
        print('Loan refresh failed; keeping the previous loan data.', e)
    build.main()
