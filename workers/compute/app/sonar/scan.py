"""对一只股票做一次扫描：输入日线，输出当天指标快照、当天信号、机会（若入选）。"""
from __future__ import annotations

import datetime as dt
import math

import numpy as np

from . import SPEC_VERSION
from .indicators import PCT_NAMES
from .scoring import score_day
from .signals import MIN_BARS, all_events

SNAPSHOT = (
    "sma20", "sma50", "sma200", "macd", "macd_signal", "macd_hist", "rsi14", "atr14",
    "bb_upper", "bb_lower", "bb_width", "st_line", "st_dir", "vol_ratio", "obv", "tr_ratio",
    "hi_52w", "lo_52w", "ma50_dev", "ret20",
)
WEEKLY_SNAPSHOT = ("w_sma10", "w_sma30", "w_macd", "w_macd_signal", "w_st_dir")


def _f(x):
    if x is None:
        return None
    x = float(x)
    return None if math.isnan(x) or math.isinf(x) else x


def parse_bars(bars: list[dict]):
    bars = sorted(bars, key=lambda b: b["date"])
    dates = [dt.date.fromisoformat(b["date"]) for b in bars]
    arr = lambda k: np.asarray([float(b[k]) for b in bars], dtype=float)
    return dates, arr("open"), arr("high"), arr("low"), arr("close"), arr("volume")


def scan_ticker(ticker: str, tier: str, bars: list[dict], as_of: str | None = None) -> dict:
    """as_of 缺省为最后一根 K 线的日期。"""
    dates, o, h, l, c, v = parse_bars(bars)
    if as_of:
        cut = dt.date.fromisoformat(as_of)
        k = sum(1 for d in dates if d <= cut)
        dates, o, h, l, c, v = dates[:k], o[:k], h[:k], l[:k], c[:k], v[:k]
    out = {"ticker": ticker, "spec": SPEC_VERSION, "date": str(dates[-1]) if dates else None,
           "indicators": [], "signals": [], "opportunity": None}
    if len(dates) < MIN_BARS:
        out["skipped"] = f"不足 {MIN_BARS} 根日线"
        return out

    ind, wind, cw, wstate, events = all_events(dates, o, h, l, c, v)
    t = len(dates) - 1
    for name in SNAPSHOT:
        pct = ind.get(name + "_pct") if name in PCT_NAMES else None
        out["indicators"].append({"name": name, "value": _f(ind[name][t]), "pct": _f(pct[t]) if pct is not None else None})
    if cw[t] >= 0:
        for name in WEEKLY_SNAPSHOT:
            out["indicators"].append({"name": name, "value": _f(wind[name][cw[t]]), "pct": None})

    def ev_json(e):
        return {"signal_id": e.signal_id, "direction": e.direction, "timeframe": e.timeframe,
                "strength": e.strength, "category": e.category, "date": str(dates[e.idx]), "detail": e.detail}

    out["signals"] = [ev_json(e) for e in events if e.idx == t]
    opp = score_day(events, t, wstate[t], tier)
    if opp:
        dollar_vol = float(np.mean((c * v)[-20:]))
        out["opportunity"] = {
            "direction": opp.direction,
            "score": opp.score,
            "categories": opp.categories,
            "base": opp.base,
            "weekly_bonus": opp.weekly_bonus,
            "opposite_base": opp.opposite_base,
            "divergent": opp.divergent,
            "weekly_state": opp.weekly_state,
            "dollar_vol20": dollar_vol,
            "reasons": [ev_json(e) for e in opp.signals],
        }
    return out
