import { describe, expect, it } from 'vitest';
import { D1Shim, asD1 } from './d1-shim';
import { runScan, type ComputeFn, type ScanResult } from '../src/scan';
import { syncStaticUniverse } from '../src/universe';
import type { Env } from '../src/env';

const DATE = '2026-11-06';

function fakeCompute(calls: string[][]): ComputeFn {
  return async (payload) => {
    const p = payload as { as_of: string; tickers: { ticker: string; tier: string; d: string[] }[] };
    calls.push(p.tickers.map((t) => t.ticker));
    const results = p.tickers.map((t): ScanResult => {
      if (t.ticker === 'AAPL') return { ticker: 'AAPL', date: null, error: 'boom' };
      if (t.d.length === 0) return { ticker: t.ticker, date: null, skipped: '不足 60 根日线' };
      const bull = t.ticker === 'NVDA' || t.ticker === 'MSFT';
      return {
        ticker: t.ticker, date: p.as_of, spec: 'v1',
        indicators: [{ name: 'rsi14', value: 55.5, pct: 0.6 }],
        signals: [{ signal_id: 'T_ST_FLIP', direction: 'bull', timeframe: 'D', strength: 2, category: 'trend', date: p.as_of, detail: {} }],
        opportunity: ['NVDA', 'MSFT', 'XOM'].includes(t.ticker)
          ? {
              direction: bull ? 'bull' : 'bear', score: t.ticker === 'MSFT' ? 9 : 7, categories: ['trend', 'momentum', 'volume', 'position'],
              base: 7, weekly_bonus: 0, opposite_base: 0, divergent: false, weekly_state: 'up', dollar_vol20: 1e9, reasons: [],
            }
          : null,
      };
    });
    return { spec: 'v1', results };
  };
}

describe('每日扫描', () => {
  it('分批扫描全部股票、写入结果、排名、跳过基准 ETF，失败的单只不影响整体', async () => {
    const s = new D1Shim();
    const db = asD1(s);
    await syncStaticUniverse(db);
    for (const t of ['NVDA', 'MSFT', 'XOM', 'AAPL'])
      s.raw.exec(`INSERT INTO bars_daily (ticker, date, open, high, low, close, volume) VALUES ('${t}', '${DATE}', 1, 1, 1, 1, 1)`);
    s.raw.exec(`INSERT INTO bars_daily (ticker, date, open, high, low, close, volume) VALUES ('NVDA', '2026-11-09', 1, 1, 1, 1, 1)`); // 未来数据不应发出
    s.raw.exec(`INSERT INTO scan_queue (date) VALUES ('${DATE}')`);

    const calls: string[][] = [];
    const env = { DB: db } as unknown as Env;
    const r = await runScan(env, fakeCompute(calls));
    expect(r?.finished).toBe(true);
    const all = calls.flat();
    expect(all).toHaveLength(556); // 全部股票，不含 5 只基准 ETF
    expect(all).not.toContain('SPY');
    expect(calls[0]).toHaveLength(60);
    expect(r).toMatchObject({ scanned: 3, failed: 1 });

    expect(s.q('SELECT ticker, direction, rank FROM opportunities ORDER BY direction, rank')).toEqual([
      { ticker: 'XOM', direction: 'bear', rank: 1 },
      { ticker: 'MSFT', direction: 'bull', rank: 1 },
      { ticker: 'NVDA', direction: 'bull', rank: 2 },
    ]);
    expect(s.q("SELECT COUNT(*) AS n FROM signals WHERE date = ?", DATE)).toEqual([{ n: 3 }]);
    expect(s.q('SELECT status, scanned, failed, last_error FROM scan_queue')).toEqual([
      { status: 'done', scanned: 3, failed: 1, last_error: 'AAPL: boom' },
    ]);
    // 已完成不再重复扫描
    expect(await runScan(env, fakeCompute([]))).toBeNull();
  });

  it('时间预算用完时保存进度，下一分钟接着扫', async () => {
    const s = new D1Shim();
    const db = asD1(s);
    await syncStaticUniverse(db);
    s.raw.exec(`INSERT INTO scan_queue (date) VALUES ('${DATE}')`);
    let t = 0;
    const clock = () => (t += 25_000); // 每次调用前进 25 秒 → 一轮只跑 1 批
    const env = { DB: db } as unknown as Env;
    const r1 = await runScan(env, fakeCompute([]), clock);
    expect(r1).toMatchObject({ batches: 1, finished: false });
    const [q] = s.q<{ status: string; cursor: string }>('SELECT status, cursor FROM scan_queue');
    expect(q?.status).toBe('running');
    const calls: string[][] = [];
    t = 0;
    await runScan(env, fakeCompute(calls), clock);
    expect(calls[0]![0]! > q!.cursor).toBe(true);
  });

  it('扫描暂停开关', async () => {
    const s = new D1Shim();
    s.raw.exec(`INSERT INTO scan_queue (date) VALUES ('${DATE}')`);
    s.raw.exec(`INSERT INTO app_state (key, value) VALUES ('scan_paused', '1')`);
    expect(await runScan({ DB: asD1(s) } as unknown as Env, fakeCompute([]))).toBeNull();
  });
});
