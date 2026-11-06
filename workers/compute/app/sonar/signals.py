"""第 3–4 节：周线趋势状态与 18 个信号。对整段历史逐日求值，返回事件列表。"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field

import numpy as np

from . import indicators as I
from .weekly import completed_week_index, resample_weekly

BULL, BEAR = "bull", "bear"

CATEGORY = {
    "T_MA200_UP": "trend", "T_MA200_DOWN": "trend", "T_STACK_BULL": "trend", "T_STACK_BEAR": "trend",
    "T_MA50_PULLBACK": "trend", "T_MA50_REJECT": "trend", "T_ST_FLIP": "trend", "W_ST_FLIP": "trend",
    "M_RSI_LOW": "momentum", "M_RSI_HIGH": "momentum", "M_MACD_CROSS": "momentum", "M_MACD_DIV": "momentum",
    "W_MACD_CROSS": "momentum",
    "V_SQUEEZE_BREAK": "volatility", "V_RANGE_EXPAND": "volatility",
    "VOL_BREAKOUT": "volume", "VOL_OBV_DIV": "volume",
    "P_52W_HIGH": "position", "P_52W_LOW": "position", "P_STRETCH": "position",
}

MIN_BARS = 60
PIVOT_SIDE = 5


@dataclass
class Event:
    idx: int  # 触发日在日线数组中的下标
    signal_id: str
    direction: str
    timeframe: str  # D / W
    strength: int
    detail: dict = field(default_factory=dict)

    @property
    def category(self) -> str:
        return CATEGORY[self.signal_id]


def _r(x, nd=4):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), nd)


def _cross_up(a, b, i):
    return i > 0 and a[i - 1] <= b[i - 1] and a[i] > b[i]


def _cross_dn(a, b, i):
    return i > 0 and a[i - 1] >= b[i - 1] and a[i] < b[i]


def _ok(*vals) -> bool:
    return not any(np.isnan(v) for v in vals)


def _pivots(x: np.ndarray, kind: str) -> list[int]:
    """摆动点：严格低于（高于）左侧 5 根，且不高于（不低于）右侧 5 根。"""
    out = []
    for i in range(PIVOT_SIDE, len(x) - PIVOT_SIDE):
        left, right = x[i - PIVOT_SIDE : i], x[i + 1 : i + 1 + PIVOT_SIDE]
        if kind == "low" and x[i] < left.min() and x[i] <= right.min():
            out.append(i)
        if kind == "high" and x[i] > left.max() and x[i] >= right.max():
            out.append(i)
    return out


def weekly_state(dates, o, h, l, c, v):
    """返回 (每个交易日的周线趋势状态数组, 周线事件列表)。"""
    keys, last_day, wo, wh, wl, wc, wv = resample_weekly(dates, o, h, l, c, v)
    w_sma10, w_sma30 = I.sma(wc, 10), I.sma(wc, 30)
    w_macd, w_sig, _ = I.macd(wc)
    _, w_st = I.supertrend(wh, wl, wc)
    cw = completed_week_index(dates, keys)

    state = np.array(["flat"] * len(dates), dtype=object)
    for i, wi in enumerate(cw):
        if wi < 0 or not _ok(w_sma10[wi], w_sma30[wi], w_st[wi]):
            continue
        if wc[wi] > w_sma10[wi] > w_sma30[wi] and w_st[wi] == 1:
            state[i] = "up"
        elif wc[wi] < w_sma10[wi] < w_sma30[wi] and w_st[wi] == -1:
            state[i] = "down"

    events: list[Event] = []
    seen = set()
    for i, wi in enumerate(cw):
        # 事件在该周「走完」的那天触发（通常是周五，周五休市则下周一）
        if wi < 1 or wi in seen:
            continue
        seen.add(wi)
        if _ok(w_st[wi], w_st[wi - 1]) and w_st[wi] != w_st[wi - 1]:
            d = BULL if w_st[wi] == 1 else BEAR
            events.append(Event(i, "W_ST_FLIP", d, "W", 3, {"week": str(keys[wi])}))
        if _ok(w_macd[wi], w_sig[wi], w_macd[wi - 1], w_sig[wi - 1]):
            if _cross_up(w_macd, w_sig, wi):
                events.append(Event(i, "W_MACD_CROSS", BULL, "W", 2, {"week": str(keys[wi]), "w_macd": _r(w_macd[wi])}))
            elif _cross_dn(w_macd, w_sig, wi):
                events.append(Event(i, "W_MACD_CROSS", BEAR, "W", 2, {"week": str(keys[wi]), "w_macd": _r(w_macd[wi])}))
    weekly_ind = {"w_sma10": w_sma10, "w_sma30": w_sma30, "w_macd": w_macd, "w_macd_signal": w_sig, "w_st_dir": w_st}
    return state, events, cw, weekly_ind


def daily_events(o, h, l, c, v, ind: dict) -> list[Event]:
    n = len(c)
    ev: list[Event] = []
    if n < MIN_BARS:
        return ev
    s20, s50, s200 = ind["sma20"], ind["sma50"], ind["sma200"]
    atr = ind["atr14"]
    mac, sig = ind["macd"], ind["macd_signal"]
    st = ind["st_dir"]
    hi20 = I.rolling_prev_max(h, 20)
    lo20 = I.rolling_prev_min(l, 20)
    obv = ind["obv"]

    def stack(i, bull):
        if not _ok(c[i], s20[i], s50[i], s200[i]):
            return False
        return (c[i] > s20[i] > s50[i] > s200[i]) if bull else (c[i] < s20[i] < s50[i] < s200[i])

    def first(cond, i):
        """条件首次成立（今天成立、昨天不成立）。"""
        return cond(i) and not (i > 0 and cond(i - 1))

    def obv_bull(i):
        return i >= 20 and _ok(ind["ret20_pct"][i]) and ind["ret20_pct"][i] <= 0.10 and obv[i] > obv[i - 20]

    def obv_bear(i):
        return i >= 20 and _ok(ind["ret20_pct"][i]) and ind["ret20_pct"][i] >= 0.90 and obv[i] < obv[i - 20]

    def stretch_bear(i):
        return _ok(ind["ma50_dev"][i], ind["ma50_dev_pct"][i]) and ind["ma50_dev"][i] >= 2 and ind["ma50_dev_pct"][i] >= 0.95

    def stretch_bull(i):
        return _ok(ind["ma50_dev"][i], ind["ma50_dev_pct"][i]) and ind["ma50_dev"][i] <= -2 and ind["ma50_dev_pct"][i] <= 0.05

    new_high = np.array([_ok(ind["hi_52w"][i]) and c[i] > ind["hi_52w"][i] for i in range(n)])
    new_low = np.array([_ok(ind["lo_52w"][i]) and c[i] < ind["lo_52w"][i] for i in range(n)])

    for i in range(1, n):
        vr_pct = ind["vol_ratio_pct"][i]

        # ── 趋势 ──
        if _ok(c[i - 1], s200[i - 1], s200[i]):
            strength = 3 if _ok(vr_pct) and vr_pct >= 0.80 else 2
            if _cross_up(c, s200, i):
                ev.append(Event(i, "T_MA200_UP", BULL, "D", strength, {"close": _r(c[i]), "sma200": _r(s200[i])}))
            elif _cross_dn(c, s200, i):
                ev.append(Event(i, "T_MA200_DOWN", BEAR, "D", strength, {"close": _r(c[i]), "sma200": _r(s200[i])}))
        if stack(i, True) and not stack(i - 1, True):
            ev.append(Event(i, "T_STACK_BULL", BULL, "D", 2, {}))
        if stack(i, False) and not stack(i - 1, False):
            ev.append(Event(i, "T_STACK_BEAR", BEAR, "D", 2, {}))
        if i >= 10 and _ok(s50[i], s200[i], s50[i - 10], atr[i]) and all(_ok(s50[k]) for k in range(i - 5, i)):
            if (s50[i] > s200[i] and s50[i] > s50[i - 10] and all(c[k] > s50[k] for k in range(i - 5, i))
                    and l[i] <= s50[i] + 0.5 * atr[i] and c[i] > s50[i]):
                ev.append(Event(i, "T_MA50_PULLBACK", BULL, "D", 1, {"low": _r(l[i]), "sma50": _r(s50[i])}))
            if (s50[i] < s200[i] and s50[i] < s50[i - 10] and all(c[k] < s50[k] for k in range(i - 5, i))
                    and h[i] >= s50[i] - 0.5 * atr[i] and c[i] < s50[i]):
                ev.append(Event(i, "T_MA50_REJECT", BEAR, "D", 1, {"high": _r(h[i]), "sma50": _r(s50[i])}))
        if _ok(st[i], st[i - 1]) and st[i] != st[i - 1]:
            ev.append(Event(i, "T_ST_FLIP", BULL if st[i] == 1 else BEAR, "D", 2, {"st_line": _r(ind["st_line"][i])}))

        # ── 动量 ──
        rp, rp1 = ind["rsi14_pct"][i], ind["rsi14_pct"][i - 1]
        if _ok(rp, rp1):
            if rp <= 0.10 < rp1:
                ev.append(Event(i, "M_RSI_LOW", BULL, "D", 1, {"rsi14": _r(ind["rsi14"][i], 2), "pct": _r(rp, 3)}))
            if rp >= 0.90 > rp1:
                ev.append(Event(i, "M_RSI_HIGH", BEAR, "D", 1, {"rsi14": _r(ind["rsi14"][i], 2), "pct": _r(rp, 3)}))
        if _ok(mac[i], sig[i], mac[i - 1], sig[i - 1]):
            if _cross_up(mac, sig, i):
                ev.append(Event(i, "M_MACD_CROSS", BULL, "D", 2 if mac[i] < 0 else 1, {"macd": _r(mac[i])}))
            elif _cross_dn(mac, sig, i):
                ev.append(Event(i, "M_MACD_CROSS", BEAR, "D", 2 if mac[i] > 0 else 1, {"macd": _r(mac[i])}))

        # ── 波动 ──
        if i >= 4 and _ok(ind["bb_upper"][i], ind["bb_upper"][i - 1]):
            squeezed = any(_ok(ind["bb_width_pct"][k]) and ind["bb_width_pct"][k] <= 0.10 for k in range(i - 4, i + 1))
            if squeezed and _cross_up(c, ind["bb_upper"], i):
                ev.append(Event(i, "V_SQUEEZE_BREAK", BULL, "D", 2, {"bb_upper": _r(ind["bb_upper"][i])}))
            elif squeezed and _cross_dn(c, ind["bb_lower"], i):
                ev.append(Event(i, "V_SQUEEZE_BREAK", BEAR, "D", 2, {"bb_lower": _r(ind["bb_lower"][i])}))
        tp = ind["tr_ratio_pct"][i]
        if _ok(tp) and tp >= 0.95 and h[i] > l[i]:
            loc = (c[i] - l[i]) / (h[i] - l[i])
            if loc >= 0.75 or loc <= 0.25:
                ev.append(Event(i, "V_RANGE_EXPAND", BULL if loc >= 0.75 else BEAR, "D", 1,
                                {"tr_ratio": _r(ind["tr_ratio"][i], 2), "pct": _r(tp, 3), "close_loc": _r(loc, 2)}))

        # ── 量能 ──
        if _ok(vr_pct, hi20[i], lo20[i]) and vr_pct >= 0.90:
            if c[i] > hi20[i]:
                ev.append(Event(i, "VOL_BREAKOUT", BULL, "D", 2, {"vol_ratio": _r(ind["vol_ratio"][i], 2), "pct": _r(vr_pct, 3)}))
            elif c[i] < lo20[i]:
                ev.append(Event(i, "VOL_BREAKOUT", BEAR, "D", 2, {"vol_ratio": _r(ind["vol_ratio"][i], 2), "pct": _r(vr_pct, 3)}))
        if first(obv_bull, i):
            ev.append(Event(i, "VOL_OBV_DIV", BULL, "D", 1, {"ret20_pct": _r(ind["ret20_pct"][i], 3)}))
        if first(obv_bear, i):
            ev.append(Event(i, "VOL_OBV_DIV", BEAR, "D", 1, {"ret20_pct": _r(ind["ret20_pct"][i], 3)}))

        # ── 位置 ──
        if new_high[i] and not new_high[max(0, i - 20) : i].any():
            ev.append(Event(i, "P_52W_HIGH", BULL, "D", 2, {"close": _r(c[i]), "hi_52w": _r(ind["hi_52w"][i])}))
        if new_low[i] and not new_low[max(0, i - 20) : i].any():
            ev.append(Event(i, "P_52W_LOW", BEAR, "D", 2, {"close": _r(c[i]), "lo_52w": _r(ind["lo_52w"][i])}))
        if first(stretch_bear, i):
            ev.append(Event(i, "P_STRETCH", BEAR, "D", 1, {"ma50_dev": _r(ind["ma50_dev"][i], 2)}))
        if first(stretch_bull, i):
            ev.append(Event(i, "P_STRETCH", BULL, "D", 1, {"ma50_dev": _r(ind["ma50_dev"][i], 2)}))

    # ── MACD 背离（在后一个摆动点确认当天触发）──
    for kind, direction in (("low", BULL), ("high", BEAR)):
        price = l if kind == "low" else h
        piv = [p for p in _pivots(price, kind) if _ok(mac[p])]
        for a, b in zip(piv, piv[1:]):
            if not 10 <= b - a <= 60:
                continue
            if direction == BULL and price[b] < price[a] and mac[b] > mac[a]:
                ev.append(Event(b + PIVOT_SIDE, "M_MACD_DIV", BULL, "D", 3, {"pivots": [a, b]}))
            if direction == BEAR and price[b] > price[a] and mac[b] < mac[a]:
                ev.append(Event(b + PIVOT_SIDE, "M_MACD_DIV", BEAR, "D", 3, {"pivots": [a, b]}))

    ev.sort(key=lambda e: (e.idx, e.signal_id, e.direction))
    return ev


def all_events(dates: list[dt.date], o, h, l, c, v):
    """返回 (日线指标, 周线指标, 每日周线状态, 全部事件)。"""
    ind = I.compute_daily(o, h, l, c, v)
    wstate, wevents, cw, wind = weekly_state(dates, o, h, l, c, v)
    events = daily_events(o, h, l, c, v, ind) + wevents
    # 背离事件的 pivots 下标换成日期，便于展示
    for e in events:
        if "pivots" in e.detail:
            e.detail["pivots"] = [str(dates[p]) for p in e.detail["pivots"]]
    events.sort(key=lambda e: (e.idx, e.signal_id, e.direction))
    return ind, wind, cw, wstate, events
