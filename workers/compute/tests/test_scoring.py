from sonar.scoring import active_events, score_day
from sonar.signals import Event


def ev(idx, sid, d, strength=1, tf="D"):
    return Event(idx, sid, d, tf, strength)


def test_active_window_and_dedup():
    es = [ev(0, "M_MACD_CROSS", "bull"), ev(7, "M_MACD_CROSS", "bull"), ev(10, "W_ST_FLIP", "bull", 3, "W")]
    assert [e.idx for e in active_events(es, 9)] == [7]  # 日线 3 天：7,8,9 有效
    assert [e.idx for e in active_events(es, 10)] == [10]  # 7 已过期（10−7 = 3）
    assert [e.idx for e in active_events(es, 14)] == [10]  # 周线 5 天有效
    assert active_events(es, 15) == []


def test_thresholds_bonus_and_penalty():
    es = [
        ev(10, "T_ST_FLIP", "bull", 2),
        ev(10, "M_MACD_CROSS", "bull", 1),
        ev(9, "VOL_BREAKOUT", "bull", 2),
        ev(10, "M_RSI_HIGH", "bear", 1),
    ]
    o = score_day(es, 10, "up", "core")
    assert o and o.direction == "bull" and o.categories == ["momentum", "trend", "volume"]
    # 基础 5 + 周线同向 3（3 个日线信号）− 反向 0.5×1
    assert o.score == 7.5 and o.weekly_bonus == 3 and not o.divergent
    assert score_day(es, 10, "up", "extended") is None  # 扩展池要 4 类
    assert score_day(es, 10, "down", "core").score == 4.5  # 周线反向：不加分
