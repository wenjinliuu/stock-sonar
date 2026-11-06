import { useCallback, useState } from 'react';
import { NeedLogin } from './api';
import { Status } from './Status';
import { Today } from './Today';

const PAGES = [
  { key: 'today', label: '今日' },
  { key: 'status', label: '数据' },
] as const;

export function App() {
  const [page, setPage] = useState<(typeof PAGES)[number]['key']>('today');
  const [error, setError] = useState<Error | null>(null);
  const onError = useCallback((e: Error) => setError(e), []);

  return (
    <div className="app">
      {error && (
        <div className="row">
          <span className={error instanceof NeedLogin ? '' : 'bad'}>{error instanceof NeedLogin ? '登录已过期' : `加载失败：${error.message}`}</span>
          <a className="btn" href="/api/login">
            重新登录
          </a>
        </div>
      )}
      <main>{page === 'today' ? <Today onError={onError} /> : <Status />}</main>
      <nav className="nav">
        {PAGES.map((p) => (
          <button key={p.key} className={p.key === page ? 'on' : ''} onClick={() => setPage(p.key)}>
            {p.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
