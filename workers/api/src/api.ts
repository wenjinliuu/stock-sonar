// 只读 API。整个 workers.dev 域名由 Cloudflare Access 保护（只放行用户邮箱）。

import type { Env } from './env';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export async function apiRoutes(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
  const db = env.DB;
  const path = url.pathname;

  // 「重新登录」入口：未登录时被 Access 拦去登录，登录后回到首页
  if (path === '/api/login') return Response.redirect(new URL('/', url).toString(), 302);

  if (path === '/api/health') return json({ ok: true, time: new Date().toISOString() });

  if (path === '/api/status') {
    const [tiers, bars, coverage, queue, runs] = await db.batch([
      db.prepare('SELECT tier, active, COUNT(*) AS n FROM tickers GROUP BY tier, active'),
      db.prepare('SELECT COUNT(*) AS rows, COUNT(DISTINCT date) AS dates, MIN(date) AS first, MAX(date) AS last FROM bars_daily'),
      // 每只活跃股票的 K 线数量分布：P0 关口要求约 550 只都有约 500 根
      db.prepare(`
        SELECT
          SUM(CASE WHEN n >= 480 THEN 1 ELSE 0 END) AS full,
          SUM(CASE WHEN n > 0 AND n < 480 THEN 1 ELSE 0 END) AS partial,
          SUM(CASE WHEN n = 0 THEN 1 ELSE 0 END) AS none
        FROM (SELECT t.ticker, (SELECT COUNT(*) FROM bars_daily b WHERE b.ticker = t.ticker) AS n
              FROM tickers t WHERE t.active = 1)`),
      db.prepare('SELECT kind, status, COUNT(*) AS n FROM fetch_queue GROUP BY kind, status'),
      db.prepare('SELECT run_id, kind, started_at, status, error, stats_json FROM runs ORDER BY started_at DESC LIMIT 10'),
    ]);
    return json({
      tickers: tiers?.results,
      bars: bars?.results[0],
      coverage: coverage?.results[0],
      queue: queue?.results,
      runs: runs?.results,
    });
  }

  if (path === '/api/tickers') {
    const { results } = await db
      .prepare(
        `SELECT t.ticker, t.name, t.tier, t.tags, t.active,
                (SELECT GROUP_CONCAT(source) FROM ticker_sources s WHERE s.ticker = t.ticker) AS sources
         FROM tickers t ORDER BY t.ticker`,
      )
      .all();
    return json(results);
  }

  const m = path.match(/^\/api\/bars\/([^/]+)$/);
  if (m) {
    const ticker = decodeURIComponent(m[1] ?? '').toUpperCase();
    if (!TICKER_RE.test(ticker)) return json({ error: 'bad ticker' }, 400);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 500, 1), 1000);
    const { results } = await db
      .prepare(
        `SELECT date, open, high, low, close, volume FROM
           (SELECT * FROM bars_daily WHERE ticker = ? ORDER BY date DESC LIMIT ?) ORDER BY date`,
      )
      .bind(ticker, limit)
      .all();
    return json({ ticker, bars: results });
  }

  return json({ error: 'not found' }, 404);
}
