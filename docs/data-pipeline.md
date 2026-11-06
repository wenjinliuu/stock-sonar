# 日线数据管线（P0）

## Massive 免费版实测（2026-11-06）

| 项目 | 结果 |
| --- | --- |
| Grouped Daily `/v2/aggs/grouped/locale/us/market/stocks/{date}` | ✅ 可用，一次返回约 1.27 万只（含 ETF），股票池 518 只全部覆盖 |
| 历史窗口 | 「今天往前滚动 2 年」：2024-11-06 可取，2024-11-05 返回 403 `past historical entitlements` |
| 当天数据 | 收盘前返回 403 `before end of day`，收盘后可取 |
| 休市日 | 200，`resultsCount: 0` |
| 单股区间 `/v2/aggs/ticker/{T}/range/1/day/{from}/{to}` | ✅ 可用，一次取完 2 年（约 500 根），`status: DELAYED` |
| 拆股 `/v3/reference/splits` | ✅ 可用 |
| 认证 | `Authorization: Bearer <key>` |
| 成交量 | 可能带小数，D1 用 REAL 存 |

## 流程

主 Worker 每分钟一次 cron（`workers/api/src/ingest.ts`）：

1. **股票池同步**：仓库 `data/universe/*.csv` → `universe.generated.ts`，哈希变化时写入 `tickers` / `ticker_sources`，重算 tier 与 active。
2. **首次回补排队**：把 `[今天−2年+1天, 昨天]` 的全部工作日排进 `fetch_queue`（约 520 条），按日期从旧到新执行（越早的越先过期）。
3. **每日排队**：美东工作日 16:30 之后，排当天全市场日线 + 当天拆股检查 + 最近 5 个工作日补漏。
4. **新股票**：回补完成后，`history_checked_at` 为空的活跃股票排单股 2 年回补。
5. **执行**：每分钟最多 4 个请求（免费版 5 次/分钟）。全市场日线只保存股票池内的票。

| 情况 | 处理 |
| --- | --- |
| 当天数据未出 | 15 分钟后重试，不计失败次数 |
| 超出历史权限 | 标记 `skipped` |
| 429 限流 / key 无效 | 本轮停止，2 / 30 分钟后重试 |
| 其他错误 | 指数退避，8 次后标记 `error` |
| 拆股 | 拆股检查命中股票池 → 该股整段复权重拉 |

2 年回补约 520 个请求 ÷ 4 次/分钟 ≈ **2 小时**，部署后自动开始，无需手动触发。

进度看 `/api/status` 或网页首页（P0 状态页）。

## 股票池维护

- 标普 500 / 纳指 100：`.github/workflows/universe.yml` 每季度从 Wikipedia 抓取，有变化自动提交并部署。
- AI 主题：编辑 `data/universe/ai.csv`（`ticker,name,tags`，多个标签用 `|` 分隔），然后运行 `npm run universe:gen` 并提交（或让 Claude Code 代劳）。
- 基准 ETF（SPY、QQQ 等，只做相对强度参照）：`data/universe/benchmark.csv`。
- 期权池、研报覆盖、App 内手动添加：运行时写入 `ticker_sources`（P2 实现）。
