// 今日机会清单（布局参照 design/Main.dc.html）
import { useEffect, useState } from 'react';
import { getJson } from './api';
import { CATEGORY_NAMES, WEEKLY_NAMES, detailText, signalName } from './signals';

type Dir = 'bull' | 'bear';
interface Reason { signal_id: string; direction: Dir; timeframe: 'D' | 'W'; strength: number; category: string; date: string; detail: Record<string, unknown> }
interface Item {
  ticker: string; name: string; tier: string; tags: string[]; ai: boolean; score: number; direction: Dir; rank: number;
  resonance: string[]; categories: string[]; reasons: Reason[];
  detail: { base: number; weekly_bonus: number; opposite_base: number; divergent: boolean; weekly_state: string };
}
interface Resp {
  date: string | null; universe: number; market: { ticker: string; change: number | null }[];
  scan: { status: string; scanned: number; failed: number } | null; items: Item[];
}

const TABS = ['全部', '看多', '看空', '共振', 'AI 核心'] as const;
const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pct(x: number | null) {
  if (x == null) return '—';
  return `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
}

export function Today({ onError }: { onError: (e: Error) => void }) {
  const [data, setData] = useState<Resp | null>(null);
  const [tab, setTab] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    getJson<Resp>('/api/opportunities').then(setData, onError);
  }, [onError]);

  if (!data) return <div className="row muted">加载中…</div>;
  if (!data.date) return <div className="row muted">还没有扫描结果。每个交易日美东收盘后（北京时间早上 5–6 点）自动生成。</div>;

  const d = new Date(`${data.date}T12:00:00Z`);
  const rows = data.items
    .filter((r) => tab === 0 || (tab === 1 && r.direction === 'bull') || (tab === 2 && r.direction === 'bear') ||
      (tab === 3 && r.resonance.length > 0) || (tab === 4 && r.ai))
    .sort((a, b) => b.score - a.score);

  return (
    <>
      <div className="top">
        <div className="title">
          <h1>今日机会</h1>
          <span className="muted">{`${d.getUTCMonth() + 1}/${String(d.getUTCDate()).padStart(2, '0')} ${WEEKDAY[d.getUTCDay()]} · 收盘后`}</span>
        </div>
      </div>
      <div className="market">
        {data.market.map((m) => (
          <span key={m.ticker} className="muted">
            {m.ticker} <b className={m.change != null && m.change >= 0 ? 'up' : 'down'}>{pct(m.change)}</b>
          </span>
        ))}
        <span className="muted push">
          上榜 <b>{data.items.length}</b> / {data.universe}
        </span>
      </div>
      <div className="tabs">
        {TABS.map((t, i) => (
          <button key={t} className={i === tab ? 'on' : ''} onClick={() => setTab(i)}>
            {t}
          </button>
        ))}
      </div>
      <div className="thead">
        <span className="c1">代码 / 名称</span>
        <span className="c2">触发信号</span>
        <span className="c3">综合分 / 方向</span>
      </div>
      {rows.length === 0 && <div className="row muted">今天没有达到门槛的机会（核心池需同向 3 类信号，扩展池需 4 类）。</div>}
      {rows.map((r) => {
        const names = r.reasons.map((s) => signalName(s.signal_id, s.direction));
        return (
          <div key={r.ticker}>
            <button className="opp" onClick={() => setOpen(open === r.ticker ? null : r.ticker)}>
              <div className="c1">
                <div className="tk">
                  {r.ticker}
                  {r.resonance.length > 0 && <span className="hot">共振</span>}
                </div>
                <div className="nm">{r.ai && r.tags[0] ? r.tags[0].split('·')[1]?.replace('(相关)', '') : r.name}</div>
              </div>
              <div className="c2">
                <div className="sig">{names.slice(0, 2).join(' · ')}</div>
                <div className="sub">
                  {[...names.slice(2), WEEKLY_NAMES[r.detail.weekly_state], r.detail.divergent ? '多空分歧' : ''].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span className={`score ${r.direction}`}>
                <b>{r.score.toFixed(1)}</b>
                <i>{r.direction === 'bull' ? '看多' : '看空'}</i>
              </span>
            </button>
            {open === r.ticker && (
              <div className="why">
                <div className="muted">
                  {r.categories.map((c) => CATEGORY_NAMES[c] ?? c).join(' / ')} · 基础 {r.detail.base} 分
                  {r.detail.weekly_bonus ? ` + 周线同向 ${r.detail.weekly_bonus}` : ''}
                  {r.detail.opposite_base ? ` − 反向 ${r.detail.opposite_base / 2}` : ''}
                </div>
                {r.reasons.map((s) => (
                  <div className="reason" key={`${s.signal_id}-${s.timeframe}`}>
                    <span>
                      {signalName(s.signal_id, s.direction)}
                      <em>{'●'.repeat(s.strength)}</em>
                    </span>
                    <span className="muted">
                      {s.date.slice(5)} {detailText(s.detail)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="foot muted">仅「共振」标记的机会会推送到手机；其余上榜股票只在这里查看。点一行看触发原因。</div>
    </>
  );
}
