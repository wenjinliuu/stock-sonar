import json

from golden_lib import load_bars
from server import handle_scan


def test_scan_columnar_roundtrip():
    bars = load_bars("NVDA")
    t = {"ticker": "NVDA", "tier": "core", **{k: [b[f] if k == "d" else float(b[f]) for b in bars] for k, f in
         (("d", "date"), ("o", "open"), ("h", "high"), ("l", "low"), ("c", "close"), ("v", "volume"))}}
    out = handle_scan({"as_of": "2026-11-05", "tickers": [t, {"ticker": "BAD", "d": ["x"], "o": [1], "h": [1], "l": [1], "c": [1], "v": [1]}]})
    json.dumps(out, allow_nan=False)  # 不能有 NaN
    r = out["results"][0]
    assert r["date"] == "2026-11-05" and r["opportunity"]["direction"] == "bear"
    assert {i["name"] for i in r["indicators"]} >= {"rsi14", "w_st_dir"}
    assert "error" in out["results"][1]


def test_as_of_cuts_future_bars():
    bars = load_bars("AAPL")
    t = {"ticker": "AAPL", **{k: [b[f] if k == "d" else float(b[f]) for b in bars] for k, f in
         (("d", "date"), ("o", "open"), ("h", "high"), ("l", "low"), ("c", "close"), ("v", "volume"))}}
    assert handle_scan({"as_of": "2026-06-01", "tickers": [t]})["results"][0]["date"] == "2026-06-01"
