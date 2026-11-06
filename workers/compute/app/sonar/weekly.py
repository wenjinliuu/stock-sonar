"""日线合成周线，以及「截至某天已走完的周」。"""
from __future__ import annotations

import datetime as dt

import numpy as np


def week_key(d: dt.date) -> dt.date:
    """所在周的周一。"""
    return d - dt.timedelta(days=d.weekday())


def resample_weekly(dates: list[dt.date], o, h, l, c, v):
    """返回 (周一日期列表, 每周最后交易日, o, h, l, c, v)。"""
    keys, last_day, wo, wh, wl, wc, wv = [], [], [], [], [], [], []
    for i, d in enumerate(dates):
        k = week_key(d)
        if not keys or keys[-1] != k:
            keys.append(k)
            last_day.append(d)
            wo.append(o[i]); wh.append(h[i]); wl.append(l[i]); wc.append(c[i]); wv.append(v[i])
        else:
            last_day[-1] = d
            wh[-1] = max(wh[-1], h[i]); wl[-1] = min(wl[-1], l[i]); wc[-1] = c[i]; wv[-1] += v[i]
    arr = lambda x: np.asarray(x, dtype=float)
    return keys, last_day, arr(wo), arr(wh), arr(wl), arr(wc), arr(wv)


def completed_week_index(dates: list[dt.date], week_keys: list[dt.date]) -> np.ndarray:
    """对每个交易日 t，返回截至 t 已走完的最后一周在 week_keys 中的下标（无则 −1）。

    规则（docs/signals.md 1 节）：之前的周都算走完；本周只有在 t 是周五时算走完。
    """
    pos = {k: i for i, k in enumerate(week_keys)}
    out = np.full(len(dates), -1, dtype=int)
    for i, d in enumerate(dates):
        wi = pos[week_key(d)]
        out[i] = wi if d.weekday() == 4 else wi - 1
    return out
