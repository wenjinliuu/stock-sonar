# stock-sonar · 个股声呐

自用的美股技术面扫描工具：每天收盘后自动计算技术指标，结合期权日报和研报数据，输出「今日机会清单」，高分共振时推送到手机。

- 项目计划书：[`docs/plan.md`](docs/plan.md)
- 设计稿源文件：[`design/`](design/)
- Claude Code 工作说明：[`CLAUDE.md`](CLAUDE.md)
- 日线数据管线：[`docs/data-pipeline.md`](docs/data-pipeline.md)
- 部署与开通清单：[`docs/setup.md`](docs/setup.md)

技术栈：Cloudflare Workers + D1 + Containers（Python）· React + Vite PWA · KLineChart · SwiftUI（iOS）

## 目录

```
apps/web/            React + Vite PWA（由主 Worker 以静态资源托管）
workers/api/         主 Worker：/api/*、每分钟定时拉取日线、托管前端
workers/compute/     Python 计算容器（Cloudflare Containers，sleepAfter 自动休眠）
db/migrations/       D1 建表迁移
data/universe/       股票池 CSV（标普 500、纳指 100、AI 主题、基准 ETF）
scripts/             维护脚本（成分股同步等，只在 GitHub Actions 跑）
.github/workflows/   CI、自动部署、成分股季度同步
```

## 常用命令（在 GitHub Actions 里跑，本地可选）

```bash
npm ci
npm run typecheck && npm test && npm run build
npm run universe:gen      # 改了 data/universe/*.csv 后重新生成
```
