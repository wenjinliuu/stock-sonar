# 部署与开通清单

所有构建、部署都在 GitHub Actions 里跑。下面是需要在 Cloudflare / GitHub 后台手动完成的步骤。

## P0 需要做的（按顺序）

| # | 在哪做 | 做什么 | 状态 |
| --- | --- | --- | --- |
| 1 | Cloudflare → Workers & Pages → Plans | 开通 **Workers Paid（5 美元/月）**。定时任务每次解析约 3 MB 的全市场日线 JSON，免费版每次只有 10 ms CPU 不够用；容器也必须付费版 | ☐ |
| 2 | Cloudflare → Billing → Notifications | 设账单提醒：超过 **8 美元**通知 | ☐ |
| 3 | Cloudflare → 账号 API Tokens → Create Token | 用 **Edit Cloudflare Workers** 模板，再加 **Account → D1 → Edit**（P1 部署容器时再加 **Containers → Edit**），账号范围只选自己的账号 | ☐ |
| 4 | GitHub → `stock-sonar` → Settings → Secrets and variables → Actions | 新建 3 个 Repository secret：`CLOUDFLARE_API_TOKEN`（第 3 步的 token）、`CLOUDFLARE_ACCOUNT_ID`（Cloudflare 首页右侧的 Account ID）、`MASSIVE_API_KEY`（Massive key；在 Claude 会话里填过的那份只在会话环境里有效，GitHub 需要单独再填一次） | ☐ |
| 5 | GitHub → Actions → Deploy → Run workflow | 手动跑一次部署（以后推送到 main 会自动部署）。部署完 1 分钟内定时任务开始：同步股票池 → 自动开始 2 年回补（约 2 小时） | ☐ |
| 6 | Cloudflare → Workers & Pages → `stock-sonar` → Settings → Domains & Routes | 在 `workers.dev` 一行点 **Enable Cloudflare Access**，再点 **Manage Cloudflare Access**，把策略改成只放行 `wenjinuu@gmail.com`（登录方式：邮箱一次性验证码） | ☐ |
| 7 | 手机浏览器打开 `https://stock-sonar.<你的子域>.workers.dev` | 用邮箱验证码登录，看到「数据状态」页；回补完成后「满 480 根的股票」应接近活跃股票数 | ☐ |

已由 Claude 完成：`/api/*` 额外校验 Access JWT（团队域名、AUD、允许邮箱写在 `workers/api/wrangler.jsonc` 的 vars 里，非机密；改了 Access 应用要同步更新）。

注意：Access 要选「生产和预览」，只选「仅预览」时正式网址仍是公开的。

已由 Claude 完成：D1 数据库 `stock-sonar` 已创建（APAC），ID 已写进 `workers/api/wrangler.jsonc`。

## 以后阶段再做

| 阶段 | 事项 |
| --- | --- |
| P1 | API token 加 **Containers → Edit**；手动跑 `Deploy compute container` |
| P2 | Twelve Data 免费 key → GitHub Secret `TWELVE_DATA_API_KEY`；Finnhub key → `FINNHUB_API_KEY` |
| P2 | 整理 AI 主题清单（`data/universe/ai.csv`） |
