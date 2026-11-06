import { describe, expect, it } from 'vitest';
import { D1Shim, asD1 } from './d1-shim';
import { runTick } from '../src/ingest';
import { MassiveClient } from '../src/massive';
import type { Env } from '../src/env';

const HOLIDAY = '2024-11-28'; // 感恩节

function fakeMassive(log: string[], opts: { splitTicker?: string; rateLimitAfter?: number } = {}) {
  const fetchImpl = (async (url: string) => {
    const u = new URL(url);
    log.push(u.pathname);
    if (opts.rateLimitAfter !== undefined && log.length > opts.rateLimitAfter)
      return new Response(JSON.stringify({ status: 'ERROR', error: 'exceeded the maximum requests per minute' }), { status: 429 });
    let m = u.pathname.match(/grouped\/locale\/us\/market\/stocks\/(.+)$/);
    if (m) {
      const date = m[1]!;
      if (date === '2026-11-09')
        return new Response(JSON.stringify({ status: 'NOT_AUTHORIZED', message: "Attempted to request today's data before end of day." }), { status: 403 });
      if (date === HOLIDAY) return Response.json({ status: 'OK', resultsCount: 0 });
      const t = Date.parse(`${date}T21:00:00Z`);
      return Response.json({
        status: 'OK',
        results: [
          { T: 'AAPL', o: 1, h: 2, l: 0.5, c: 1.5, v: 100, t },
          { T: 'SPY', o: 5, h: 6, l: 4, c: 5.5, v: 1000, t },
          { T: 'NOTINPOOL', o: 1, h: 1, l: 1, c: 1, v: 1, t },
        ],
      });
    }
    if (u.pathname.startsWith('/v3/reference/splits'))
      return Response.json({ results: opts.splitTicker ? [{ ticker: opts.splitTicker, execution_date: u.searchParams.get('execution_date'), split_from: 1, split_to: 4 }, { ticker: 'NOTINPOOL' }] : [] });
    m = u.pathname.match(/\/v2\/aggs\/ticker\/([^/]+)\/range/);
    if (m)
      return Response.json({
        status: 'DELAYED',
        results: [
          { t: Date.parse('2026-11-05T05:00:00Z'), o: 10, h: 11, l: 9, c: 10.5, v: 7 },
          { t: Date.parse('2026-11-06T05:00:00Z'), o: 10, h: 11, l: 9, c: 10.5, v: 7 },
        ],
      });
    return new Response('nope', { status: 404 });
  }) as unknown as typeof fetch;
  return new MassiveClient('test', 'https://api.massive.com', fetchImpl);
}

const envFor = (s: D1Shim) => ({ DB: asD1(s), MAX_CALLS_PER_TICK: '4', MASSIVE_BASE_URL: '' }) as unknown as Env;

describe('定时拉取', () => {
  it('首次运行：同步股票池、排 2 年回补、从最旧日期开始每次 4 个请求', async () => {
    const s = new D1Shim();
    const log: string[] = [];
    const now = new Date('2026-11-06T11:40:00Z'); // 美东早上，不排当天
    const r = await runTick(envFor(s), now, fakeMassive(log));
    expect(r.universeSynced).toBe(true);
    expect(r.backfillSeeded).toBeGreaterThan(515);
    expect(r.dailyEnqueued).toBe(false);
    expect(r.calls).toBe(4);
    expect(r.jobs.map((j) => j.key)).toEqual(['2024-11-07', '2024-11-08', '2024-11-11', '2024-11-12']);
    // 只存股票池内的票
    expect(s.q('SELECT DISTINCT ticker FROM bars_daily ORDER BY ticker')).toEqual([{ ticker: 'AAPL' }, { ticker: 'SPY' }]);
    expect(s.q("SELECT COUNT(*) AS n FROM fetch_queue WHERE status = 'done'")).toEqual([{ n: 4 }]);
    expect(s.q('SELECT status FROM runs')).toEqual([{ status: 'ok' }]);
    // 已有股票不会再排单股回补
    expect(s.q("SELECT COUNT(*) AS n FROM fetch_queue WHERE kind = 'ticker'")).toEqual([{ n: 0 }]);
  });

  it('休市日标为 empty；429 时本轮停止并稍后重试', async () => {
    const s = new D1Shim();
    const log: string[] = [];
    const now = new Date('2026-11-06T11:40:00Z');
    await runTick(envFor(s), now, fakeMassive([], {})); // 先排队
    s.raw.exec(`UPDATE fetch_queue SET status = 'done' WHERE key < '2024-11-28'`);
    const r = await runTick(envFor(s), new Date(now.getTime() + 60_000), fakeMassive(log, { rateLimitAfter: 2 }));
    expect(r.jobs.map((j) => `${j.key}:${j.outcome}`)).toEqual(['2024-11-28:empty', '2024-11-29:done', '2024-12-02:rate_limited']);
    expect(r.calls).toBe(3);
    const [row] = s.q<{ status: string; attempts: number }>("SELECT status, attempts FROM fetch_queue WHERE key = '2024-12-02'");
    expect(row).toEqual({ status: 'pending', attempts: 0 });
  });

  it('收盘后排当天日线 + 拆股检查；当天数据未出时 15 分钟后重试；拆股触发整段重拉', async () => {
    const s = new D1Shim();
    const env = envFor(s);
    await runTick(env, new Date('2026-11-09T12:00:00Z'), fakeMassive([]));
    // 假设回补已全部完成（修复任务另测）
    s.raw.exec(`UPDATE fetch_queue SET status = 'done'`);
    s.raw.exec(`INSERT INTO app_state (key, value) VALUES ('repair_seeded_at', 'x')`);

    // 美东周一 16:45（EST = UTC-5）
    const at = new Date('2026-11-09T21:45:00Z');
    const r = await runTick(env, at, fakeMassive([], { splitTicker: 'AAPL' }));
    expect(r.dailyEnqueued).toBe(true);
    expect(r.jobs.map((j) => `${j.kind}:${j.key}:${j.outcome}`)).toEqual([
      'grouped:2026-11-09:not_yet',
      'splits:2026-11-09:done',
    ]);
    // 拆股重拉在下一轮执行
    const rs = await runTick(env, new Date(at.getTime() + 60_000), fakeMassive([]));
    expect(rs.jobs.map((j) => `${j.kind}:${j.key}:${j.outcome}`)).toEqual(['ticker:AAPL:done']);
    const [g] = s.q<{ next_attempt_at: string; attempts: number }>("SELECT next_attempt_at, attempts FROM fetch_queue WHERE key = '2026-11-09' AND kind = 'grouped'");
    expect(g).toEqual({ next_attempt_at: '2026-11-09T22:00:00Z', attempts: 0 });
    expect(s.q("SELECT date FROM bars_daily WHERE ticker = 'AAPL' AND date >= '2026-11-05' ORDER BY date")).toEqual([
      { date: '2026-11-05' },
      { date: '2026-11-06' },
    ]);
    expect(s.q('SELECT status FROM runs ORDER BY started_at DESC LIMIT 1')).toEqual([{ status: 'ok' }]);
    // 当天日线还没到，不排扫描；2 年回补的历史日期也不排
    expect(s.q('SELECT date FROM scan_queue')).toEqual([]);

    // 当天日线到了之后排入扫描
    s.raw.exec(`UPDATE fetch_queue SET next_attempt_at = '2026-11-09T00:00:00Z' WHERE kind = 'grouped' AND key = '2026-11-09'`);
    const okMassive = fakeMassive([]);
    (okMassive as unknown as { fetchImpl: typeof fetch }).fetchImpl = (async () =>
      Response.json({ status: 'OK', results: [{ T: 'AAPL', o: 1, h: 1, l: 1, c: 1, v: 1, t: 0 }] })) as unknown as typeof fetch;
    await runTick(env, new Date(at.getTime() + 90_000), okMassive);
    expect(s.q('SELECT date FROM scan_queue')).toEqual([{ date: '2026-11-09' }]);

    // 同一天不会重复排队
    const r2 = await runTick(env, new Date(at.getTime() + 120_000), fakeMassive([]));
    expect(r2.dailyEnqueued).toBe(false);
  });

  it('回补完成后，新加入的股票走单股回补', async () => {
    const s = new D1Shim();
    const env = envFor(s);
    await runTick(env, new Date('2026-11-06T11:40:00Z'), fakeMassive([]));
    s.raw.exec(`INSERT INTO tickers (ticker, name) VALUES ('NEWAI', 'New AI')`);
    s.raw.exec(`INSERT INTO ticker_sources (ticker, source) VALUES ('NEWAI', 'custom')`);

    // 回补未完成：不排
    await runTick(env, new Date('2026-11-06T11:41:00Z'), fakeMassive([]));
    expect(s.q("SELECT COUNT(*) AS n FROM fetch_queue WHERE kind = 'ticker'")).toEqual([{ n: 0 }]);

    s.raw.exec(`UPDATE fetch_queue SET status = 'done'`);
    s.raw.exec(`INSERT INTO app_state (key, value) VALUES ('repair_seeded_at', 'x')`);
    const r = await runTick(env, new Date('2026-11-06T11:42:00Z'), fakeMassive([]));
    expect(r.jobs).toEqual([{ kind: 'ticker', key: 'NEWAI', outcome: 'done', count: 2 }]);
    expect(s.q("SELECT history_checked_at IS NOT NULL AS ok FROM tickers WHERE ticker = 'NEWAI'")).toEqual([{ ok: 1 }]);
  });
});

describe('回补完成后的修复', () => {
  it('数据不满的股票排单股回补；单股任务独占一分钟的请求预算；混入的别家数据被删除并用旧代码补齐', async () => {
    const s = new D1Shim();
    const env = envFor(s);
    const now = new Date('2026-11-06T11:40:00Z');
    await runTick(env, now, fakeMassive([]));
    // 模拟回补完成：大部分股票满 2 天；BNY 只有 1 天且那天是别家证券的数据
    s.raw.exec(`UPDATE fetch_queue SET status = 'done'`);
    s.raw.exec(`DELETE FROM bars_daily`);
    s.raw.exec(`INSERT INTO bars_daily (ticker, date, open, high, low, close, volume)
                SELECT ticker, d, 1, 1, 1, 1, 1 FROM tickers, (SELECT '2026-11-04' AS d UNION SELECT '2026-11-05')
                WHERE active = 1 AND ticker <> 'BNY'`);
    s.raw.exec(`INSERT INTO bars_daily (ticker, date, open, high, low, close, volume) VALUES ('BNY', '2026-11-04', 9, 9, 9, 9, 9)`);

    const log: string[] = [];
    const fetchImpl = (async (url: string) => {
      const u = new URL(url);
      log.push(u.pathname);
      if (u.pathname === '/vX/reference/tickers/BNY/events')
        return Response.json({ status: 'OK', results: { events: [
          { type: 'ticker_change', date: '2026-11-05', ticker_change: { ticker: 'BNY' } },
          { type: 'ticker_change', date: '2007-07-02', ticker_change: { ticker: 'BK' } },
        ] } });
      const m = u.pathname.match(/\/v2\/aggs\/ticker\/([^/]+)\/range\/1\/day\/([^/]+)\/([^/]+)/);
      if (m?.[1] === 'BNY') return Response.json({ results: [
        { t: Date.parse('2026-11-04T05:00:00Z'), o: 9, h: 9, l: 9, c: 9, v: 9 }, // 改名前：别家证券
        { t: Date.parse('2026-11-05T05:00:00Z'), o: 100, h: 101, l: 99, c: 100, v: 5 },
      ] });
      if (m?.[1] === 'BK') {
        expect(m[3]).toBe('2026-11-04'); // 只补到改名前一天
        return Response.json({ results: [{ t: Date.parse('2026-11-04T05:00:00Z'), o: 98, h: 99, l: 97, c: 98, v: 4 }] });
      }
      return new Response(JSON.stringify({ status: 'NOT_FOUND' }), { status: 404 });
    }) as unknown as typeof fetch;

    const r = await runTick(env, new Date(now.getTime() + 60_000), new MassiveClient('k', 'https://api.massive.com', fetchImpl));
    expect(s.q("SELECT key FROM fetch_queue WHERE kind = 'ticker'")).toEqual([{ key: 'BNY' }]);
    expect(r.jobs).toEqual([{ kind: 'ticker', key: 'BNY', outcome: 'done', count: 2 }]);
    expect(log).toHaveLength(3); // 变更查询 + BNY + BK
    expect(s.q("SELECT date, close FROM bars_daily WHERE ticker = 'BNY' ORDER BY date")).toEqual([
      { date: '2026-11-04', close: 98 }, // 来自 BK
      { date: '2026-11-05', close: 100 },
    ]);
    // 只做一次
    await runTick(env, new Date(now.getTime() + 120_000), fakeMassive([]));
    expect(s.q("SELECT COUNT(*) AS n FROM fetch_queue WHERE kind = 'ticker'")).toEqual([{ n: 1 }]);
  });
});
