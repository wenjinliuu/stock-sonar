// 拉取任务队列（D1 表 fetch_queue）

import { nowIso } from './dates';

export type JobKind = 'grouped' | 'ticker' | 'splits';

export const PRIORITY = {
  dailyGrouped: 0, // 当天全市场日线
  splits: 1, // 当天拆股检查
  gapFill: 2, // 最近几天的补漏
  splitRefetch: 5, // 拆股后整段重拉
  backfill: 10, // 2 年回补（按日期从旧到新，越早的越先过期）
  newTicker: 20, // 新加入股票的单股回补
} as const;

export interface Job {
  kind: JobKind;
  key: string;
  attempts: number;
  priority?: number;
}

export function enqueueStmt(db: D1Database, kind: JobKind, key: string, priority: number, now: Date): D1PreparedStatement {
  return db
    .prepare('INSERT OR IGNORE INTO fetch_queue (kind, key, priority, next_attempt_at) VALUES (?, ?, ?, ?)')
    .bind(kind, key, priority, nowIso(now));
}

/** 重新排队（已完成的也重置为 pending），用于拆股后重拉 */
export function requeueStmt(db: D1Database, kind: JobKind, key: string, priority: number, now: Date): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO fetch_queue (kind, key, priority, next_attempt_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (kind, key) DO UPDATE SET status = 'pending', attempts = 0, priority = excluded.priority,
         next_attempt_at = excluded.next_attempt_at, last_error = NULL,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
    )
    .bind(kind, key, priority, nowIso(now));
}

export async function claimJobs(db: D1Database, limit: number, now: Date): Promise<Job[]> {
  const { results } = await db
    .prepare(
      `SELECT kind, key, attempts, priority FROM fetch_queue
       WHERE status = 'pending' AND next_attempt_at <= ?
       ORDER BY priority, key LIMIT ?`,
    )
    .bind(nowIso(now), limit)
    .all<Job>();
  return results;
}

export function finishStmt(
  db: D1Database,
  job: Job,
  status: 'done' | 'empty' | 'skipped' | 'error',
  resultCount: number | null,
  error: string | null = null,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE fetch_queue SET status = ?, result_count = ?, last_error = ?, attempts = attempts + 1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE kind = ? AND key = ?`,
    )
    .bind(status, resultCount, error, job.kind, job.key);
}

export function retryStmt(
  db: D1Database,
  job: Job,
  retryAt: Date,
  error: string,
  countAttempt: boolean,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE fetch_queue SET next_attempt_at = ?, last_error = ?, attempts = attempts + ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
       WHERE kind = ? AND key = ?`,
    )
    .bind(nowIso(retryAt), error.slice(0, 500), countAttempt ? 1 : 0, job.kind, job.key);
}
