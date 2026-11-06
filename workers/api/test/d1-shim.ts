// 用 Node 内置 node:sqlite 模拟 D1 的最小子集，加载真实迁移文件做集成测试。
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(import.meta.dirname, '../../../db/migrations');

class Stmt {
  constructor(
    private db: DatabaseSync,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {
    if (params.length > 100) throw new Error(`D1 限制：单条语句超过 100 个参数（${params.length}）`);
  }
  bind(...params: unknown[]) {
    return new Stmt(this.db, this.sql, params);
  }
  private p() {
    return this.params.map((v) => (v === undefined ? null : v)) as never[];
  }
  async first<T>(col?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.p()) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (col ? row[col] : { ...row }) as T;
  }
  async all<T>() {
    const rows = this.db.prepare(this.sql).all(...this.p()) as T[];
    return { results: rows.map((r) => ({ ...r })) as T[], success: true, meta: {} };
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.p());
    return { results: [], success: true, meta: { changes: Number(r.changes) } };
  }
  runSync() {
    const isRead = /^\s*(SELECT|WITH)/i.test(this.sql);
    if (isRead) return { results: this.db.prepare(this.sql).all(...this.p()).map((r) => ({ ...r })), success: true, meta: {} };
    const r = this.db.prepare(this.sql).run(...this.p());
    return { results: [], success: true, meta: { changes: Number(r.changes) } };
  }
}

export class D1Shim {
  readonly raw: DatabaseSync;
  constructor() {
    this.raw = new DatabaseSync(':memory:');
    for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
      this.raw.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
    }
  }
  prepare(sql: string) {
    return new Stmt(this.raw, sql);
  }
  async batch(stmts: Stmt[]) {
    this.raw.exec('BEGIN');
    try {
      const out = stmts.map((s) => s.runSync());
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }
  q<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    return this.raw.prepare(sql).all(...(params as never[])).map((r) => ({ ...r })) as T[];
  }
}

export const asD1 = (s: D1Shim) => s as unknown as D1Database;
