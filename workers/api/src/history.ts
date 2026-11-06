// 单股历史回补（认得代码变更）。
// 问题：同一个代码可能先后属于不同证券（如 BNY 以前是一只基金，2026-05-21 起才是纽约梅隆银行），
// 公司改代码后旧历史又挂在旧代码下（如 MRSH 以前叫 MMC）。处理：
//   1. 当前代码只保留「它最近一次生效日」之后的数据（删掉混入的别家数据）；
//   2. 更早的部分用旧代码补，存到当前代码名下。

import { addDays } from './dates';
import type { Bar, MassiveClient, TickerChange } from './massive';

/** 最多回溯几个旧代码（控制请求数：1 次变更查询 + 1 次当前代码 + 最多 2 次旧代码） */
export const MAX_OLD_SYMBOLS = 2;

export interface OldSegment {
  symbol: string;
  from: string;
  to: string; // 闭区间
}

/** 当前代码的有效起始日：最近一次变更就是改成当前代码时，取那天；否则取窗口起点 */
export function validFrom(ticker: string, changes: TickerChange[], windowStart: string): string {
  const latest = changes[0];
  return latest && latest.ticker === ticker && latest.date > windowStart ? latest.date : windowStart;
}

/**
 * 旧代码要补的区间。changes 为新→旧排序；before 为当前代码已有数据的最早日期（只补它之前的）。
 */
export function oldSegments(
  ticker: string,
  changes: TickerChange[],
  windowStart: string,
  before: string,
): OldSegment[] {
  const out: OldSegment[] = [];
  for (let i = 0; i < changes.length && out.length < MAX_OLD_SYMBOLS; i++) {
    const c = changes[i]!;
    if (c.ticker === ticker) continue;
    // 该代码的生效期：[c.date, 更新一次变更的前一天]；若它就是最近一次变更，则到 before 前一天
    const newer = changes[i - 1];
    const end = newer ? addDays(newer.date, -1) : addDays(before, -1);
    const from = c.date > windowStart ? c.date : windowStart;
    const to = end < addDays(before, -1) ? end : addDays(before, -1);
    if (from <= to) out.push({ symbol: c.ticker, from, to });
    if (c.date <= windowStart) break; // 再往前已超出窗口
  }
  return out;
}

export interface HistoryResult {
  validFrom: string;
  bars: Bar[];
  oldSymbols: string[];
}

export async function fetchTickerHistory(
  client: MassiveClient,
  ticker: string,
  windowStart: string,
  today: string,
): Promise<HistoryResult> {
  const changes = await client.tickerChanges(ticker);
  const from = validFrom(ticker, changes, windowStart);
  const current = (await client.range(ticker, windowStart, today)).filter((b) => b.date >= from);
  const earliest = current[0]?.date ?? addDays(today, 1);
  const bars = [...current];
  const oldSymbols: string[] = [];
  for (const seg of oldSegments(ticker, changes, windowStart, earliest)) {
    const old = await client.range(seg.symbol, seg.from, seg.to);
    bars.push(...old.filter((b) => b.date < earliest).map((b) => ({ ...b, ticker })));
    oldSymbols.push(seg.symbol);
  }
  bars.sort((a, b) => (a.date < b.date ? -1 : 1));
  // 有旧代码补齐时，有效起始日以实际最早数据为准，避免删掉补进来的数据
  return { validFrom: from, bars, oldSymbols };
}
