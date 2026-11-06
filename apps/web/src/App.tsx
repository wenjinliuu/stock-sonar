// P0：数据状态页（股票池、日线回补进度、拉取队列、运行记录）。P2 起替换为「今日机会清单」。
import { useEffect, useState } from 'react';

interface Status {
  tickers: { tier: string; active: number; n: number }[];
  bars: { rows: number; dates: number; first: string | null; last: string | null };
  coverage: { full: number | null; partial: number | null; none: number | null };
  queue: { kind: string; status: string; n: number }[];
  runs: { run_id: string; started_at: string; status: string; error: string | null }[];
}

const TIER_LABEL: Record<string, string> = { core: '核心池', extended: '扩展池', benchmark: '基准' };
const KIND_LABEL: Record<string, string> = { grouped: '全市场日线', ticker: '单股回补', splits: '拆股检查' };

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needLogin, setNeedLogin] = useState(false);

  useEffect(() => {
    const load = () =>
      // redirect: 'manual'：Access 登录过期时会重定向到登录域名，这里识别出来提示重新登录
      fetch('/api/status', { redirect: 'manual', credentials: 'same-origin' })
        .then((r) => {
          if (r.type === 'opaqueredirect' || r.status === 401 || r.status === 403) {
            setNeedLogin(true);
            return null;
          }
          return r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`));
        })
        .then((s: Status | null) => {
          if (!s) return;
          setStatus(s);
          setNeedLogin(false);
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  const active = status?.tickers.filter((t) => t.active).reduce((a, t) => a + t.n, 0) ?? 0;
  const full = status?.coverage.full ?? 0;
  const grouped = status?.queue.filter((q) => q.kind === 'grouped') ?? [];
  const groupedTotal = grouped.reduce((a, q) => a + q.n, 0);
  const groupedDone = grouped.filter((q) => q.status !== 'pending').reduce((a, q) => a + q.n, 0);
  const pct = groupedTotal ? Math.round((groupedDone / groupedTotal) * 100) : 0;

  return (
    <div className="app">
      <div className="top">
        <h1>个股声呐</h1>
        <span className="muted">P0 · 数据状态</span>
      </div>
      {needLogin && (
        <div className="row">
          <span>登录已过期</span>
          <a className="btn" href="/api/login">
            重新登录
          </a>
        </div>
      )}
      {error && !needLogin && (
        <div className="row bad">
          <span>加载失败：{error}</span>
          <a className="btn" href="/api/login">
            重新登录
          </a>
        </div>
      )}
      {!status && !error && !needLogin && <div className="row muted">加载中…</div>}
      {status && (
        <>
          <div className="gap" />
          <div className="section-title">股票池（活跃 {active} 只）</div>
          {status.tickers
            .filter((t) => t.active)
            .map((t) => (
              <div className="row" key={t.tier}>
                <span>{TIER_LABEL[t.tier] ?? t.tier}</span>
                <span>{t.n}</span>
              </div>
            ))}

          <div className="gap" />
          <div className="section-title">日线回补 {pct}%</div>
          <div className="bar">
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="row">
            <span>K 线行数</span>
            <span>{status.bars.rows.toLocaleString()}</span>
          </div>
          <div className="row">
            <span>日期范围</span>
            <span>
              {status.bars.first ?? '—'} ~ {status.bars.last ?? '—'}（{status.bars.dates} 天）
            </span>
          </div>
          <div className="row">
            <span>满 480 根的股票</span>
            <span className={full >= active - 5 ? 'ok' : undefined}>
              {full} / {active}
            </span>
          </div>

          <div className="gap" />
          <div className="section-title">拉取队列</div>
          {status.queue.map((q) => (
            <div className="row" key={`${q.kind}-${q.status}`}>
              <span>
                {KIND_LABEL[q.kind] ?? q.kind} · {q.status}
              </span>
              <span>{q.n}</span>
            </div>
          ))}

          <div className="gap" />
          <div className="section-title">最近运行</div>
          {status.runs.map((r) => (
            <div className="row" key={r.run_id}>
              <span className="muted">{r.started_at.replace('T', ' ').slice(0, 16)}</span>
              <span className={r.status === 'ok' ? 'ok' : 'bad'} title={r.error ?? ''}>
                {r.status}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
