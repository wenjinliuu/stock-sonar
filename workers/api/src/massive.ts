// Massive（原 Polygon.io）REST 客户端。免费版 Stocks Basic：5 次/分钟、2 年历史、收盘后数据。
// 实测（2026-11-06）：Grouped Daily 可用；历史窗口为「今天往前滚动 2 年」；
// 当天数据在收盘前返回 403 "before end of day"；超出历史返回 403 "past historical entitlements"。

import { etDate } from './dates';

export interface Bar {
  ticker: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number | null;
  trades: number | null;
}

export interface Split {
  ticker: string;
  execution_date: string;
  split_from: number;
  split_to: number;
}

/** 错误分类，决定队列如何重试 */
export type MassiveErrorKind =
  | 'not_yet' // 当天数据还没出来，稍后重试
  | 'entitlement' // 超出免费版历史范围，跳过
  | 'rate_limited' // 429，本轮停止
  | 'auth' // key 缺失或无效
  | 'other';

export class MassiveError extends Error {
  constructor(
    public kind: MassiveErrorKind,
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'MassiveError';
  }
}

interface AggRow {
  T?: string;
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw?: number;
  n?: number;
}

interface AggResponse {
  status?: string;
  message?: string;
  error?: string;
  resultsCount?: number;
  results?: AggRow[];
}

export function classifyError(status: number, message: string): MassiveErrorKind {
  const m = message.toLowerCase();
  if (status === 429) return 'rate_limited';
  if (m.includes('before end of day')) return 'not_yet';
  if (m.includes('historical entitlement')) return 'entitlement';
  if (status === 401 || (status === 403 && (m.includes('api key') || m.includes('unknown')))) return 'auth';
  return 'other';
}

function toBar(r: AggRow, ticker: string, date: string): Bar {
  return {
    ticker,
    date,
    open: r.o,
    high: r.h,
    low: r.l,
    close: r.c,
    volume: r.v,
    vwap: r.vw ?? null,
    trades: r.n ?? null,
  };
}

/** Grouped Daily 结果 → Bar（日期用请求日期；该接口的 t 是收盘时刻） */
export function parseGrouped(date: string, body: AggResponse, keep?: Set<string>): Bar[] {
  const out: Bar[] = [];
  for (const r of body.results ?? []) {
    if (!r.T || (keep && !keep.has(r.T))) continue;
    out.push(toBar(r, r.T, date));
  }
  return out;
}

/** 单股区间日线 → Bar（该接口的 t 是美东当天 0 点） */
export function parseRange(ticker: string, body: AggResponse): Bar[] {
  return (body.results ?? []).map((r) => toBar(r, ticker, etDate(r.t)));
}

export class MassiveClient {
  calls = 0;

  constructor(
    private apiKey: string,
    private baseUrl = 'https://api.massive.com',
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async get<T>(path: string): Promise<T> {
    this.calls++;
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' },
    });
    const text = await res.text();
    let body: (T & { message?: string; error?: string; status?: string }) | undefined;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    if (!res.ok || body?.status === 'ERROR' || body?.status === 'NOT_AUTHORIZED') {
      const msg = body?.message ?? body?.error ?? text.slice(0, 200);
      throw new MassiveError(classifyError(res.status, msg), res.status, `${res.status} ${msg}`);
    }
    if (!body) throw new MassiveError('other', res.status, `无法解析响应：${text.slice(0, 200)}`);
    return body;
  }

  /** 全市场某天日线（一次请求约 1.2 万只） */
  async grouped(date: string, keep?: Set<string>): Promise<Bar[]> {
    const body = await this.get<AggResponse>(
      `/v2/aggs/grouped/locale/us/market/stocks/${date}?adjusted=true`,
    );
    return parseGrouped(date, body, keep);
  }

  /** 单只股票区间日线（新加入股票或拆股后整段重拉） */
  async range(ticker: string, from: string, to: string): Promise<Bar[]> {
    const body = await this.get<AggResponse>(
      `/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=50000`,
    );
    return parseRange(ticker, body);
  }

  /** 某天执行的拆股 */
  async splits(executionDate: string): Promise<Split[]> {
    const body = await this.get<{ results?: Split[] }>(
      `/v3/reference/splits?execution_date=${executionDate}&limit=1000`,
    );
    return body.results ?? [];
  }
}
