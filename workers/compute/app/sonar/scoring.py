"""第 5 节：有效期、分方向汇总、周线加分、反向扣分、入选门槛。"""
from __future__ import annotations

from dataclasses import dataclass

from .signals import BEAR, BULL, Event

ACTIVE_DAYS = {"D": 3, "W": 5}
MIN_CATEGORIES = {"core": 3, "extended": 4}
WEEKLY_BONUS_CAP = 3


@dataclass
class Opportunity:
    direction: str
    score: float
    categories: list[str]
    base: int
    weekly_bonus: int
    opposite_base: int
    divergent: bool  # 多空分歧
    weekly_state: str
    signals: list[Event]


def active_events(events: list[Event], t: int) -> list[Event]:
    """t 日有效的信号：同一 (ID, 方向) 只取最近一次。"""
    latest: dict[tuple[str, str], Event] = {}
    for e in events:
        if e.idx <= t and t - e.idx < ACTIVE_DAYS[e.timeframe]:
            k = (e.signal_id, e.direction)
            if k not in latest or e.idx > latest[k].idx:
                latest[k] = e
    return sorted(latest.values(), key=lambda e: (-e.idx, e.signal_id))


def score_day(events: list[Event], t: int, weekly_state: str, tier: str) -> Opportunity | None:
    act = active_events(events, t)
    if not act:
        return None
    by_dir = {d: [e for e in act if e.direction == d] for d in (BULL, BEAR)}
    base = {d: sum(e.strength for e in by_dir[d]) for d in by_dir}
    cats = {d: sorted({e.category for e in by_dir[d]}) for d in by_dir}
    aligned = {BULL: "up", BEAR: "down"}
    bonus = {
        d: min(WEEKLY_BONUS_CAP, sum(1 for e in by_dir[d] if e.timeframe == "D")) if weekly_state == aligned[d] else 0
        for d in by_dir
    }
    opp = {BULL: BEAR, BEAR: BULL}
    score = {d: base[d] + bonus[d] - 0.5 * base[opp[d]] for d in by_dir}
    # 定方向：综合分高者；相同则看类别数，再相同取看多
    d = max((BULL, BEAR), key=lambda x: (score[x], len(cats[x]), x == BULL))
    need = MIN_CATEGORIES.get(tier, MIN_CATEGORIES["extended"])
    if len(cats[d]) < need:
        return None
    return Opportunity(
        direction=d,
        score=score[d],
        categories=cats[d],
        base=base[d],
        weekly_bonus=bonus[d],
        opposite_base=base[opp[d]],
        divergent=len(cats[opp[d]]) >= 2,
        weekly_state=weekly_state,
        signals=by_dir[d],
    )
