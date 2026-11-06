import { describe, expect, it } from 'vitest';
import { D1Shim, asD1 } from './d1-shim';
import { mergeUniverse, recomputeTiersStmt, syncStaticUniverse, type StaticUniverse } from '../src/universe';
import { STATIC_UNIVERSE } from '../src/universe.generated';

const small = (): StaticUniverse => ({
  sp500: [
    { ticker: 'AAPL', name: 'Apple Inc.', tags: [] },
    { ticker: 'XOM', name: 'Exxon Mobil', tags: [] },
  ],
  ndx100: [{ ticker: 'AAPL', name: 'Apple Inc.', tags: [] }],
  ai: [{ ticker: 'NVDA', name: 'Nvidia', tags: ['AI 算力'] }],
  benchmark: [{ ticker: 'SPY', name: 'SPDR S&P 500', tags: [] }],
});

describe('股票池', () => {
  it('仓库股票池：标普 500 ∪ 纳指 100 ∪ AI 清单 + 基准 ETF，约 560 只', () => {
    const m = mergeUniverse(STATIC_UNIVERSE);
    expect(STATIC_UNIVERSE.sp500.length).toBeGreaterThan(495);
    expect(STATIC_UNIVERSE.ndx100.length).toBeGreaterThanOrEqual(100);
    expect(m.size).toBeGreaterThan(550);
    expect(m.get('AAPL')?.sources).toEqual(['sp500', 'ndx100', 'ai']);
    expect(m.get('SPY')?.sources).toEqual(['benchmark']);
    expect(m.get('TSM')).toMatchObject({ sources: ['ai'], tags: ['芯片·晶圆代工'] });
    expect(m.get('NVDA')?.tags[0]).toBe('芯片·GPU/加速器');
  });

  it('同步：tier/active 推导、哈希不变时跳过、移出指数后停用', async () => {
    const s = new D1Shim();
    const db = asD1(s);
    expect((await syncStaticUniverse(db, small())).synced).toBe(true);
    const tiers = Object.fromEntries(s.q<{ ticker: string; tier: string }>('SELECT ticker, tier FROM tickers').map((r) => [r.ticker, r.tier]));
    expect(tiers).toEqual({ AAPL: 'extended', XOM: 'extended', NVDA: 'core', SPY: 'benchmark' });
    expect(s.q('SELECT tags FROM tickers WHERE ticker = ?', 'NVDA')[0]).toEqual({ tags: '["AI 算力"]' });

    expect((await syncStaticUniverse(db, small())).synced).toBe(false);

    // App 里手动加入 XOM（custom）后应升为核心池，且移出标普后仍保持活跃
    s.raw.exec("INSERT INTO ticker_sources (ticker, source) VALUES ('XOM', 'custom')");
    await recomputeTiersStmt(db).run();
    const u = small();
    u.sp500 = u.sp500.filter((e) => e.ticker !== 'XOM');
    u.ndx100 = [];
    u.sp500.push({ ticker: 'MSFT', name: 'Microsoft', tags: [] });
    await syncStaticUniverse(db, u);
    const rows = Object.fromEntries(
      s.q<{ ticker: string; tier: string; active: number }>('SELECT ticker, tier, active FROM tickers').map((r) => [r.ticker, `${r.tier}/${r.active}`]),
    );
    expect(rows).toEqual({ AAPL: 'extended/1', XOM: 'core/1', NVDA: 'core/1', SPY: 'benchmark/1', MSFT: 'extended/1' });

    // 彻底移除（无任何来源）→ 停用但保留历史
    u.sp500 = u.sp500.filter((e) => e.ticker !== 'MSFT');
    await syncStaticUniverse(db, u);
    expect(s.q('SELECT active FROM tickers WHERE ticker = ?', 'MSFT')[0]).toEqual({ active: 0 });
  });

  it('全量股票池能在 D1 参数上限内同步', async () => {
    const s = new D1Shim();
    await syncStaticUniverse(asD1(s));
    const [r] = s.q<{ n: number }>('SELECT COUNT(*) AS n FROM tickers WHERE active = 1');
    expect(r?.n).toBe(mergeUniverse(STATIC_UNIVERSE).size);
  });
});
