// Sentiment & Liquidity scoring — rules verbatim from the client's checklist.
// Sentiment rules are MARKET-WIDE (every company gets the same score that day).
// Liquidity rules are PER-COMPANY (ADTV / F&O eligibility).

const NA = { points: 0, max: 0, status: "na", value: null, note: "Data not available" };

// ---- Sentiment (market-wide) ----

function ruleIndiaVIX(c) {
  const vix = c?._macro?.live?.india_vix?.latest;
  if (vix == null) return { ...NA, max: 2, note: "Live India VIX not yet fetched — run the Macro workflow." };
  const val = `India VIX ${vix}`;
  if (vix < 15) return { points: 2, max: 2, status: "pass", value: val, note: "VIX < 15 — low fear, equity accumulation mode." };
  if (vix <= 20) return { points: 1, max: 2, status: "partial", value: val, note: "VIX 15–20 — caution zone (neither risk-on nor panic)." };
  return { points: 0, max: 2, status: "fail", value: val, note: "VIX > 20 — reduce exposure." };
}

function ruleFIIDIIFlow(c) {
  const s = c?._macro?.sentiment;
  if (!s) return { ...NA, max: 2 };
  if (s.fii_net_positive_last_20d == null) return { ...NA, max: 2, note: "FII/DII flow signal not yet set in macro-context.json." };
  const signal = String(s.fii_net_positive_last_20d).toLowerCase();
  const note = s.fii_signal_note || "FII/DII flow signal from market activity report.";
  if (signal === "yes") return { points: 2, max: 2, status: "pass", value: "FII net positive in 10+ of last 20 days", note };
  if (signal === "mixed") return { points: 1, max: 2, status: "partial", value: "FII flow mixed", note };
  return { points: 0, max: 2, status: "fail", value: "Consistent FII selling", note };
}

function rulePutCallRatio(c) {
  const s = c?._macro?.sentiment;
  if (!s || s.put_call_ratio == null) return { ...NA, max: 1, note: s?.put_call_ratio_note || "Live PCR scrape not yet wired." };
  const pcr = s.put_call_ratio;
  const val = `PCR ${pcr}`;
  if (pcr >= 0.9 && pcr <= 1.3) return { points: 1, max: 1, status: "pass", value: val, note: "PCR 0.9–1.3 — balanced to mildly bullish positioning." };
  if (pcr < 0.8) return { points: 0, max: 1, status: "fail", value: val, note: "PCR < 0.8 — overly bullish, caution flag." };
  if (pcr > 1.5) return { points: 0, max: 1, status: "fail", value: val, note: "PCR > 1.5 — panic levels." };
  return { points: 0, max: 1, status: "partial", value: val, note: "PCR in transitional range." };
}

function ruleMarketBreadth(c) {
  const s = c?._macro?.sentiment;
  if (!s || s.market_breadth_ad_ratio == null) return { ...NA, max: 1, note: s?.market_breadth_note || "Live A/D breadth scrape not yet wired." };
  const ad = s.market_breadth_ad_ratio;
  const val = `A/D ratio ${ad}`;
  if (ad > 1.5) return { points: 1, max: 1, status: "pass", value: val, note: "A/D > 1.5 — broad participation, healthy breadth." };
  return { points: 0, max: 1, status: "fail", value: val, note: "Narrow breadth — only large caps participating." };
}

// ---- Liquidity (per-company) ----

function ruleADTV(c) {
  const adtv = c?.adtv_20d_cr;
  if (adtv == null) return { ...NA, max: 2, note: "20-day ADTV not yet computed — needs OHLCV from the Technicals scrape." };
  const val = `ADTV ₹${adtv} Cr (20-day average)`;
  if (adtv >= 10) return { points: 2, max: 2, status: "pass", value: val, note: "ADTV ≥ ₹10 Cr — comfortable liquidity for institutional positions." };
  if (adtv >= 5) return { points: 1, max: 2, status: "partial", value: val, note: "ADTV ₹5–10 Cr — moderate liquidity, fine for retail/mid-AUM portfolios." };
  return { points: 0, max: 2, status: "fail", value: val, note: "ADTV < ₹5 Cr — illiquid, hard fail per client framework." };
}

function ruleImpactCost(c) {
  if (c?.impact_cost_pct == null) return { ...NA, max: 2, note: "NSE Impact Cost monthly report not yet integrated — rule pending." };
  const ic = c.impact_cost_pct;
  const val = `Impact cost ${ic}%`;
  if (ic <= 0.3) return { points: 2, max: 2, status: "pass", value: val, note: "Impact cost ≤ 0.3% — tight execution for mid-cap orders." };
  if (ic <= 0.5) return { points: 1, max: 2, status: "partial", value: val, note: "Impact cost 0.3–0.5% — acceptable slippage." };
  return { points: 0, max: 2, status: "fail", value: val, note: "Impact cost > 0.5% — high slippage risk." };
}

function ruleBidAskSpread(c) {
  if (c?.bid_ask_spread_pct == null) return { ...NA, max: 1, note: "Live bid-ask spread not yet fetched — needs NSE order-book feed." };
  const sp = c.bid_ask_spread_pct;
  const val = `Bid-ask spread ${sp}% of CMP`;
  if (sp < 0.1) return { points: 1, max: 1, status: "pass", value: val, note: "Spread < 0.1% — tight order book." };
  if (sp <= 0.3) return { points: 0, max: 1, status: "partial", value: val, note: "Spread 0.1–0.3% — passable." };
  return { points: 0, max: 1, status: "fail", value: val, note: "Spread > 0.3% — thin order book." };
}

function ruleFnOAvailability(c) {
  if (c?.fno_eligible == null) return { ...NA, max: 1 };
  if (c.fno_eligible) return { points: 1, max: 1, status: "pass", value: "On NSE F&O list", note: "Active futures + options contracts — hedging flexibility, institutional interest." };
  return { points: 0, max: 1, status: "fail", value: "Not on NSE F&O list", note: "Cash-only stock. Preferred but not mandatory per client framework." };
}

// ---- master ----

const ACTIVE_RULES = [
  { key: "vix",      label: "India VIX",         category: "Sentiment", criteria: "< 15 (risk-on)",          fn: ruleIndiaVIX },
  { key: "fiidii",   label: "FII / DII Flow",    category: "Sentiment", criteria: "Net positive 10/20 days", fn: ruleFIIDIIFlow },
  { key: "pcr",      label: "Put Call Ratio",    category: "Sentiment", criteria: "0.9 – 1.3",               fn: rulePutCallRatio },
  { key: "breadth",  label: "Market Breadth",    category: "Sentiment", criteria: "A/D > 1.5",               fn: ruleMarketBreadth },
  { key: "adtv",     label: "Avg Daily Traded Value", category: "Liquidity", criteria: "≥ ₹10 Cr (20-day)", fn: ruleADTV },
  { key: "impact",   label: "Impact Cost",       category: "Liquidity", criteria: "≤ 0.3% for mid-cap",      fn: ruleImpactCost },
  { key: "spread",   label: "Bid-Ask Spread",    category: "Liquidity", criteria: "< 0.1% of CMP",           fn: ruleBidAskSpread },
  { key: "fno",      label: "F&O Availability",  category: "Liquidity", criteria: "On NSE F&O list",         fn: ruleFnOAvailability },
];

const DEFERRED = [];   // Deferred rules surface as N/A via their own functions

export function scoreCompany(c) {
  if (c?.error) {
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
    hardFails: [],
    naCount,
  };
}

export { ACTIVE_RULES, DEFERRED };
