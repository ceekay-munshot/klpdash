// SPIP Composite Scoring — implements the client's weighted 5-pillar
// model from SPIP_Stock_Selection_Model_v1.xlsx (Scoring_Model sheet).
//
//   Composite = (Fund/29)*40 + (Tech/24)*35 + (Macro/17)*15
//             + (Sent/6)*5   + (Liq/6)*5
//   → 0-100 score
//
// Rating bands (Scoring_Model · Section C):
//   ≥ 75  STRONG BUY   — initiate full position
//   60-74 BUY          — initiate 50-75% position
//   45-59 WATCH / HOLD — watchlist, do not initiate
//   < 45  AVOID / EXIT — exclude from basket
//
// Hard-fail rule (Scoring_Model · Section A): if ANY of the client's
// hard fails trigger, the stock exits the pipeline entirely — its
// composite is shown but it is filtered out of the SPIP basket.
// The 5 hard fails per the spec:
//   - Fundamentals: D/E > 2, Auditor adverse, Active SEBI investigation
//                   (also CFO negative, ICR < 1.5, Pledge > 20%)
//   - Technicals:   Price < 200 DMA
//   - Liquidity:    ADTV < ₹5 Cr

import * as fund from "./scoring.js";
import * as tech from "./tech-scoring.js";
import * as macro from "./macro-scoring.js";
import * as senliq from "./sentiment-liquidity-scoring.js";

export const PILLAR_WEIGHTS = {
  fundamentals: 40,
  technicals: 35,
  macro: 15,
  sentiment: 5,
  liquidity: 5,
};

export const PILLAR_MAX_RAW = {
  fundamentals: 29,
  technicals: 24,
  macro: 17,
  sentiment: 6,
  liquidity: 6,
};

export function ratingFromComposite(composite, hardFailed) {
  if (hardFailed) return "FILTERED";
  if (composite == null) return "UNRATED";
  if (composite >= 75) return "STRONG BUY";
  if (composite >= 60) return "BUY";
  if (composite >= 45) return "WATCH";
  return "AVOID";
}

export function ratingClass(rating) {
  switch (rating) {
    case "STRONG BUY": return "bg-emerald-100 text-emerald-800 ring-emerald-200";
    case "BUY":        return "bg-blue-100 text-blue-800 ring-blue-200";
    case "WATCH":      return "bg-amber-100 text-amber-800 ring-amber-200";
    case "AVOID":      return "bg-rose-100 text-rose-800 ring-rose-200";
    case "FILTERED":   return "bg-rose-50 text-rose-700 ring-rose-200";
    default:           return "bg-slate-100 text-slate-700 ring-slate-200";
  }
}

// Split the senliq breakdown into Sentiment vs Liquidity sub-pillars
// (they live in the same module but have separate weights per spec).
function splitSenliq(senliqResult) {
  const sent = senliqResult.breakdown.filter((b) => b.category === "Sentiment");
  const liq  = senliqResult.breakdown.filter((b) => b.category === "Liquidity");
  const sumP = (rs) => rs.reduce((s, r) => s + (r.points || 0), 0);
  const sumM = (rs) => rs.reduce((s, r) => s + (r.max    || 0), 0);
  return {
    sentiment: { points: sumP(sent), max: sumM(sent), breakdown: sent },
    liquidity: { points: sumP(liq),  max: sumM(liq),  breakdown: liq },
  };
}

// Weighted contribution of one pillar (handles 0/0 → 0 safely).
function weighted(points, max, weightPct) {
  if (!max) return 0;
  return Math.round((points / max) * weightPct * 100) / 100;
}

// Score a single company across all five pillars. Inputs:
//   fundCo  - row from screener-companies.json (Fundamentals + Macro)
//   techCo  - matching row from technicals.json (Technicals + Senliq)
//             may be null if Yahoo OHLCV was missing for this ticker
//   macroCtx - parsed macro.json (live VIX, sentiment, sector themes)
export function scoreCompositeOne(fundCo, techCo, macroCtx) {
  const fundResult  = fund.scoreCompany(fundCo);
  const macroResult = macro.scoreCompany({ ...fundCo, _macro: macroCtx });

  // Technicals + Senliq need techCo. If we don't have OHLCV, return
  // an explicit "data missing" state rather than zero-scoring those
  // pillars (which would unfairly penalise the stock).
  const hasTechData = techCo && techCo.cmp != null;
  const techResult   = hasTechData ? tech.scoreCompany(techCo) : null;
  const senliqResult = hasTechData ? senliq.scoreCompany({ ...techCo, _macro: macroCtx }) : null;
  const split        = senliqResult ? splitSenliq(senliqResult) : null;

  // Collect all hard fails from every pillar.
  const allHardFails = [
    ...(fundResult.hardFails || []),
    ...(techResult?.hardFails || []),
    ...(senliqResult?.hardFails || []),
  ];

  // Weighted composite — only sum pillars that have data.
  const pillars = {
    fundamentals: {
      raw: fundResult.totalPoints, max: fundResult.totalMax,
      pct: fundResult.scorePct,
      weighted: weighted(fundResult.totalPoints, fundResult.totalMax, PILLAR_WEIGHTS.fundamentals),
    },
    technicals: techResult ? {
      raw: techResult.totalPoints, max: techResult.totalMax,
      pct: techResult.scorePct,
      weighted: weighted(techResult.totalPoints, techResult.totalMax, PILLAR_WEIGHTS.technicals),
    } : { raw: null, max: PILLAR_MAX_RAW.technicals, pct: null, weighted: null },
    macro: {
      raw: macroResult.totalPoints, max: macroResult.totalMax,
      pct: macroResult.scorePct,
      weighted: weighted(macroResult.totalPoints, macroResult.totalMax, PILLAR_WEIGHTS.macro),
    },
    sentiment: split ? {
      raw: split.sentiment.points, max: split.sentiment.max,
      pct: split.sentiment.max ? Math.round((split.sentiment.points / split.sentiment.max) * 100) : 0,
      weighted: weighted(split.sentiment.points, split.sentiment.max, PILLAR_WEIGHTS.sentiment),
    } : { raw: null, max: PILLAR_MAX_RAW.sentiment, pct: null, weighted: null },
    liquidity: split ? {
      raw: split.liquidity.points, max: split.liquidity.max,
      pct: split.liquidity.max ? Math.round((split.liquidity.points / split.liquidity.max) * 100) : 0,
      weighted: weighted(split.liquidity.points, split.liquidity.max, PILLAR_WEIGHTS.liquidity),
    } : { raw: null, max: PILLAR_MAX_RAW.liquidity, pct: null, weighted: null },
  };

  // If technicals/senliq are missing we cannot compute a faithful
  // composite — return null to indicate "unrated" rather than a
  // misleading partial figure.
  const composite = hasTechData
    ? Math.round((pillars.fundamentals.weighted +
                  pillars.technicals.weighted +
                  pillars.macro.weighted +
                  pillars.sentiment.weighted +
                  pillars.liquidity.weighted) * 10) / 10
    : null;

  const hardFailed = allHardFails.length > 0;
  const rating = ratingFromComposite(composite, hardFailed);

  return {
    company: fundCo,
    composite,
    rating,
    hardFails: allHardFails,
    hardFailed,
    pillars,
    pillarResults: { fund: fundResult, tech: techResult, macro: macroResult, senliq: senliqResult, split },
    dataComplete: hasTechData,
  };
}

// Score every company in the universe. Returns array sorted by
// composite descending; hard-failed and unrated stocks are kept in
// the array but sorted to the bottom so the UI can split them out.
export function scoreCompositeBatch(fundCompanies, techCompanies, macroCtx) {
  // Build ticker → techCo lookup. extractTicker mirrors what
  // scrape-technicals.mjs does.
  const techByTicker = {};
  for (const t of techCompanies || []) {
    if (t && t.ticker) techByTicker[String(t.ticker).toUpperCase()] = t;
  }
  const extractTickerFromUrl = (url) => {
    const m = String(url || "").match(/\/company\/([^/]+)/);
    return m ? m[1].toUpperCase() : null;
  };

  const results = (fundCompanies || []).map((fc) => {
    const ticker = extractTickerFromUrl(fc["Screener URL"]);
    const tc = ticker ? techByTicker[ticker] : null;
    return scoreCompositeOne(fc, tc, macroCtx);
  });

  // Sort: rated stocks descending by composite, then unrated, then filtered last.
  results.sort((a, b) => {
    if (a.hardFailed !== b.hardFailed) return a.hardFailed ? 1 : -1;
    if ((a.composite == null) !== (b.composite == null)) return a.composite == null ? 1 : -1;
    return (b.composite ?? -1) - (a.composite ?? -1);
  });

  return results;
}
