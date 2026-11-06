// 每日扫描：当天日线入库后，把股票分批发给 Python 计算容器，结果写回 D1。
// 规格见 docs/signals.md；容器接口见 workers/compute/app/server.py。

import type { Env } from './env';
import { chunkedInsert, getState } from './db';
import { nowIso } from './dates';

export const BATCH_SIZE = 60;
/** 单次定时任务里扫描最多花多少毫秒，超过就留给下一分钟 */
export const TICK_BUDGET_MS = 40_000;

interface ScanIndicator { name: string; value: number | null; pct: number | null }
interface ScanSignal {
  signal_id: string; direction: 'bull' | 'bear'; timeframe: 'D' | 'W'; strength: number;
  category: string; date: string; detail: unknown;
}
interface ScanOpportunity {
  direction: 'bull' | 'bear'; score: number; categories: string[]; base: number; weekly_bonus: number;
  opposite_base: number; divergent: boolean; weekly_state: string; dollar_vol20: number; reasons: ScanSignal[];
}
export interface ScanResult {
  ticker: string; date: string | null; spec?: string; skipped?: string; error?: string;
  indicators?: ScanIndicator[]; signals?: ScanSignal[]; opportunity?: ScanOpportunity | null;
}

export interface ScanQueueRow { date: string; status: string; cursor: string; scanned: number; failed: number }

/** 当天全市场日线入库后排入扫描（幂等） */
export function enqueueScanStmt(db: D1Database, date: string): D1PreparedStatement {
  return db.prepare('INSERT OR IGNORE INTO scan_queue (date) VALUES (?)').bind(date);
}

async function nextScan(db: D1Database): Promise<ScanQueueRow | null> {
  return db
    .prepare("SELECT date, status, cursor, scanned, failed FROM scan_queue WHERE status IN ('pending', 'running') ORDER BY date LIMIT 1")
    .first<ScanQueueRow>();
}

/** 读取一批股票的全部日线（截至 date），列式打包 */
async function loadBatch(db: D1Database, date: string, cursor: string) {
  const { results: tickers } = await db
    .prepare(
      `SELECT ticker, tier FROM tickers WHERE active = 1 AND tier IN ('core', 'extended') AND ticker > ?
       ORDER BY ticker LIMIT ?`,
    )
    .bind(cursor, BATCH_SIZE)
    .all<{ ticker: string; tier: string }>();
  if (tickers.length === 0) return [];
  const placeholders = tickers.map(() => '?').join(', ');
  const { results: bars } = await db
    .prepare(
      `SELECT ticker, date, open, high, low, close, volume FROM bars_daily
       WHERE ticker IN (${placeholders}) AND date <= ? ORDER BY ticker, date`,
    )
    .bind(...tickers.map((t) => t.ticker), date)
    .all<{ ticker: string; date: string; open: number; high: number; low: number; close: number; volume: number }>();
  const byTicker = new Map(tickers.map((t) => [t.ticker, { ticker: t.ticker, tier: t.tier, d: [] as string[], o: [] as number[], h: [] as number[], l: [] as number[], c: [] as number[], v: [] as number[] }]));
  for (const b of bars) {
    const t = byTicker.get(b.ticker)!;
    t.d.push(b.date); t.o.push(b.open); t.h.push(b.high); t.l.push(b.low); t.c.push(b.close); t.v.push(b.volume);
  }
  return [...byTicker.values()];
}

/** 把一批扫描结果写成 D1 语句（只写 date 当天的结果；数据没到 date 的股票跳过） */
export function resultStmts(db: D1Database, date: string, results: ScanResult[]): D1PreparedStatement[] {
  const ok = results.filter((r) => !r.error && !r.skipped && r.date === date);
  const indicators = ok.flatMap((r) => (r.indicators ?? []).map((i) => ({ ticker: r.ticker, ...i })));
  const signals = ok.flatMap((r) => (r.signals ?? []).map((s) => ({ ticker: r.ticker, ...s })));
  const opps = ok.filter((r) => r.opportunity).map((r) => ({ ticker: r.ticker, o: r.opportunity! }));
  return [
    ...chunkedInsert(
      db,
      'INSERT INTO indicators_daily (ticker, date, name, value, pct) VALUES',
      'ON CONFLICT (ticker, date, name) DO UPDATE SET value = excluded.value, pct = excluded.pct',
      5,
      indicators,
      (i) => [i.ticker, date, i.name, i.value, i.pct],
    ),
    ...chunkedInsert(
      db,
      'INSERT INTO signals (ticker, date, signal_id, direction, timeframe, strength, detail_json) VALUES',
      `ON CONFLICT (ticker, date, signal_id, timeframe) DO UPDATE SET direction = excluded.direction,
       strength = excluded.strength, detail_json = excluded.detail_json`,
      7,
      signals,
      (s) => [s.ticker, date, s.signal_id, s.direction, s.timeframe, s.strength, JSON.stringify(s.detail ?? {})],
    ),
    ...chunkedInsert(
      db,
      'INSERT INTO opportunities (date, ticker, score, direction, resonance, reasons_json, categories, detail_json) VALUES',
      `ON CONFLICT (date, ticker) DO UPDATE SET score = excluded.score, direction = excluded.direction,
       reasons_json = excluded.reasons_json, categories = excluded.categories, detail_json = excluded.detail_json`,
      8,
      opps,
      ({ ticker, o }) => [
        date, ticker, o.score, o.direction, '[]', JSON.stringify(o.reasons), JSON.stringify(o.categories),
        JSON.stringify({ base: o.base, weekly_bonus: o.weekly_bonus, opposite_base: o.opposite_base, divergent: o.divergent, weekly_state: o.weekly_state, dollar_vol20: o.dollar_vol20 }),
      ],
    ),
  ];
}

/** 第 5 节第 8 条排序：综合分 → 类别数 → 20 日成交额，按方向分别排名 */
export function rankStmt(db: D1Database, date: string): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE opportunities SET rank = (
         SELECT r FROM (
           SELECT ticker, ROW_NUMBER() OVER (
             PARTITION BY direction
             ORDER BY score DESC, json_array_length(categories) DESC, json_extract(detail_json, '$.dollar_vol20') DESC
           ) AS r FROM opportunities WHERE date = ?1
         ) x WHERE x.ticker = opportunities.ticker
       ) WHERE date = ?1`,
    )
    .bind(date);
}

export type ComputeFn = (payload: unknown) => Promise<{ spec: string; results: ScanResult[] }>;

export function computeViaBinding(env: Env): ComputeFn {
  return async (payload) => {
    if (!env.COMPUTE) throw new Error('COMPUTE 服务绑定未配置');
    const res = await env.COMPUTE.fetch('https://compute/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`compute ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  };
}

export interface ScanTickResult { date: string; batches: number; scanned: number; failed: number; finished: boolean }

/** 处理扫描队列：在时间预算内跑尽量多的批次 */
export async function runScan(env: Env, compute: ComputeFn, now = () => Date.now()): Promise<ScanTickResult | null> {
  const db = env.DB;
  if ((await getState(db, 'scan_paused')) === '1') return null;
  const job = await nextScan(db);
  if (!job) return null;
  const start = now();
  const out: ScanTickResult = { date: job.date, batches: 0, scanned: job.scanned, failed: job.failed, finished: false };
  if (job.status === 'pending') {
    // 重扫时先清掉当天旧结果
    await db.batch([
      db.prepare('DELETE FROM opportunities WHERE date = ?').bind(job.date),
      db.prepare('DELETE FROM signals WHERE date = ?').bind(job.date),
      db.prepare("UPDATE scan_queue SET status = 'running', started_at = ?, cursor = '', scanned = 0, failed = 0 WHERE date = ?").bind(nowIso(), job.date),
    ]);
    job.cursor = '';
    out.scanned = out.failed = 0;
  }
  let cursor = job.cursor;
  while (now() - start < TICK_BUDGET_MS) {
    const batch = await loadBatch(db, job.date, cursor);
    if (batch.length === 0) {
      await db.batch([
        rankStmt(db, job.date),
        db.prepare("UPDATE scan_queue SET status = 'done', finished_at = ? WHERE date = ?").bind(nowIso(), job.date),
      ]);
      out.finished = true;
      break;
    }
    const resp = await compute({ as_of: job.date, tickers: batch });
    const failed = resp.results.filter((r) => r.error).length;
    const scanned = resp.results.filter((r) => !r.error && !r.skipped && r.date === job.date).length;
    cursor = batch[batch.length - 1]!.ticker;
    out.batches++;
    out.scanned += scanned;
    out.failed += failed;
    const errs = resp.results.filter((r) => r.error).map((r) => `${r.ticker}: ${r.error}`).join('\n').slice(0, 1000) || null;
    await db.batch([
      ...resultStmts(db, job.date, resp.results),
      db
        .prepare('UPDATE scan_queue SET cursor = ?, scanned = scanned + ?, failed = failed + ?, spec = ?, last_error = COALESCE(?, last_error) WHERE date = ?')
        .bind(cursor, scanned, failed, resp.spec, errs, job.date),
    ]);
  }
  return out;
}
