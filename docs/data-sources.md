# 期权日报 / 研报日报数据（P0 待定事项调查，2026-11-06）

两套系统都在仓库 `wenjinliuu/ima-research-options`，与本项目同一个 Cloudflare 账号，可用 **Service Binding** 直接调用（不走公网）。

| 系统 | Worker | 存储 | 读数据的接口 | 认证 |
| --- | --- | --- | --- | --- |
| 期权日报 | `kzg-option-brief` | 自己的 KV（`KZG`） | `GET /report.json?date=YYYY-MM-DD`（不带 date 为最新一期） | `Authorization: Bearer <key>`；`GROK_KEY` 为只读级别的密钥 |
| 研报日报 | `ima-knowledge-mcp` | Durable Object（SQLite） | `GET /research/company/{代码}.json`（研报观点时间线）、`/research/companies.json`（有记录的公司列表） | 研报密钥（`REPORT_KEY` 或 `GROK_KEY`） |

## 期权日报 `report.json` 关键字段

每个美东交易日一期，收盘后约 2 小时生成。

- `picks[]`：重点票，`sym`、`dir`（偏多 / 偏空 / 方向不明）、`conf`（可信度 高/中/低）、`strength`、`kind`（财报、异动等）、`seg`（环节）、`why`、`url`。
- `data.ai.changed[]`：AI 链个股的期权数据面，`sym`、`activity`（强异动 等）、`volX`（成交量倍数）、`premX`（权利金倍数）、`cp` / `cpBase` / `cpDev`（Call/Put 比及偏离）、`leapToday` 等。
- `data.segments[]` / `data.layers[]`：按 AI 产业链环节 / 层汇总的热度。
- `watch[]`：观察名单（方向不明、财报后等）。

## 研报时间线（每家公司）

`views[]`：`org`（投行）、`date`、`rating`（上调 / 维持 / 下调 / 首次）、`rating_text`、`tp` / `tp_old`（新旧目标价）、`price`、`view`、`points[]`。

## P2 接入方案（草案，P2 开工时确认）

| 共振（docs/signals.md 第 5 节第 7 条） | 来源 | 判定 |
| --- | --- | --- |
| 期权同向 +3 | `picks[]` 中 t 或 t−1 日的同一代码 | `dir` 偏多 ↔ 看多、偏空 ↔ 看空；方向不明不算 |
| 研报同向 +2 | 近 7 天的 `views[]` | 看多：评级上调或 `tp > tp_old`；看空：评级下调或 `tp < tp_old` |

- 每天扫描前由主 Worker 通过 Service Binding 拉取，写入本项目 D1 的 `events` 表（`source` = options / research，`dedup_key` 防重复），个股页时间轴也读这张表。
- 需要的密钥：期权、研报各一把只读密钥，放 GitHub Secrets（`OPTION_KEY`、`RESEARCH_KEY`），部署时写入 Worker Secret。
- 期权池 / 研报覆盖股（计划书「股票池」核心池来源）：期权池 = 期权系统 `AI_CHAIN` 名单，已并入本项目 AI 清单；研报覆盖 = 近 30 天时间线里有记录的美股代码，P2 每天同步进 `ticker_sources`（source = research）。

## AI 产业链分类（已用于本项目 AI 清单）

两套系统共用同一分类：**8 层 → 环节 → core（龙头/主要受益）/ edge（相关）**。

| 层 | 环节 |
| --- | --- |
| 应用与端侧 | AI软件、端侧/机器人 |
| 模型与云 | 大模型/云、中概云、xAI |
| 算力租赁 | GPU/算力云 |
| 芯片 | GPU/加速器、定制ASIC、CPU、存储、晶圆代工、设备/材料、封装测试、设计软件 |
| 网络与光 | 光模块、交换/连接 |
| 服务器与数据中心 | AI服务器、PCB/覆铜板、电力/散热、数据中心/IDC |
| 能源 | 发电、电网设备、核能/铀、燃料电池、储能 |
| 原材料 | 铜/稀土 |

研报系统另有「医疗健康」层（AI 制药、mRNA、大药企、AI 诊断），暂未并入本项目 AI 清单。
