// 日期工具：交易日一律按美东（America/New_York）日历，格式 YYYY-MM-DD。

const ET = 'America/New_York';

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: ET,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: ET,
  hourCycle: 'h23',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** 某个时刻对应的美东日期 */
export function etDate(at: Date | number): string {
  return dateFmt.format(typeof at === 'number' ? new Date(at) : at);
}

export interface EtClock {
  date: string;
  /** 0=周日 … 6=周六 */
  weekday: number;
  /** 当天分钟数（0–1439） */
  minutes: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function etClock(at: Date): EtClock {
  const p = Object.fromEntries(partsFmt.formatToParts(at).map((x) => [x.type, x.value]));
  return {
    date: etDate(at),
    weekday: WEEKDAYS[p.weekday ?? ''] ?? 0,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

/** 纯日历加减（按 UTC 解析，避免夏令时干扰） */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addYears(date: string, years: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}

export function isWeekday(date: string): boolean {
  const w = new Date(`${date}T00:00:00Z`).getUTCDay();
  return w >= 1 && w <= 5;
}

/** [from, to] 闭区间内的所有工作日（节假日由接口返回空结果识别） */
export function weekdaysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWeekday(d)) out.push(d);
  return out;
}

/** 往前数 n 个工作日（不含 date 本身） */
export function previousWeekdays(date: string, n: number): string[] {
  const out: string[] = [];
  let d = date;
  while (out.length < n) {
    d = addDays(d, -1);
    if (isWeekday(d)) out.push(d);
  }
  return out;
}

export function nowIso(at: Date = new Date()): string {
  return at.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
