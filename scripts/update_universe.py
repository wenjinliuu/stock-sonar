"""从 Wikipedia 抓取标普 500、纳指 100 成分股，写入 data/universe/*.csv，
并重新生成 Worker 用的 workers/api/src/universe.generated.ts。

只在 GitHub Actions（或本地）运行，不从 Worker 直连（抓取型数据源约束）。
用法：
  python scripts/update_universe.py            # 抓取 + 生成
  python scripts/update_universe.py --gen-only # 只根据现有 CSV 重新生成 TS
"""
from __future__ import annotations

import csv
import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UNIVERSE_DIR = ROOT / "data" / "universe"
GENERATED_TS = ROOT / "workers" / "api" / "src" / "universe.generated.ts"

# 静态来源：由本脚本维护的 CSV。options / research / custom 三类来源由 Worker 运行时维护。
STATIC_SOURCES = ["sp500", "ndx100", "ai", "benchmark"]

UA = {"User-Agent": "stock-sonar-universe-sync/1.0"}


def _norm(sym: str) -> str:
    # Wikipedia 与 Massive 都用 "BRK.B" 写法；去掉空白，统一大写
    return sym.strip().upper().replace(" ", "")


def _read_tables(url: str):
    import pandas as pd
    import requests

    html = requests.get(url, headers=UA, timeout=30).text
    return pd.read_html(io.StringIO(html))


def fetch_sp500() -> list[tuple[str, str]]:
    tables = _read_tables("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies")
    df = next(t for t in tables if "Symbol" in t.columns and "Security" in t.columns)
    rows = [(_norm(s), str(n).strip()) for s, n in zip(df["Symbol"], df["Security"])]
    if not 490 <= len(rows) <= 520:
        raise SystemExit(f"标普 500 行数异常：{len(rows)}，Wikipedia 表结构可能变了")
    return rows


def fetch_ndx100() -> list[tuple[str, str]]:
    tables = _read_tables("https://en.wikipedia.org/wiki/List_of_NASDAQ-100_companies")
    df = None
    for t in tables:
        cols = {str(c) for c in t.columns}
        if "Ticker" in cols and ("Company" in cols or "Security" in cols):
            df = t
            break
    if df is None:
        raise SystemExit("找不到纳指 100 成分股表")
    name_col = "Company" if "Company" in df.columns else "Security"
    rows = [(_norm(s), str(n).strip()) for s, n in zip(df["Ticker"], df[name_col])]
    if not 98 <= len(rows) <= 105:
        raise SystemExit(f"纳指 100 行数异常：{len(rows)}")
    return rows


def write_csv(source: str, rows: list[tuple[str, str]]) -> None:
    path = UNIVERSE_DIR / f"{source}.csv"
    rows = sorted(set(rows))
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["ticker", "name"])
        w.writerows(rows)
    print(f"{source}: {len(rows)} 只 -> {path.relative_to(ROOT)}")


def read_csv(source: str) -> list[dict]:
    path = UNIVERSE_DIR / f"{source}.csv"
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as f:
        out = []
        for r in csv.DictReader(f):
            t = _norm(r.get("ticker") or "")
            if not t or t.startswith("#"):
                continue
            tags = [x.strip() for x in (r.get("tags") or "").split("|") if x.strip()]
            out.append({"ticker": t, "name": (r.get("name") or "").strip(), "tags": tags})
        return out


def generate_ts() -> None:
    data = {s: read_csv(s) for s in STATIC_SOURCES}
    body = json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True)
    GENERATED_TS.write_text(
        "// 由 scripts/update_universe.py 根据 data/universe/*.csv 自动生成，请勿手改。\n"
        "import type { StaticUniverse } from './universe';\n\n"
        f"export const STATIC_UNIVERSE: StaticUniverse = {body};\n",
        encoding="utf-8",
    )
    total = len({r["ticker"] for rows in data.values() for r in rows})
    print(f"生成 {GENERATED_TS.relative_to(ROOT)}：去重后 {total} 只")


def main() -> None:
    if "--gen-only" not in sys.argv:
        write_csv("sp500", fetch_sp500())
        write_csv("ndx100", fetch_ndx100())
    generate_ts()


if __name__ == "__main__":
    main()
