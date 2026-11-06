import { describe, expect, it } from 'vitest';
import { oldSegments, validFrom } from '../src/history';

// 变更记录取自 2026-11-06 Massive 实测
const WS = '2024-11-07';

describe('代码变更处理', () => {
  it('BNY：2026-05-21 起才是纽约梅隆，之前用 BK 补', () => {
    const ch = [{ date: '2026-05-21', ticker: 'BNY' }, { date: '2007-07-02', ticker: 'BK' }];
    expect(validFrom('BNY', ch, WS)).toBe('2026-05-21');
    expect(oldSegments('BNY', ch, WS, '2026-05-21')).toEqual([{ symbol: 'BK', from: WS, to: '2026-05-20' }]);
  });

  it('SPCX：2026-06-12 上市，之前的同代码数据全部丢弃', () => {
    const ch = [{ date: '2026-06-12', ticker: 'SPCX' }];
    expect(validFrom('SPCX', ch, WS)).toBe('2026-06-12');
    expect(oldSegments('SPCX', ch, WS, '2026-06-12')).toEqual([]);
  });

  it('FISV：变更记录缺最近一次（只到 FI），按当前代码最早数据之前用 FI 补', () => {
    const ch = [{ date: '2023-06-07', ticker: 'FI' }, { date: '2003-09-10', ticker: 'FISV' }];
    expect(validFrom('FISV', ch, WS)).toBe(WS);
    expect(oldSegments('FISV', ch, WS, '2025-11-11')).toEqual([{ symbol: 'FI', from: WS, to: '2025-11-10' }]);
  });

  it('ECHO：多次改名只回溯窗口内需要的', () => {
    const ch = [
      { date: '2026-06-24', ticker: 'ECHO' },
      { date: '2008-01-02', ticker: 'SATS' },
      { date: '2007-12-31', ticker: 'SATSV' },
    ];
    expect(oldSegments('ECHO', ch, WS, '2026-06-24')).toEqual([{ symbol: 'SATS', from: WS, to: '2026-06-23' }]);
  });

  it('无变更记录：不删不补', () => {
    expect(validFrom('AAPL', [], WS)).toBe(WS);
    expect(oldSegments('AAPL', [], WS, WS)).toEqual([]);
  });
});
