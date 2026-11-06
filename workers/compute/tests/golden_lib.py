"""golden 基准文件的生成与读取。TS 实现（P2）读同一份文件做一致性比对。"""
import csv
import json
import math
from pathlib import Path

from sonar.scan import parse_bars
from sonar.signals import all_events

HERE = Path(__file__).resolve().parent
TICKERS = ("AAPL", "NVDA", "XOM")


def load_bars(ticker: str):
    with open(HERE / "fixtures" / f"{ticker}.csv") as f:
        return list(csv.DictReader(f))


def compute(ticker: str) -> dict:
    dates, o, h, l, c, v = parse_bars(load_bars(ticker))
    ind, wind, cw, wstate, events = all_events(dates, o, h, l, c, v)
    clean = lambda arr: [None if math.isnan(float(x)) else float(x) for x in arr]
    return {
        "ticker": ticker,
        "dates": [str(d) for d in dates],
        "daily": {k: clean(v) for k, v in sorted(ind.items())},
        "weekly_completed_index": [int(x) for x in cw],
        "weekly": {k: clean(v) for k, v in sorted(wind.items())},
        "weekly_state": list(wstate),
        "events": [
            {"date": str(dates[e.idx]), "signal_id": e.signal_id, "direction": e.direction,
             "timeframe": e.timeframe, "strength": e.strength}
            for e in events
        ],
    }


def golden_path(ticker: str) -> Path:
    return HERE / "golden" / f"{ticker}.json"


def write_all():
    for t in TICKERS:
        golden_path(t).write_text(json.dumps(compute(t), separators=(",", ":")))
