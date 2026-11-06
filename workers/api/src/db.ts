// D1 小工具。D1 单条语句最多 100 个绑定参数，批量插入需要切块。

export const MAX_PARAMS = 100;

/** 生成多行 INSERT 语句（按参数上限切块） */
export function chunkedInsert<T>(
  db: D1Database,
  head: string, // 如 "INSERT INTO t (a, b) VALUES"
  tail: string, // 如 "ON CONFLICT (a) DO UPDATE SET b = excluded.b"
  columns: number,
  rows: T[],
  values: (row: T) => unknown[],
): D1PreparedStatement[] {
  const perStmt = Math.max(1, Math.floor(MAX_PARAMS / columns));
  const placeholder = `(${Array(columns).fill('?').join(', ')})`;
  const out: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += perStmt) {
    const chunk = rows.slice(i, i + perStmt);
    const sql = `${head} ${chunk.map(() => placeholder).join(', ')} ${tail}`.trim();
    out.push(db.prepare(sql).bind(...chunk.flatMap(values)));
  }
  return out;
}

export async function getState(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM app_state WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export function setStateStmt(db: D1Database, key: string, value: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value);
}
