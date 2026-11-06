import { describe, expect, it } from 'vitest';
import { addYears, etClock, etDate, previousWeekdays, weekdaysBetween } from '../src/dates';
import { historyStart } from '../src/ingest';

describe('dates', () => {
  it('美东日期与时钟（含夏令时切换）', () => {
    // 2026-11-06 11:34 UTC = 美东 06:34（EST，冬令时）周五
    expect(etClock(new Date('2026-11-06T11:34:00Z'))).toEqual({ date: '2026-11-06', weekday: 5, minutes: 6 * 60 + 34 });
    // 2026-07-01 20:30 UTC = 美东 16:30（EDT）
    expect(etClock(new Date('2026-07-01T20:30:00Z')).minutes).toBe(16 * 60 + 30);
    // UTC 已到次日，美东仍是前一天
    expect(etDate(new Date('2026-11-07T03:00:00Z'))).toBe('2026-11-06');
  });

  it('工作日枚举', () => {
    expect(weekdaysBetween('2026-11-06', '2026-11-10')).toEqual(['2026-11-06', '2026-11-09', '2026-11-10']);
    expect(previousWeekdays('2026-11-09', 2)).toEqual(['2026-11-06', '2026-11-05']);
  });

  it('历史窗口起点 = 两年前 + 1 天（实测免费版今天往前滚动 2 年）', () => {
    expect(historyStart('2026-11-06')).toBe('2024-11-07');
    expect(addYears('2028-02-29', -2)).toBe('2026-03-01');
    // 两年约 500 个交易日（含节假日的工作日约 520）
    const n = weekdaysBetween(historyStart('2026-11-06'), '2026-11-05').length;
    expect(n).toBeGreaterThan(515);
    expect(n).toBeLessThan(525);
  });
});
