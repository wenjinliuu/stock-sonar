// 信号显示名（与 docs/signals.md 第 4 节一致）
type Dir = 'bull' | 'bear';

const NAMES: Record<string, string | Record<Dir, string>> = {
  T_MA200_UP: '站上 MA200',
  T_MA200_DOWN: '跌破 MA200',
  T_STACK_BULL: '多头排列',
  T_STACK_BEAR: '空头排列',
  T_MA50_PULLBACK: '回踩 MA50 不破',
  T_MA50_REJECT: 'MA50 反压',
  T_ST_FLIP: { bull: 'SuperTrend 翻多', bear: 'SuperTrend 翻空' },
  W_ST_FLIP: { bull: '周线 SuperTrend 翻多', bear: '周线 SuperTrend 翻空' },
  M_RSI_LOW: 'RSI 自身超卖',
  M_RSI_HIGH: 'RSI 自身超买',
  M_MACD_CROSS: { bull: 'MACD 金叉', bear: 'MACD 死叉' },
  M_MACD_DIV: { bull: 'MACD 底背离', bear: 'MACD 顶背离' },
  W_MACD_CROSS: { bull: '周线 MACD 金叉', bear: '周线 MACD 死叉' },
  V_SQUEEZE_BREAK: { bull: '布林收口后上破', bear: '布林收口后下破' },
  V_RANGE_EXPAND: { bull: '大振幅收高', bear: '大振幅收低' },
  VOL_BREAKOUT: { bull: '放量突破 20 日高', bear: '放量跌破 20 日低' },
  VOL_OBV_DIV: { bull: 'OBV 跌中吸筹', bear: 'OBV 涨中出货' },
  P_52W_HIGH: '创 52 周新高',
  P_52W_LOW: '创 52 周新低',
  P_STRETCH: { bull: '向下偏离 MA50 过大', bear: '向上偏离 MA50 过大' },
};

export const CATEGORY_NAMES: Record<string, string> = {
  trend: '趋势', momentum: '动量', volatility: '波动', volume: '量能', position: '位置',
};

export const WEEKLY_NAMES: Record<string, string> = { up: '周线向上', down: '周线向下', flat: '周线震荡' };

export function signalName(id: string, dir: Dir): string {
  const n = NAMES[id];
  if (!n) return id;
  return typeof n === 'string' ? n : n[dir];
}

const DETAIL_NAMES: Record<string, string> = {
  rsi14: 'RSI', pct: '自身分位', close: '收盘', sma200: 'MA200', sma50: 'MA50', low: '最低', high: '最高',
  st_line: 'SuperTrend', macd: 'MACD', w_macd: '周 MACD', bb_upper: '布林上轨', bb_lower: '布林下轨',
  tr_ratio: '振幅/ATR', close_loc: '收盘位置', vol_ratio: '量比', ret20_pct: '20 日涨幅分位', hi_52w: '52 周高',
  lo_52w: '52 周低', ma50_dev: '偏离(ATR)', week: '周', pivots: '摆动点',
};

export function detailText(detail: Record<string, unknown>): string {
  return Object.entries(detail ?? {})
    .map(([k, v]) => {
      const name = DETAIL_NAMES[k] ?? k;
      if (k === 'pct' || k === 'ret20_pct' || k === 'close_loc') return `${name} ${Math.round(Number(v) * 100)}%`;
      if (Array.isArray(v)) return `${name} ${v.join(' → ')}`;
      return `${name} ${typeof v === 'number' ? Number(v.toFixed(2)) : v}`;
    })
    .join(' · ');
}
