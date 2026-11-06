// 每分钟定时任务：同步股票池 → 排队（回补 / 当天日线 / 新股票）→ 执行最多 N 个 Massive 请求。

import type { Env } from './env';
import { addDays, addYears, etClock, etDate, nowIso, previousWeekdays, weekdaysBetween } from './dates';
import { chunkedInsert, getState, setStateStmt } from './db';
import { upsertBarsStmts } from './bars';
import { MassiveClient, MassiveError } from './massive';
import { PRIORITY, claimJobs, enqueueStmt, finishStmt, requeueStmt, retryStmt, type Job } from './queue';
import { syncStaticUniverse } from './universe';
import { fetchTickerHistory } from './history';
import { enqueueScanStmt } from './scan';

/** 美东 16:30 之后把当天日线排进队列（免费版收盘后才能取，取不到会每 15 分钟重试） */
export const DAILY_ENQUEUE_AFTER_MIN = 16 * 60 + 30;
const MAX_ATTEMPTS = 8;
const JOB_COST: Record<Job['kind'], number> = { grouped: 1, splits: 1, ticker: 4 };

/** 免费版历史窗口是「今天往前滚动 2 年」，留 1 天余量 */
export function historyStart(today: string): string {
  return addDays(addYears(today, -2), 1);
}

export interface TickResult {
  universeSynced: boolean;
  backfillSeeded: number;
  dailyEnqueued: boolean;
  jobs: { kind: string; key: string; outcome: string; count?: number; error?: string }[];
  calls: number;
}

async function seedBackfill(db: D1Database, now: Date): Promise<number> {
  if (await getState(db, 'backfill_seeded_at')) return 0;
  const today = etDate(now);
  const dates = weekdaysBetween(historyStart(today), addDays(today, -1));
  await db.batch([
    ...chunkedInsert(
      db,
      'INSERT OR IGNORE INTO fetch_queue (kind, key, priority, next_attempt_at) VALUES',
      '',
      4,
      dates,
      (d) => ['grouped', d, PRIORITY.backfill, nowIso(now)],
    ),
    // 当前池子里的股票都会被全市场回补覆盖；之后新加入的走单股回补
    db.prepare('UPDATE tickers SET history_checked_at = ? WHERE active = 1').bind(nowIso(now)),
    setStateStmt(db, 'backfill_seeded_at', nowIso(now)),
  ]);
  return dates.length;
}

async function enqueueDaily(db: D1Database, now: Date): Promise<boolean> {
  const clock = etClock(now);
  if (clock.weekday < 1 || clock.weekday > 5 || clock.minutes < DAILY_ENQUEUE_AFTER_MIN) return false;
  if ((await getState(db, 'daily_enqueued_for')) === clock.date) return false;
  const floor = historyStart(clock.date);
  await db.batch([
    enqueueStmt(db, 'grouped', clock.date, PRIORITY.dailyGrouped, now),
    enqueueStmt(db, 'splits', clock.date, PRIORITY.splits, now),
    // 补漏：最近 5 个工作日若缺失（例如定时任务停过）则补上；已存在的会被忽略
    ...previousWeekdays(clock.date, 5)
      .filter((d) => d >= floor)
      .map((d) => enqueueStmt(db, 'grouped', d, PRIORITY.gapFill, now)),
    setStateStmt(db, 'daily_enqueued_for', clock.date),
  ]);
  return true;
}

/** 全市场回补排完后，给还没有历史的新股票排单股回补 */
function enqueueNewTickersStmt(db: D1Database, now: Date): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO fetch_queue (kind, key, priority, next_attempt_at)
       SELECT 'ticker', ticker, ?, ? FROM tickers
       WHERE active = 1 AND history_checked_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM fetch_queue WHERE kind = 'grouped' AND status = 'pending' AND priority = ?)`,
    )
    .bind(PRIORITY.newTicker, nowIso(now), PRIORITY.backfill);
}

async function seedRepair(db: D1Database, now: Date): Promise<boolean> {
  if (await getState(db, 'repair_seeded_at')) return false;
  const pending = await db
    .prepare("SELECT 1 FROM fetch_queue WHERE kind = 'grouped' AND status = 'pending' AND priority = ? LIMIT 1")
    .bind(PRIORITY.backfill)
    .first();
  if (pending) return false;
  await db.batch([
    db
      .prepare(
        `INSERT INTO fetch_queue (kind, key, priority, next_attempt_at)
         SELECT 'ticker', t.ticker, ?, ? FROM tickers t
         WHERE t.active = 1
           AND (SELECT COUNT(*) FROM bars_daily b WHERE b.ticker = t.ticker)
             < (SELECT COUNT(DISTINCT date) FROM bars_daily)
         ON CONFLICT (kind, key) DO UPDATE SET status = 'pending', attempts = 0,
           priority = excluded.priority, next_attempt_at = excluded.next_attempt_at`,
      )
      .bind(PRIORITY.splitRefetch, nowIso(now)),
    setStateStmt(db, 'repair_seeded_at', nowIso(now)),
  ]);
  return true;
}

async function activeTickers(db: D1Database): Promise<Set<string>> {
  const { results } = await db.prepare('SELECT ticker FROM tickers WHERE active = 1').all<{ ticker: string }>();
  return new Set(results.map((r) => r.ticker));
}

async function runJob(
  db: D1Database,
  client: MassiveClient,
  job: Job,
  now: Date,
  getActive: () => Promise<Set<string>>,
): Promise<{ outcome: string; count: number }> {
  const today = etDate(now);
  if (job.kind === 'grouped') {
    const bars = await client.grouped(job.key, await getActive());
    if (bars.length === 0) {
      await finishStmt(db, job, 'empty', 0).run(); // 休市日
      return { outcome: 'empty', count: 0 };
    }
    await db.batch([
      ...upsertBarsStmts(db, bars),
      finishStmt(db, job, 'done', bars.length),
      // 每日 / 补漏的日线入库后排入扫描（2 年回补的历史日期不扫）
      ...(job.priority !== PRIORITY.backfill ? [enqueueScanStmt(db, job.key)] : []),
    ]);
    return { outcome: 'done', count: bars.length };
  }
  if (job.kind === 'splits') {
    const active = await getActive();
    const hits = (await client.splits(job.key)).filter((s) => active.has(s.ticker));
    await db.batch([
      ...hits.map((s) => requeueStmt(db, 'ticker', s.ticker, PRIORITY.splitRefetch, now)),
      finishStmt(db, job, 'done', hits.length),
    ]);
    return { outcome: 'done', count: hits.length };
  }
  // ticker：单股 2 年整段（复权）重拉，认得代码变更（见 history.ts）
  const h = await fetchTickerHistory(client, job.key, historyStart(today), today);
  await db.batch([
    // 先删掉当前代码生效前的数据（可能是同代码的别家证券），再写入（含旧代码补的历史）
    db.prepare('DELETE FROM bars_daily WHERE ticker = ? AND date < ?').bind(job.key, h.validFrom),
    ...upsertBarsStmts(db, h.bars),
    db.prepare('UPDATE tickers SET history_checked_at = ? WHERE ticker = ?').bind(nowIso(now), job.key),
    finishStmt(db, job, h.bars.length ? 'done' : 'empty', h.bars.length, h.oldSymbols.length ? `旧代码：${h.oldSymbols.join(',')}` : null),
  ]);
  return { outcome: h.bars.length ? 'done' : 'empty', count: h.bars.length };
}

export async function runTick(
  env: Env,
  now: Date = new Date(),
  client?: MassiveClient,
): Promise<TickResult> {
  const db = env.DB;
  const result: TickResult = { universeSynced: false, backfillSeeded: 0, dailyEnqueued: false, jobs: [], calls: 0 };

  result.universeSynced = (await syncStaticUniverse(db)).synced;
  result.backfillSeeded = await seedBackfill(db, now);
  result.dailyEnqueued = await enqueueDaily(db, now);
  await enqueueNewTickersStmt(db, now).run();
  await seedRepair(db, now);

  const apiKey = env.MASSIVE_API_KEY;
  if (!apiKey && !client) {
    console.warn('MASSIVE_API_KEY 未设置，跳过拉取');
    return result;
  }
  const jobs = await claimJobs(db, Number(env.MAX_CALLS_PER_TICK) || 4, now);
  if (jobs.length === 0) return result;

  const massive = client ?? new MassiveClient(apiKey!, env.MASSIVE_BASE_URL);
  let active: Set<string> | undefined;
  const getActive = async () => (active ??= await activeTickers(db));
  const startedAt = nowIso(now);
  let stop = false;

  const budget = Number(env.MAX_CALLS_PER_TICK) || 4;
  for (const job of jobs) {
    if (stop) break;
    // 单股任务最多 4 个请求（变更查询 + 当前代码 + 2 个旧代码），放不下就留到下一分钟
    if (massive.calls + JOB_COST[job.kind] > budget && massive.calls > 0) break;
    try {
      const r = await runJob(db, massive, job, now, getActive);
      result.jobs.push({ kind: job.kind, key: job.key, ...r });
    } catch (e) {
      const err = e instanceof MassiveError ? e : new MassiveError('other', 0, String((e as Error)?.message ?? e));
      const minutes = (m: number) => new Date(now.getTime() + m * 60_000);
      let outcome: string = err.kind;
      if (err.kind === 'not_yet') {
        await retryStmt(db, job, minutes(15), err.message, false).run();
      } else if (err.kind === 'entitlement') {
        await finishStmt(db, job, 'skipped', null, err.message).run();
      } else if (err.kind === 'rate_limited' || err.kind === 'auth') {
        await retryStmt(db, job, minutes(err.kind === 'auth' ? 30 : 2), err.message, false).run();
        stop = true;
      } else if (job.attempts + 1 >= MAX_ATTEMPTS) {
        await finishStmt(db, job, 'error', null, err.message).run();
        outcome = 'error';
      } else {
        await retryStmt(db, job, minutes(Math.min(2 ** (job.attempts + 1), 120)), err.message, true).run();
        outcome = 'retry';
      }
      result.jobs.push({ kind: job.kind, key: job.key, outcome, error: err.message });
    }
  }
  result.calls = massive.calls;

  const failed = result.jobs.filter((j) => j.error && j.outcome !== 'not_yet');
  await db
    .prepare('INSERT INTO runs (run_id, kind, started_at, finished_at, status, error, stats_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(
      crypto.randomUUID(),
      'ingest',
      startedAt,
      nowIso(),
      failed.length === 0 ? 'ok' : failed.length === result.jobs.length ? 'error' : 'partial',
      failed.map((j) => `${j.kind}:${j.key} ${j.error}`).join('\n') || null,
      JSON.stringify({ calls: result.calls, jobs: result.jobs.map(({ error: _e, ...j }) => j) }),
    )
    .run();
  return result;
}
