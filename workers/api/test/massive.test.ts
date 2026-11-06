import { describe, expect, it } from 'vitest';
import { MassiveClient, MassiveError, classifyError, parseGrouped, parseRange } from '../src/massive';

describe('massive', () => {
  it('错误分类（取自 2026-11-06 实测返回）', () => {
    expect(classifyError(403, "Attempted to request today's data before end of day. Please upgrade your plan")).toBe('not_yet');
    expect(classifyError(403, 'Attempted to request data past historical entitlements. Please upgrade your plan')).toBe('entitlement');
    expect(classifyError(429, 'You have exceeded the maximum requests per minute')).toBe('rate_limited');
    expect(classifyError(401, 'API Key was not provided')).toBe('auth');
    expect(classifyError(500, 'boom')).toBe('other');
  });

  it('Grouped Daily 解析：日期取请求日期，按股票池过滤', () => {
    const body = {
      results: [
        { T: 'AAPL', v: 75678945.18, vw: 346.67, o: 353.89, c: 344.17, h: 355.38, l: 342.06, t: 1793912400000, n: 1279039 },
        { T: 'ZZZZ', v: 1, o: 1, c: 1, h: 1, l: 1, t: 1793912400000 },
      ],
    };
    const bars = parseGrouped('2026-11-05', body, new Set(['AAPL']));
    expect(bars).toEqual([
      { ticker: 'AAPL', date: '2026-11-05', open: 353.89, high: 355.38, low: 342.06, close: 344.17, volume: 75678945.18, vwap: 346.67, trades: 1279039 },
    ]);
  });

  it('单股区间解析：t 为美东 0 点', () => {
    const bars = parseRange('AAPL', { results: [{ t: 1730869200000, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }] });
    expect(bars[0]?.date).toBe('2024-11-06');
    expect(bars[0]?.vwap).toBeNull();
  });

  it('客户端：Bearer 认证 + 403 转成 MassiveError', async () => {
    let auth = '';
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      auth = (init.headers as Record<string, string>).Authorization ?? '';
      return new Response(
        JSON.stringify({ status: 'NOT_AUTHORIZED', message: 'Attempted to request data past historical entitlements.' }),
        { status: 403 },
      );
    }) as unknown as typeof fetch;
    const c = new MassiveClient('k', 'https://x', fakeFetch);
    const err = await c.grouped('2020-01-02').catch((e) => e);
    expect(err).toBeInstanceOf(MassiveError);
    expect(err.kind).toBe('entitlement');
    expect(auth).toBe('Bearer k');
    expect(c.calls).toBe(1);
  });
});
