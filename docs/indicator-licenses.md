# 指标来源与许可证

移植任何开源指标（Pine Script 等）到 Python / TypeScript 时，在此逐条登记。自用无碍；以后若对外提供，需按各自许可证处理。

| 指标 | 作者 | 原始链接 | 许可证 | 移植位置（Python / TS） | 登记日期 |
| --- | --- | --- | --- | --- | --- |
| SuperTrend | KivancOzbilgic（经典算法源自 Olivier Seban） | https://www.tradingview.com/script/r6dAP7yi/ | TradingView 开源脚本，MPL-2.0（以脚本页声明为准） | `workers/compute/app/sonar/indicators.py` `supertrend()`；TS 版 P2 | 2026-11-06 |
| RSI / MACD / ATR / 布林带 / OBV | 公有领域的经典公式（Wilder、Appel、Bollinger、Granville） | — | 无限制 | `workers/compute/app/sonar/indicators.py` | 2026-11-06 |
