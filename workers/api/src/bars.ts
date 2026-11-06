import type { Bar } from './massive';
import { chunkedInsert } from './db';

export function upsertBarsStmts(db: D1Database, bars: Bar[]): D1PreparedStatement[] {
  return chunkedInsert(
    db,
    'INSERT INTO bars_daily (ticker, date, open, high, low, close, volume, vwap, trades) VALUES',
    `ON CONFLICT (ticker, date) DO UPDATE SET open = excluded.open, high = excluded.high, low = excluded.low,
     close = excluded.close, volume = excluded.volume, vwap = excluded.vwap, trades = excluded.trades`,
    9,
    bars,
    (b) => [b.ticker, b.date, b.open, b.high, b.low, b.close, b.volume, b.vwap, b.trades],
  );
}
