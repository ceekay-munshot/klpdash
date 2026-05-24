// Technicals scoring — rules taken verbatim from the client's scoring sheet.
// Same {points, max, status, value, note} shape as fundamentals scoring.js
// so the shared dashboard renderer can consume either.

const NA = { points: 0, max: 0, status: "na", value: null, note: "Data not available" };

function fmtPct(n, d = 1) { return n == null ? "—" : `${(n * 100).toFixed(d)}%`; }
function fmtNum(n, d = 1) { return n == null ? "—" : Number(n).toFixed(d); }

// ---- rules (11 active; 5 deferred) ----

function rulePriceAbove50EMA(c) {
  if (c.cmp == null || c.ema50 == null) return { ...NA, max: 2 };
  const val = `CMP ${fmtNum(c.cmp,0)} vs 50 EMA ${fmtNum(c.ema50,0)}`;
  if (c.above_50ema) return { points: 2, max: 2, status: "pass", value: val, note: "Confirms short-to-medium term uptrend." };
  return { points: 0, max: 2, status: "fail", value: val, note: "Below 50 EMA — short-to-medium term weakness." };
}

function rulePriceAbove200DMA(c) {
  if (c.cmp == null || c.sma200 == null) return { ...NA, max: 2, note: "Less than 200 trading days of history — primary trend cannot be evaluated." };
  const val = `CMP ${fmtNum(c.cmp,0)} vs 200 DMA ${fmtNum(c.sma200,0)}`;
  if (c.above_200dma) return { points: 2, max: 2, status: "pass", value: val, note: "Above 200 DMA — primary trend filter passes (stock exits pipeline if this fails)." };
  return { points: 0, max: 2, status: "fail", value: val, note: "Below 200 DMA — primary trend filter fail." };
}

function ruleGoldenCross(c) {
  if (c.sma50 == null || c.sma200 == null) return { ...NA, max: 1, note: "Need both 50 SMA and 200 SMA — insufficient history." };
  const val = `50 DMA ${fmtNum(c.sma50,0)} vs 200 DMA ${fmtNum(c.sma200,0)}`;
  if (c.golden_cross) return { points: 1, max: 1, status: "pass", value: val, note: "Golden Cross active (50 DMA > 200 DMA)." };
  return { points: 0, max: 1, status: "fail", value: val, note: "Death Cross — 50 DMA below 200 DMA." };
}

function ruleRSI(c) {
  const v = c.rsi14;
  if (v == null) return { ...NA, max: 2 };
  const val = `RSI ${fmtNum(v,1)}`;
  if (v >= 55 && v <= 75) return { points: 2, max: 2, status: "pass", value: val, note: "RSI in ideal momentum zone (55–75)." };
  if (v > 75 && v <= 80) return { points: 1, max: 2, status: "partial", value: val, note: "RSI 75–80 — strong but approaching overbought." };
  if (v > 80) return { points: 1, max: 2, status: "partial", value: val, note: "RSI > 80 — overbought zone." };
  if (v >= 40 && v < 55) return { points: 1, max: 2, status: "partial", value: val, note: "RSI 40–55 — neutral / consolidating." };
  return { points: 0, max: 2, status: "fail", value: val, note: "RSI < 40 — weak / failing momentum." };
}

function ruleMACD(c) {
  if (!c.macd) return { ...NA, max: 2 };
  const { line, signal, above_zero, positive_crossover } = c.macd;
  const val = `Line ${fmtNum(line,2)} | Signal ${fmtNum(signal,2)}`;
  if (line > signal && above_zero) {
    const cross = positive_crossover ? " (fresh positive crossover)" : "";
    return { points: 2, max: 2, status: "pass", value: val, note: `MACD line above signal and above zero${cross}.` };
  }
  if (line > signal) return { points: 1, max: 2, status: "partial", value: val, note: "MACD above signal but still below zero." };
  return { points: 0, max: 2, status: "fail", value: val, note: "Negative crossover — MACD line below signal." };
}

function ruleADX(c) {
  const v = c.adx14;
  if (v == null) return { ...NA, max: 1 };
  const val = `ADX ${fmtNum(v,1)}`;
  if (v > 25) return { points: 1, max: 1, status: "pass", value: val, note: "ADX > 25 — strong trend." };
  if (v >= 20) return { points: 1, max: 1, status: "partial", value: val, note: "ADX 20–25 — developing trend." };
  return { points: 0, max: 1, status: "fail", value: val, note: "ADX < 20 — choppy / no clear trend." };
}

function ruleRelativeStrength(c) {
  const rs = c.relative_strength_6m;
  const stockR = c.return_6m;
  const indexR = c.return_6m_index;
  if (rs == null) return { ...NA, max: 2 };
  const val = `6M return ${fmtPct(stockR,1)} vs Nifty 500 ${fmtPct(indexR,1)} (RS ${rs>=0?"+":""}${fmtPct(rs,1)})`;
  if (rs > 0) return { points: 2, max: 2, status: "pass", value: val, note: "6M price return ahead of Nifty 500 — outperforming." };
  return { points: 1, max: 2, status: "partial", value: val, note: "Underperforming benchmark." };
}

function ruleVolumeBreakout(c) {
  const r = c.volume_ratio_today;
  if (r == null) return { ...NA, max: 2 };
  const val = `Today vs 20-day avg: ${fmtNum(r,2)}×`;
  if (r >= 1.5) return { points: 2, max: 2, status: "pass", value: val, note: "Today's volume ≥ 1.5× 20-day average — strong participation." };
  if (r >= 1.0) return { points: 1, max: 2, status: "partial", value: val, note: "Slightly above average — low-volume move (suspect)." };
  return { points: 0, max: 2, status: "fail", value: val, note: "Below average volume — weak conviction." };
}

function rule52WHighProximity(c) {
  const p = c.high_proximity_pct;
  if (p == null) return { ...NA, max: 2 };
  const distance = (1 - p) * 100;
  const val = `${fmtNum(distance,1)}% below 52W high (CMP ${fmtNum(c.cmp,0)} / 52W ${fmtNum(c.high_52w,0)})`;
  if (distance <= 10) return { points: 2, max: 2, status: "pass", value: val, note: "Within 10% of 52-week high — strong structure." };
  if (distance <= 20) return { points: 1, max: 2, status: "partial", value: val, note: "10–20% off 52W high — still constructive." };
  return { points: 0, max: 2, status: "fail", value: val, note: ">20% below 52W high — weak structure." };
}

function ruleBeta(c) {
  const b = c.beta_1y;
  if (b == null) return { ...NA, max: 1 };
  const val = `Beta ${fmtNum(b,2)}`;
  if (b >= 0.7 && b <= 1.3) return { points: 1, max: 1, status: "pass", value: val, note: "Beta 0.7–1.3 — moderate market sensitivity." };
  if (b > 1.5) return { points: 0, max: 1, status: "fail", value: val, note: "Beta > 1.5 — high risk, position-size penalty." };
  if (b < 0.5) return { points: 0, max: 1, status: "fail", value: val, note: "Beta < 0.5 — drag risk (low responsiveness)." };
  return { points: 1, max: 1, status: "partial", value: val, note: "Beta in transitional range." };
}

function ruleATRStability(c) {
  const a = c.atr14_pct;
  if (a == null) return { ...NA, max: 1 };
  const val = `ATR(14) = ${fmtNum(a,2)}% of price`;
  // Client criterion: < 2.5% for large cap, declining/stable. We only have
  // a single snapshot — approximate using the absolute threshold.
  if (a < 2.5) return { points: 1, max: 1, status: "pass", value: val, note: "ATR% under 2.5% — controlled volatility." };
  if (a < 4) return { points: 1, max: 1, status: "partial", value: val, note: "ATR% 2.5–4% — elevated but tolerable." };
  return { points: 0, max: 1, status: "fail", value: val, note: "ATR% > 4% — high volatility, position-size flag." };
}

// ---- deferred (5 — need additional data sources) ----
const DEFERRED = [
  { key: "hhhl",       label: "Higher Highs–Higher Lows", category: "Trend Strength", reason: "Weekly-chart pattern recognition not yet implemented.", max: 1 },
  { key: "delivery",   label: "Delivery Percentage",      category: "Volume",         reason: "NSE bhavcopy delivery-% feed not yet integrated.", max: 1 },
  { key: "fiidii",     label: "Institutional Activity",   category: "Volume",         reason: "NSE FII/DII daily flow feed not yet integrated.", max: 1 },
  { key: "consolidation", label: "Breakout from Consolidation", category: "Breakout", reason: "6-week base / consolidation pattern detection not yet implemented.", max: 2 },
  { key: "base",       label: "Base Formation",           category: "Breakout",       reason: "Drawdown + closing-range analysis not yet implemented.", max: 1 },
];

const ACTIVE_RULES = [
  { key: "ema50",   label: "Price Above 50 EMA",       category: "Trend Strength", criteria: "CMP > 50 EMA",          fn: rulePriceAbove50EMA },
  { key: "dma200",  label: "Price Above 200 DMA",      category: "Trend Strength", criteria: "CMP > 200 DMA",         fn: rulePriceAbove200DMA },
  { key: "gold",    label: "Golden Cross",             category: "Trend Strength", criteria: "50 DMA > 200 DMA",      fn: ruleGoldenCross },
  { key: "rsi",     label: "RSI (14)",                 category: "Momentum",       criteria: "55–75",                 fn: ruleRSI },
  { key: "macd",    label: "MACD",                     category: "Momentum",       criteria: "Positive crossover",    fn: ruleMACD },
  { key: "adx",     label: "ADX (14)",                 category: "Momentum",       criteria: "> 25",                  fn: ruleADX },
  { key: "rs",      label: "Relative Strength vs Nifty 500", category: "Momentum", criteria: "Outperforming index",   fn: ruleRelativeStrength },
  { key: "volbo",   label: "Volume Breakout",          category: "Volume",         criteria: "≥ 1.5× 20-day avg",     fn: ruleVolumeBreakout },
  { key: "near52w", label: "52-Week High Proximity",   category: "Breakout",       criteria: "Within 10%",            fn: rule52WHighProximity },
  { key: "beta",    label: "Beta",                     category: "Risk",           criteria: "0.7 – 1.3",             fn: ruleBeta },
  { key: "atr",     label: "ATR Stability",            category: "Risk",           criteria: "< 2.5% of price",       fn: ruleATRStability },
];

export function scoreCompany(c) {
  if (c.error) {
    return {
      company: c, breakdown: [], deferred: DEFERRED,
      totalPoints: 0, totalMax: 0, scorePct: 0,
      hardFails: [], naCount: ACTIVE_RULES.length,
      tickerError: c.error,
    };
  }
  const breakdown = ACTIVE_RULES.map((r) => ({ ...r, ...r.fn(c) }));
  const totalPoints = breakdown.reduce((s, b) => s + b.points, 0);
  const totalMax = breakdown.reduce((s, b) => s + b.max, 0);
  const naCount = breakdown.filter((b) => b.status === "na").length;
  return {
    company: c, breakdown, deferred: DEFERRED,
    totalPoints, totalMax,
    scorePct: totalMax ? Math.round((totalPoints / totalMax) * 100) : 0,
    hardFails: [],   // no client-defined hard fails on technicals
    naCount,
  };
}

export { ACTIVE_RULES, DEFERRED };
