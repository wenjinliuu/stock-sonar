-- stock-sonar 初始表结构（D1 / SQLite）
-- 约定：日期一律 'YYYY-MM-DD'（美东交易日）；时间戳一律 ISO8601 UTC 文本。

-- ───────── 股票池 ─────────
-- tier: core 核心池 / extended 扩展池 / benchmark 基准（SPY、QQQ 等，只做相对强度参照，不出信号）
-- tier 与 active 由 ticker_sources 推导，见 workers/api/src/universe.ts 的 recomputeTiers()
CREATE TABLE tickers (
  ticker             TEXT PRIMARY KEY,
  name               TEXT NOT NULL DEFAULT '',
  tier               TEXT NOT NULL DEFAULT 'extended' CHECK (tier IN ('core', 'extended', 'benchmark')),
  tags               TEXT NOT NULL DEFAULT '[]',          -- JSON 数组，如 ["AI 算力","存储"]
  active             INTEGER NOT NULL DEFAULT 1,
  added_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  history_checked_at TEXT                                  -- 2 年历史已覆盖的时间；NULL 表示需要单股回补
);
CREATE INDEX idx_tickers_active ON tickers (active, tier);

-- 一只股票可同时属于多个来源：sp500 / ndx100 / ai / benchmark（仓库 CSV 维护）
-- options / research（每日自动同步）/ custom（App 内手动添加）
CREATE TABLE ticker_sources (
  ticker   TEXT NOT NULL,
  source   TEXT NOT NULL CHECK (source IN ('sp500', 'ndx100', 'ai', 'benchmark', 'options', 'research', 'custom')),
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (ticker, source)
) WITHOUT ROWID;
CREATE INDEX idx_ticker_sources_source ON ticker_sources (source);

-- ───────── 行情 ─────────
-- 拆股复权后的日线（Massive adjusted=true）；volume 可能带小数，用 REAL
CREATE TABLE bars_daily (
  ticker TEXT NOT NULL,
  date   TEXT NOT NULL,
  open   REAL NOT NULL,
  high   REAL NOT NULL,
  low    REAL NOT NULL,
  close  REAL NOT NULL,
  volume REAL NOT NULL,
  vwap   REAL,
  trades INTEGER,
  PRIMARY KEY (ticker, date)
) WITHOUT ROWID;
CREATE INDEX idx_bars_daily_date ON bars_daily (date);

-- ───────── 指标与信号 ─────────
-- 信号所需的每日指标快照；pct 为该值在自身近 250 个交易日中的分位数（0–1）
CREATE TABLE indicators_daily (
  ticker TEXT NOT NULL,
  date   TEXT NOT NULL,
  name   TEXT NOT NULL,
  value  REAL,
  pct    REAL,
  PRIMARY KEY (ticker, date, name)
) WITHOUT ROWID;
CREATE INDEX idx_indicators_daily_date ON indicators_daily (date, name);

-- SMC 结构、支撑压力位等需回看摆动点计算的结果（Python 容器算好，前端只画）
CREATE TABLE structures (
  ticker       TEXT NOT NULL,
  date         TEXT NOT NULL,
  kind         TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (ticker, date, kind)
) WITHOUT ROWID;

-- 当天触发的信号；direction: bull / bear；timeframe: D / W；strength: 1–3
CREATE TABLE signals (
  ticker      TEXT NOT NULL,
  date        TEXT NOT NULL,
  signal_id   TEXT NOT NULL,
  direction   TEXT NOT NULL CHECK (direction IN ('bull', 'bear')),
  timeframe   TEXT NOT NULL DEFAULT 'D' CHECK (timeframe IN ('D', 'W', 'M')),
  strength    INTEGER NOT NULL DEFAULT 1 CHECK (strength BETWEEN 1 AND 3),
  detail_json TEXT,                                        -- 「为什么触发」：关键数值与阈值
  PRIMARY KEY (ticker, date, signal_id, timeframe)
) WITHOUT ROWID;
CREATE INDEX idx_signals_date ON signals (date, direction);

-- 每日机会清单
CREATE TABLE opportunities (
  date         TEXT NOT NULL,
  ticker       TEXT NOT NULL,
  score        REAL NOT NULL,
  direction    TEXT NOT NULL CHECK (direction IN ('bull', 'bear')),
  resonance    TEXT NOT NULL DEFAULT '[]',                 -- JSON 数组：["options","research"]
  reasons_json TEXT NOT NULL DEFAULT '[]',
  rank         INTEGER,
  PRIMARY KEY (date, ticker)
) WITHOUT ROWID;
CREATE INDEX idx_opportunities_date_score ON opportunities (date, score DESC);

-- 信号历史表现（只展示，不调参）；horizon 单位为交易日（5 / 20）
CREATE TABLE signal_stats (
  signal_id     TEXT NOT NULL,
  horizon       INTEGER NOT NULL,
  n             INTEGER NOT NULL,
  win_rate      REAL,
  median_return REAL,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (signal_id, horizon)
) WITHOUT ROWID;

-- 统一事件时间轴：期权异动、研报评级/目标价变化、新闻
CREATE TABLE events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker       TEXT NOT NULL,
  date         TEXT NOT NULL,
  source       TEXT NOT NULL,                              -- options / research / news …
  kind         TEXT NOT NULL,
  direction    TEXT CHECK (direction IN ('bull', 'bear', 'neutral')),
  summary      TEXT NOT NULL DEFAULT '',
  url          TEXT,
  payload_json TEXT,
  dedup_key    TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_events_ticker_date ON events (ticker, date);
CREATE INDEX idx_events_date ON events (date, source);

-- ───────── 运维 ─────────
CREATE TABLE push_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL,
  ticker     TEXT NOT NULL,
  channel    TEXT NOT NULL,                                -- webpush / apns
  status     TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_push_log_date ON push_log (date);

-- 每次做了实际工作的调度运行记录
CREATE TABLE runs (
  run_id      TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,                               -- ingest / scan / universe …
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL CHECK (status IN ('running', 'ok', 'partial', 'error')),
  error       TEXT,
  stats_json  TEXT
);
CREATE INDEX idx_runs_started ON runs (started_at);

-- 数据拉取任务队列（受 Massive 免费版 5 次/分钟限制，每分钟 cron 取几条执行）
-- kind: grouped（key=日期，全市场日线）/ ticker（key=代码，单股 2 年回补）/ splits（key=日期，当天拆股检查）
-- status: pending / done / empty（休市日）/ skipped（超出历史权限）/ error（多次失败放弃）
CREATE TABLE fetch_queue (
  kind            TEXT NOT NULL CHECK (kind IN ('grouped', 'ticker', 'splits')),
  key             TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'empty', 'skipped', 'error')),
  priority        INTEGER NOT NULL DEFAULT 0,              -- 越小越先
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_error      TEXT,
  result_count    INTEGER,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (kind, key)
) WITHOUT ROWID;
CREATE INDEX idx_fetch_queue_pending ON fetch_queue (status, priority, next_attempt_at);

-- 小型键值状态（股票池版本哈希、回补是否已排队等）
CREATE TABLE app_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
) WITHOUT ROWID;
