# stock-sonar（个股声呐）· Claude Code 工作说明

## 先读这些
1. `docs/plan.md` —— 项目计划书。其中「已确定的决策」表是最终依据，开发中不再重新讨论；要改先问用户，再改表。
2. `design/` —— 设计稿源文件（Design canvas 的 `.dc.html`，在线版见 plan.md 顶部链接）。前端照它的布局和配色实现。

## 沟通
- 一律用简体中文回复和写注释说明；代码、命令、专有名词保留英文。
- 用户在手机上用 Claude Code 云端会话开发，没有 Mac、不在本地跑命令：所有构建、测试、部署都走 GitHub Actions / Cloudflare 自动部署。
- 按阶段推进（P0 → P4），每期达到 plan.md 里的「关口」再进入下一期；每期结束时简短汇报做了什么、关口是否达成。

## 硬性约束
- 全部部署在 Cloudflare Workers Paid（5 美元/月）。不引入需要常驻服务器的方案。
- Python 计算放 Cloudflare Containers，必须设置 `sleepAfter` 自动休眠。
- 数据存 D1；KV 只做缓存（KV 写入贵）。
- 只做美股；第一版纯规则，不调用大模型。
- 不做交易、不做盘中实时行情。
- 密钥（Massive / Twelve Data / Finnhub key 等）只用 `wrangler secret` 或 GitHub Secrets，绝不提交进仓库。
- 网页用 Cloudflare Access 保护（只放行用户邮箱）。
- 抓取型数据源（yfinance、AkShare）只在 GitHub Actions 里跑，不从 Worker 直连。

## 信号与指标
- 阈值按每只股票自己近 250 个交易日的分位数，不用全市场固定值。
- 不用回测反复调参；信号历史表现只做展示。
- 指标选 TradingView 热门开源指标 + 基础指标；不做神奇九转、缠论、筹码分布。
- 同一指标 Python（信号）与 TypeScript（图表）各一份实现，用固定样本数据做 golden test 保证一致。
- 移植开源指标时在 `docs/indicator-licenses.md` 记录来源和许可证。

## 视觉（详见 plan.md「UI 设计」）
- 专业交易软件风，配色参考币安亮色：白底、无悬浮卡片、细分隔线、高信息密度。
- 绿涨红跌：K 线 `#2EBD85` / `#F6465D`，文字 `#03A66D` / `#CF304A`；选中标签页黄色下划线 `#F0B90B`，主按钮 `#FCD535`。

## 提交
- 小步提交，提交信息用中文简要说明。
- 不确定、会花钱、或不可逆的操作（开通付费服务、删数据、改决策表）先问用户。
