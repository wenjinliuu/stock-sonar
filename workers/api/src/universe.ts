// 股票池：静态来源（仓库 CSV → universe.generated.ts）在每次部署后由定时任务同步进 D1。
// 运行时来源（options / research / custom）由各自的同步逻辑写 ticker_sources，不受这里影响。

import { chunkedInsert, getState, setStateStmt } from './db';
import { STATIC_UNIVERSE } from './universe.generated';

export const STATIC_SOURCES = ['sp500', 'ndx100', 'ai', 'benchmark'] as const;
export type StaticSource = (typeof STATIC_SOURCES)[number];

/** 进入核心池的来源（其余为扩展池；只有 benchmark 来源的为基准） */
export const CORE_SOURCES = ['ai', 'options', 'research', 'custom'];

export interface UniverseEntry {
  ticker: string;
  name: string;
  tags: string[];
}
export type StaticUniverse = Record<StaticSource, UniverseEntry[]>;

interface Merged {
  name: string;
  tags: string[];
  sources: StaticSource[];
}

export function mergeUniverse(u: StaticUniverse): Map<string, Merged> {
  const m = new Map<string, Merged>();
  for (const source of STATIC_SOURCES) {
    for (const e of u[source] ?? []) {
      const cur = m.get(e.ticker) ?? { name: '', tags: [], sources: [] };
      if (!cur.name && e.name) cur.name = e.name;
      for (const t of e.tags) if (!cur.tags.includes(t)) cur.tags.push(t);
      if (!cur.sources.includes(source)) cur.sources.push(source);
      m.set(e.ticker, cur);
    }
  }
  return m;
}

/** 简单稳定哈希（FNV-1a），用来判断仓库里的股票池是否变了 */
export function hashUniverse(u: StaticUniverse): string {
  const s = JSON.stringify(u);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** 根据 ticker_sources 重新推导 tier 与 active */
export function recomputeTiersStmt(db: D1Database): D1PreparedStatement {
  const core = CORE_SOURCES.map((s) => `'${s}'`).join(', ');
  return db.prepare(`
    UPDATE tickers SET
      active = EXISTS (SELECT 1 FROM ticker_sources s WHERE s.ticker = tickers.ticker),
      tier = CASE
        WHEN EXISTS (SELECT 1 FROM ticker_sources s WHERE s.ticker = tickers.ticker AND s.source IN (${core})) THEN 'core'
        WHEN EXISTS (SELECT 1 FROM ticker_sources s WHERE s.ticker = tickers.ticker AND s.source IN ('sp500', 'ndx100')) THEN 'extended'
        WHEN EXISTS (SELECT 1 FROM ticker_sources s WHERE s.ticker = tickers.ticker AND s.source = 'benchmark') THEN 'benchmark'
        ELSE tier
      END,
      updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`);
}

/** 若仓库股票池有变化则同步进 D1（整批在一个事务里）。返回是否执行了同步。 */
export async function syncStaticUniverse(
  db: D1Database,
  universe: StaticUniverse = STATIC_UNIVERSE,
): Promise<{ synced: boolean; tickers: number }> {
  const hash = hashUniverse(universe);
  if ((await getState(db, 'universe_hash')) === hash) return { synced: false, tickers: 0 };

  const merged = [...mergeUniverse(universe).entries()];
  const placeholders = STATIC_SOURCES.map(() => '?').join(', ');
  const stmts: D1PreparedStatement[] = [
    ...chunkedInsert(
      db,
      'INSERT INTO tickers (ticker, name, tags) VALUES',
      `ON CONFLICT (ticker) DO UPDATE SET
         name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE tickers.name END,
         tags = CASE WHEN tickers.tags = '[]' THEN excluded.tags ELSE tickers.tags END`,
      3,
      merged,
      ([t, m]) => [t, m.name, JSON.stringify(m.tags)],
    ),
    db.prepare(`DELETE FROM ticker_sources WHERE source IN (${placeholders})`).bind(...STATIC_SOURCES),
    ...chunkedInsert(
      db,
      'INSERT INTO ticker_sources (ticker, source) VALUES',
      '',
      2,
      merged.flatMap(([t, m]) => m.sources.map((s) => [t, s] as const)),
      (r) => [...r],
    ),
    recomputeTiersStmt(db),
    setStateStmt(db, 'universe_hash', hash),
  ];
  await db.batch(stmts);
  return { synced: true, tickers: merged.length };
}
