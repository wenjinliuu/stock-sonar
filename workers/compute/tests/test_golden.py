"""golden test：公式改动必须显式更新基准（UPDATE_GOLDEN=1 python -m pytest），并同步 TS 实现。"""
import json
import math
import os

import pytest

from golden_lib import TICKERS, compute, golden_path, write_all

if os.environ.get("UPDATE_GOLDEN") == "1":
    write_all()


def _close(a, b):
    if a is None or b is None:
        return a is None and b is None
    return math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9)


@pytest.mark.parametrize("ticker", TICKERS)
def test_matches_golden(ticker):
    want = json.loads(golden_path(ticker).read_text())
    got = compute(ticker)
    assert got["dates"] == want["dates"]
    for section in ("daily", "weekly"):
        assert set(got[section]) == set(want[section])
        for name in want[section]:
            bad = [i for i, (a, b) in enumerate(zip(got[section][name], want[section][name])) if not _close(a, b)]
            assert not bad, f"{ticker} {name} 在第 {bad[:5]} 根不一致"
    assert got["weekly_completed_index"] == want["weekly_completed_index"]
    assert got["weekly_state"] == want["weekly_state"]
    assert got["events"] == want["events"]
