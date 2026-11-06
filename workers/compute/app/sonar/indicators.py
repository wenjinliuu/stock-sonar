"""第 2 节：指标定义。公式以 docs/signals.md 为准，不依赖第三方指标库。

所有函数输入 numpy 数组（float64，按日期升序），输出等长数组，无法计算的位置为 NaN。
"""
from __future__ import annotations

import numpy as np

NaN = np.nan


def sma(x: np.ndarray, n: int) -> np.ndarray:
    out = np.full(len(x), NaN)
    if len(x) < n:
        return out
    isnan = np.isnan(x)
    c = np.cumsum(np.insert(np.where(isnan, 0.0, x), 0, 0.0))
    out[n - 1 :] = (c[n:] - c[:-n]) / n
    # 窗口内含 NaN 时结果为 NaN
    if isnan.any():
        bad = np.convolve(isnan.astype(float), np.ones(n), "full")[: len(x)] > 0
        out[bad] = NaN
    return out


def _recursive(x: np.ndarray, n: int, alpha: float) -> np.ndarray:
    """首值 = 前 n 个有效值的 SMA，之后 y = α·x + (1−α)·y[−1]。前导 NaN 跳过。"""
    out = np.full(len(x), NaN)
    valid = np.flatnonzero(~np.isnan(x))
    if len(valid) < n:
        return out
    start = valid[0]
    seed = start + n - 1
    if np.isnan(x[start : seed + 1]).any():
        return out
    y = x[start : seed + 1].mean()
    out[seed] = y
    for i in range(seed + 1, len(x)):
        y = alpha * x[i] + (1 - alpha) * y
        out[i] = y
    return out


def ema(x: np.ndarray, n: int) -> np.ndarray:
    return _recursive(x, n, 2.0 / (n + 1))


def rma(x: np.ndarray, n: int) -> np.ndarray:
    """Wilder 平滑（TradingView ta.rma）。"""
    return _recursive(x, n, 1.0 / n)


def macd(close: np.ndarray, fast=12, slow=26, sig=9):
    line = ema(close, fast) - ema(close, slow)
    signal = ema(line, sig)
    return line, signal, line - signal


def rsi(close: np.ndarray, n=14) -> np.ndarray:
    d = np.diff(close, prepend=NaN)
    up = rma(np.where(np.isnan(d), NaN, np.maximum(d, 0.0)), n)
    dn = rma(np.where(np.isnan(d), NaN, np.maximum(-d, 0.0)), n)
    with np.errstate(divide="ignore", invalid="ignore"):
        r = 100 - 100 / (1 + up / dn)
    r = np.where(dn == 0, 100.0, r)
    r = np.where(up == 0, np.where(dn == 0, NaN, 0.0), r)
    return np.where(np.isnan(up) | np.isnan(dn), NaN, r)


def true_range(high, low, close) -> np.ndarray:
    prev = np.roll(close, 1)
    tr = np.maximum(high - low, np.maximum(np.abs(high - prev), np.abs(low - prev)))
    tr[0] = high[0] - low[0]
    return tr


def atr(high, low, close, n=14) -> np.ndarray:
    return rma(true_range(high, low, close), n)


def bollinger(close: np.ndarray, n=20, k=2.0):
    mid = sma(close, n)
    sd = np.full(len(close), NaN)
    for i in range(n - 1, len(close)):
        sd[i] = close[i - n + 1 : i + 1].std(ddof=0)  # 总体标准差
    upper, lower = mid + k * sd, mid - k * sd
    with np.errstate(divide="ignore", invalid="ignore"):
        width = (upper - lower) / mid
    return upper, lower, width


def supertrend(high, low, close, period=10, mult=3.0):
    """经典 SuperTrend（参考 KivancOzbilgic 的 Pine 实现，ATR 用 RMA）。返回 (line, dir)。"""
    a = atr(high, low, close, period)
    src = (high + low) / 2
    n = len(close)
    line = np.full(n, NaN)
    direction = np.full(n, NaN)
    up_prev = dn_prev = NaN
    trend = 1
    for i in range(n):
        if np.isnan(a[i]):
            continue
        up = src[i] - mult * a[i]
        dn = src[i] + mult * a[i]
        up1 = up if np.isnan(up_prev) else up_prev
        dn1 = dn if np.isnan(dn_prev) else dn_prev
        if i > 0 and close[i - 1] > up1:
            up = max(up, up1)
        if i > 0 and close[i - 1] < dn1:
            dn = min(dn, dn1)
        if trend == -1 and close[i] > dn1:
            trend = 1
        elif trend == 1 and close[i] < up1:
            trend = -1
        up_prev, dn_prev = up, dn
        direction[i] = trend
        line[i] = up if trend == 1 else dn
    return line, direction


def vol_ratio(volume: np.ndarray, n=20) -> np.ndarray:
    prev_mean = np.roll(sma(volume, n), 1)
    prev_mean[0] = NaN
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(prev_mean > 0, volume / prev_mean, NaN)


def obv(close: np.ndarray, volume: np.ndarray) -> np.ndarray:
    d = np.sign(np.diff(close, prepend=close[0]))
    return np.cumsum(d * volume)


def rolling_prev_max(x: np.ndarray, n: int) -> np.ndarray:
    """前 n 个值（不含当天）的最大值。"""
    out = np.full(len(x), NaN)
    for i in range(n, len(x)):
        out[i] = x[i - n : i].max()
    return out


def rolling_prev_min(x: np.ndarray, n: int) -> np.ndarray:
    out = np.full(len(x), NaN)
    for i in range(n, len(x)):
        out[i] = x[i - n : i].min()
    return out


def shift(x: np.ndarray, k: int) -> np.ndarray:
    out = np.full(len(x), NaN)
    if k < len(x):
        out[k:] = x[: len(x) - k]
    return out


def self_pct(x: np.ndarray, window=250, min_valid=120) -> np.ndarray:
    """1.1 节自身分位数：前 window 天（不含当天）中严格小于当天值的比例。"""
    out = np.full(len(x), NaN)
    for i in range(1, len(x)):
        if np.isnan(x[i]):
            continue
        w = x[max(0, i - window) : i]
        w = w[~np.isnan(w)]
        if len(w) >= min_valid:
            out[i] = (w < x[i]).sum() / len(w)
    return out


# 需要算自身分位数的指标
PCT_NAMES = ("rsi14", "bb_width", "vol_ratio", "tr_ratio", "ma50_dev", "ret20")


def compute_daily(o, h, l, c, v) -> dict[str, np.ndarray]:
    """计算第 2 节全部日线指标及所需分位数（键名 = indicators_daily.name，分位数为 name + '_pct'）。"""
    ind: dict[str, np.ndarray] = {}
    ind["sma20"], ind["sma50"], ind["sma200"] = sma(c, 20), sma(c, 50), sma(c, 200)
    ind["ema12"], ind["ema26"] = ema(c, 12), ema(c, 26)
    ind["macd"], ind["macd_signal"], ind["macd_hist"] = macd(c)
    ind["rsi14"] = rsi(c, 14)
    ind["atr14"] = atr(h, l, c, 14)
    ind["bb_upper"], ind["bb_lower"], ind["bb_width"] = bollinger(c)
    ind["st_line"], ind["st_dir"] = supertrend(h, l, c)
    ind["vol_ratio"] = vol_ratio(v)
    ind["obv"] = obv(c, v)
    tr = true_range(h, l, c)
    with np.errstate(divide="ignore", invalid="ignore"):
        ind["tr_ratio"] = tr / shift(ind["atr14"], 1)
        ind["ma50_dev"] = (c - ind["sma50"]) / ind["atr14"]
        ind["ret20"] = c / shift(c, 20) - 1
    ind["hi_52w"] = rolling_prev_max(h, 251)
    ind["lo_52w"] = rolling_prev_min(l, 251)
    for name in PCT_NAMES:
        ind[name + "_pct"] = self_pct(ind[name])
    return ind
