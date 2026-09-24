"""Fail the build if the ZAP baseline report has any medium or high risk alert.

ZAP's baseline scan only warns by default; docs/SECURITY.md s.7 requires "no medium+ findings",
so CI runs it with -I (never fail on warnings) and this gate decides. Informational and low alerts
are printed for the record but do not fail the run.

    python scripts/zap_gate.py zap/zap.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

RISK = {0: "info", 1: "low", 2: "medium", 3: "high"}


def main(path: str) -> int:
    report = json.loads(Path(path).read_text(encoding="utf-8"))
    worst = -1
    for site in report.get("site", []):
        for alert in site.get("alerts", []):
            risk = int(alert.get("riskcode", 0))
            worst = max(worst, risk)
            count = alert.get("count", len(alert.get("instances", [])))
            print(
                f"{RISK.get(risk, risk):>6}  {alert.get('pluginid')}  {alert.get('name')}  x{count}"
            )
    if worst < 0:
        print("no alerts")
    if worst >= 2:
        print(f"FAIL: highest risk is {RISK[worst]} (medium or high is not allowed)")
        return 1
    print("ok: no medium or high risk alerts")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "zap/zap.json"))
