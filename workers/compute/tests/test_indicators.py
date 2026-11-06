import datetime as dt

import numpy as np

from sonar import indicators as I
from sonar.weekly import completed_week_index, resample_weekly

nan = np.nan


def eq(a, b):
    np.testing.assert_allclose(np.asarray(a, float), np.asarray(b, float), rtol=1e-12, equal_nan=True)


def test_sma_and_nan():
    eq(I.sma(np.array([1, 2, 3, 4.0]), 2), [nan, 1.5, 2.5, 3.5])
    eq(I.sma(np.array([nan, 2, 3, 4.0]), 2), [nan, nan, 2.5, 3.5])


def test_ema_seeded_with_sma():
    x = np.array([1, 2, 3, 4, 5.0])
    # n=3：首值 = (1+2+3)/3 = 2，α = 0.5
    eq(I.ema(x, 3), [nan, nan, 2, 3, 4])


def test_rma_wilder():
    x = np.array([2, 4, 6, 8.0])
    eq(I.rma(x, 2), [nan, 3, 4.5, 6.25])


def test_rsi_all_up_is_100():
    r = I.rsi(np.arange(1, 30, dtype=float), 14)
    assert np.isnan(r[13]) and r[14] == 100 and r[-1] == 100


def test_true_range_uses_prev_close():
    h, l, c = np.array([10, 12.0]), np.array([9, 11.5]), np.array([9.5, 12.0])
    eq(I.true_range(h, l, c), [1, 2.5])


def test_bollinger_population_std():
    up, lo, w = I.bollinger(np.array([1, 2, 3.0]), 3, 2)
    sd = np.std([1, 2, 3])
    assert np.isclose(up[2], 2 + 2 * sd) and np.isclose(lo[2], 2 - 2 * sd)


def test_self_pct_excludes_today():
    x = np.arange(200, dtype=float)
    p = I.self_pct(x, window=250, min_valid=120)
    assert np.isnan(p[119]) and p[120] == 1.0  # 前 120 个都更小
    x2 = np.concatenate([np.arange(150.0), [-1.0]])
    assert I.self_pct(x2)[-1] == 0.0


def test_supertrend_flips():
    up = np.linspace(100, 150, 40)
    down = np.linspace(150, 90, 40)
    c = np.concatenate([up, down])
    h, l = c + 1, c - 1
    _, d = I.supertrend(h, l, c, 10, 3)
    assert d[30] == 1 and d[-1] == -1


def test_weekly_completion_rule():
    days = [dt.date(2026, 11, 2) + dt.timedelta(days=k) for k in range(12) if (dt.date(2026, 11, 2) + dt.timedelta(days=k)).weekday() < 5]
    ones = np.ones(len(days))
    keys, last, *_ = resample_weekly(days, ones, ones, ones, ones, ones)
    cw = completed_week_index(days, keys)
    # 第一周周一至周四：没有走完的周；周五起第一周走完；第二周周一仍指向第一周
    assert list(cw[:4]) == [-1] * 4 and cw[4] == 0 and cw[5] == 0
