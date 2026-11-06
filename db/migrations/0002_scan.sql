-- P1：扫描队列 + 机会清单补充字段

-- 每个交易日一条；当天日线入库后自动排入，分批扫描（cursor = 已处理到的最后一个代码）
CREATE TABLE scan_queue (
  date        TEXT PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'error')),
  cursor      TEXT NOT NULL DEFAULT '',
  scanned     INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  spec        TEXT,
  started_at  TEXT,
  finished_at TEXT,
  last_error  TEXT
) WITHOUT ROWID;

ALTER TABLE opportunities ADD COLUMN categories TEXT NOT NULL DEFAULT '[]';
ALTER TABLE opportunities ADD COLUMN detail_json TEXT;   -- 基础分、周线加分、反向分、多空分歧、周线状态、20 日成交额
