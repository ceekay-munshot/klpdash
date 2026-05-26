// Fundamentals scoring — rules taken verbatim from the client's scoring sheet.
// Each rule returns { points, max, status: 'pass'|'partial'|'fail'|'na'|'hard_fail',
//                     value, note }
// status 'hard_fail' = a red flag — still scored, but flagged visually.
// status 'na'        = data not available, this parameter is skipped from the total.

const NA = { points: 0, max: 0, status: "na", value: null, note: "Data not available" };

// Sector-aware N/A: produce a contextual note instead of generic "Data not available".
function naWithReason(c, ruleKey, max) {
  const broad = (c["Broad Sector"] || "").trim();
  const sec = (c["Sector"] || "").trim();
  const ind = (c["Broad Industry"] || "").trim();
  const isFinancial = broad === "Financial Services";
  const isInsurance = /insurance/i.test(ind) || /insurance/i.test(sec);
  const isBank = /bank/i.test(ind);
  const isREIT = /reit|invit|real estate investment/i.test(ind);
  let note = "Data not available";
  if (ruleKey === "de" && isFinancial) {
    note = "Not applicable — client framework excludes the financial sector from Debt/Equity scoring (banks, NBFCs, insurance and AMCs are highly leveraged by design).";
  } else if (ruleKey === "de") {
    note = "D/E not reported — likely negative net worth, or capital structure too small/atypical to report. Treat as a caution.";
  } else if (ruleKey === "icr" && (isFinancial || isInsurance || isBank)) {
    note = `Not applicable — ${isInsurance ? "insurance" : isBank ? "banking" : "financial-sector"} companies report interest as core revenue/expense, not as a coverage ratio.`;
  } else if (ruleKey === "icr") {
    note = "Interest Coverage not reported — usually means the company is debt-free or had no interest expense in the period (which is positive).";
  } else if (ruleKey === "cfo" && (isFinancial || isInsurance || isREIT)) {
    note = `Not directly comparable — ${isREIT ? "REITs/InvITs" : isInsurance ? "insurance companies" : "financial-sector companies"} report cash flows on a different framework.`;
  } else if (ruleKey === "cfo") {
    note = "Operating cash flow not reported yet (often the case for recently-listed companies before their first full annual report).";
  } else if (ruleKey === "ebitda" && (isFinancial || isBank)) {
    note = `Not applicable — ${isBank ? "banks" : "financial-sector companies"} don't report "operating margin" in the conventional sense.`;
  } else if (ruleKey === "npm" && (isFinancial || isBank)) {
    note = `Not applicable to ${isBank ? "banks" : "financial-sector companies"} as reported.`;
  } else if ((ruleKey === "rev3y" || ruleKey === "pat3y" || ruleKey === "eps") && c["Company"]) {
    note = "Insufficient history — likely a recently-listed company. Will populate once 3+ years of data are available.";
  }
  return { points: 0, max, status: "na", value: null, note };
}

// ---- helpers ----
const parsePercent = (v) => {
  if (v == null) return null;
  const s = String(v).replace(/%/g, "").replace(/,/g, "").trim();
  if (!s || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const parseNumber = (v) => {
  if (v == null) return null;
  const s = String(v).replace(/[,\s]/g, "").replace(/Cr\.?/i, "").trim();
  if (!s || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const fmtPct = (n) => (n == null ? "—" : `${n}%`);

// ---- rules (16 active; 3 deferred) ----

function ruleROE(c) {
  const v = parsePercent(c["ROE"]);
  if (v == null) return naWithReason(c, "roe", 2);
  if (v > 12) return { points: 2, max: 2, status: "pass", value: fmtPct(v), note: "ROE > 12% — strong capital efficiency vs cost of equity." };
  if (v >= 8) return { points: 1, max: 2, status: "partial", value: fmtPct(v), note: "ROE 8–12% — borderline." };
  return { points: 0, max: 2, status: "fail", value: fmtPct(v), note: "ROE < 8% — weak capital efficiency." };
}

function ruleROCE(c) {
  const v = parsePercent(c["ROCE"]);
  if (v == null) return naWithReason(c, "roce", 2);
  if (v > 15) return { points: 2, max: 2, status: "pass", value: fmtPct(v), note: "ROCE > 15% — returns exceed cost of capital deployed." };
  if (v >= 10) return { points: 1, max: 2, status: "partial", value: fmtPct(v), note: "ROCE 10–15% — borderline." };
  return { points: 0, max: 2, status: "fail", value: fmtPct(v), note: "ROCE < 10% — capital not being deployed efficiently." };
}

function ruleEBITDAMargin(c) {
  // OPM in our data ≈ EBITDA margin proxy
  const last = parsePercent(c["OPM last year"]);
  const prev = parsePercent(c["OPM preceding year"]);
  if (last == null || prev == null) return naWithReason(c, "ebitda", 1);
  const val = `${fmtPct(prev)} → ${fmtPct(last)}`;
  if (last > prev) return { points: 1, max: 1, status: "pass", value: val, note: "Operating margin improving YoY." };
  if (last >= prev - 0.5) return { points: 1, max: 1, status: "partial", value: val, note: "Margin roughly stable." };
  return { points: 0, max: 1, status: "fail", value: val, note: "Operating margin contracting." };
}

function ruleNPM(c) {
  const last = parsePercent(c["NPM last year"]);
  const prev = parsePercent(c["NPM preceding year"]);
  if (last == null || prev == null) return naWithReason(c, "npm", 1);
  const val = `${fmtPct(prev)} → ${fmtPct(last)}`;
  const compressionBps = (prev - last) * 100;
  if (last >= prev) return { points: 1, max: 1, status: "pass", value: val, note: "Net profit margin stable or expanding." };
  if (compressionBps <= 200) return { points: 1, max: 1, status: "partial", value: val, note: "Slight margin compression (within 200 bps)." };
  return { points: 0, max: 1, status: "fail", value: val, note: "Margin compressed > 200 bps in latest year." };
}

function ruleCFO(c) {
  const ly = parseNumber(c["CF Operations LY"]);
  const py = parseNumber(c["CF Operations PY"]);
  if (ly == null && py == null) return naWithReason(c, "cfo", 2);
  const val = `LY ${ly ?? "—"} | PY ${py ?? "—"}`;
  if (ly != null && py != null && ly > 0 && py > 0) {
    return { points: 2, max: 2, status: "pass", value: val, note: "Positive operating cash flow both years (proxy for 10-yr rule)." };
  }
  if (ly != null && ly < 0) {
    return { points: 0, max: 2, status: "hard_fail", value: val, note: "Negative CFO in latest year — hard fail regardless of PAT." };
  }
  if ((ly ?? 0) > 0 || (py ?? 0) > 0) {
    return { points: 1, max: 2, status: "partial", value: val, note: "One of the two years positive." };
  }
  return { points: 0, max: 2, status: "fail", value: val, note: "Operating cash flow not positive." };
}

// Defensive sectors get a lower 3Y revenue-growth threshold per client
// framework. Typical Indian-market defensive classification — staples,
// pharma, utilities. Match against Screener's "Broad Industry" or "Sector".
const DEFENSIVE_SECTORS = new Set([
  // Consumer staples
  "Diversified FMCG", "Personal Products", "Food Products", "Beverages",
  "Cigarettes & Tobacco Products", "Agricultural Food & other Products",
  // Healthcare
  "Pharmaceuticals & Biotechnology", "Healthcare Services",
  "Healthcare Equipment & Supplies",
  // Utilities
  "Power", "Gas",
]);

function isDefensiveSector(c) {
  const ind = (c["Broad Industry"] || "").trim();
  const sec = (c["Sector"] || "").trim();
  return DEFENSIVE_SECTORS.has(ind) || DEFENSIVE_SECTORS.has(sec);
}

function ruleRevenueGrowth(c) {
  const v = parsePercent(c["Sales growth 3Years"]);
  if (v == null) return naWithReason(c, "rev3y", 2);
  const defensive = isDefensiveSector(c);
  const passT = defensive ? 8 : 12;       // defensives need only 8%+ to PASS
  const partialT = defensive ? 5 : 8;     // partial range tightens accordingly
  const sectorNote = defensive ? " (defensive sector — lower threshold applied per client framework)" : "";
  if (v >= passT) return { points: 2, max: 2, status: "pass", value: fmtPct(v), note: `3Y revenue CAGR ≥ ${passT}%${sectorNote}.` };
  if (v >= partialT) return { points: 1, max: 2, status: "partial", value: fmtPct(v), note: `3Y revenue CAGR ${partialT}–${passT}%${sectorNote}.` };
  return { points: 0, max: 2, status: "fail", value: fmtPct(v), note: `3Y revenue CAGR < ${partialT}%${sectorNote}.` };
}

function rulePATGrowth(c) {
  const v = parsePercent(c["Profit Var 3Yrs"]);
  if (v == null) return naWithReason(c, "pat3y", 2);
  if (v >= 15) return { points: 2, max: 2, status: "pass", value: fmtPct(v), note: "3Y PAT CAGR ≥ 15% — strongest profit signal." };
  if (v >= 8) return { points: 1, max: 2, status: "partial", value: fmtPct(v), note: "3Y PAT CAGR 8–15%." };
  return { points: 0, max: 2, status: "fail", value: fmtPct(v), note: "3Y PAT CAGR < 8%." };
}

function ruleEPSGrowth(c) {
  const v3 = parsePercent(c["EPS growth 3Years"]);
  const v5 = parsePercent(c["EPS growth 5Years"]);
  if (v3 == null && v5 == null) return naWithReason(c, "eps", 1);
  const val = `3Y ${fmtPct(v3)} | 5Y ${fmtPct(v5)}`;
  if ((v3 ?? -1) > 0 && (v5 ?? -1) > 0) return { points: 1, max: 1, status: "pass", value: val, note: "EPS positive and growing consistently." };
  if ((v3 ?? -1) > 0 || (v5 ?? -1) > 0) return { points: 1, max: 1, status: "partial", value: val, note: "EPS positive in one window." };
  return { points: 0, max: 1, status: "fail", value: val, note: "EPS erratic or declining." };
}

function ruleQuarterlyEarnings(c) {
  const q = [
    parseNumber(c["Net Profit Qtr (-3)"]),
    parseNumber(c["Net Profit Qtr (-2)"]),
    parseNumber(c["Net Profit Qtr (-1)"]),
    parseNumber(c["Net Profit Qtr (latest)"]),
  ];
  if (q.some((x) => x == null)) return naWithReason(c, "qoq", 1);
  const val = q.join(" → ");
  let declines = 0, maxConsecDeclines = 0;
  for (let i = 1; i < q.length; i++) {
    if (q[i] < q[i - 1]) { declines++; maxConsecDeclines = Math.max(maxConsecDeclines, declines); } else declines = 0;
  }
  if (q[3] > q[2] && q[2] > q[1]) return { points: 1, max: 1, status: "pass", value: val, note: "QoQ earnings improving last 3 quarters." };
  if (maxConsecDeclines >= 2) return { points: 0, max: 1, status: "fail", value: val, note: "Two or more consecutive QoQ declines." };
  return { points: 1, max: 1, status: "partial", value: val, note: "Mixed but no sustained decline." };
}

function ruleDebtEquity(c) {
  const v = parseNumber(c["Debt to equity"]);
  const broadSector = (c["Broad Sector"] || "").trim();
  // Apply client's sector exception: financial sector excluded from D/E scoring.
  if (broadSector === "Financial Services") return naWithReason(c, "de", 2);
  if (v == null) return naWithReason(c, "de", 2);
  if (v < 0.5) return { points: 2, max: 2, status: "pass", value: v.toString(), note: "D/E < 0.5 — comfortably low leverage." };
  if (v <= 1.0) return { points: 1, max: 2, status: "partial", value: v.toString(), note: "D/E 0.5–1.0 — moderate leverage." };
  return { points: 0, max: 2, status: "fail", value: v.toString(), note: "D/E > 1.0 — elevated leverage." };
}

function ruleInterestCoverage(c) {
  const v = parseNumber(c["Int Coverage"]);
  if (v == null) return naWithReason(c, "icr", 2);
  if (v > 3) return { points: 2, max: 2, status: "pass", value: v.toString(), note: "Interest coverage > 3 — debt comfortably serviced." };
  if (v >= 1.5) return { points: 1, max: 2, status: "partial", value: v.toString(), note: "Coverage 1.5–3 — tight." };
  return { points: 0, max: 2, status: "hard_fail", value: v.toString(), note: "Coverage < 1.5 — debt serviceability risk." };
}

function ruleCurrentRatio(c) {
  const v = parseNumber(c["Current ratio"]);
  if (v == null) return naWithReason(c, "cr", 1);
  if (v > 1.2) return { points: 1, max: 1, status: "pass", value: v.toString(), note: "Current ratio > 1.2." };
  if (v >= 1.0) return { points: 1, max: 1, status: "partial", value: v.toString(), note: "Current ratio 1.0–1.2." };
  return { points: 0, max: 1, status: "fail", value: v.toString(), note: "Current ratio < 1.0 — liquidity stress." };
}

function rulePledge(c) {
  const v = parsePercent(c["Pledged percentage"]);
  if (v == null) return naWithReason(c, "pledge", 2);
  if (v < 5) return { points: 2, max: 2, status: "pass", value: fmtPct(v), note: "Promoter pledge < 5%." };
  if (v <= 20) return { points: 1, max: 2, status: "partial", value: fmtPct(v), note: "Promoter pledge 5–20%." };
  return { points: 0, max: 2, status: "hard_fail", value: fmtPct(v), note: "Promoter pledge > 20% — hard fail." };
}

function rulePromoterHolding(c) {
  const v = parsePercent(c["Change in Prom Hold"]);
  if (v == null) return naWithReason(c, "ph", 1);
  if (v >= 0) return { points: 1, max: 1, status: "pass", value: fmtPct(v), note: "Promoter holding stable or increasing." };
  if (v > -2) return { points: 1, max: 1, status: "partial", value: fmtPct(v), note: "Minor reduction in promoter holding." };
  return { points: 0, max: 1, status: "fail", value: fmtPct(v), note: "Promoter holding falling > 2%." };
}

function ruleFIIDII(c) {
  const fii = parsePercent(c["Chg in FII Hold"]);
  const dii = parsePercent(c["Chg in DII Hold"]);
  if (fii == null && dii == null) return naWithReason(c, "fiidii", 1);
  const sum = (fii ?? 0) + (dii ?? 0);
  const val = `FII ${fmtPct(fii)} | DII ${fmtPct(dii)}`;
  if (sum > 0) {
    if (fii != null && fii < -2) {
      return { points: 1, max: 1, status: "partial", value: val, note: "Combined positive but FII exiting sharply (>2%)." };
    }
    return { points: 1, max: 1, status: "pass", value: val, note: "FII + DII holding trending up." };
  }
  return { points: 0, max: 1, status: "fail", value: val, note: "Institutional holding not increasing." };
}

function ruleDividendConsistency(c) {
  const ly = parseNumber(c["Dividend last year"]);
  const py = parseNumber(c["Dividend Prev Ann"]);
  const d5 = parsePercent(c["Div 5Yrs"]);
  if (ly == null && py == null && d5 == null) return naWithReason(c, "div", 1);
  const val = `LY ${ly ?? "—"} | PY ${py ?? "—"} | 5Y avg ${fmtPct(d5)}`;
  const lastTwoPaid = (ly ?? 0) > 0 && (py ?? 0) > 0;
  const fiveYrYield = d5 ?? 0;
  if (lastTwoPaid && fiveYrYield > 0) return { points: 1, max: 1, status: "pass", value: val, note: "Dividend paid consistently (proxy for 3-of-5-years rule)." };
  if ((ly ?? 0) > 0 || fiveYrYield > 0) return { points: 1, max: 1, status: "partial", value: val, note: "Some dividend history." };
  return { points: 0, max: 1, status: "fail", value: val, note: "No / erratic dividend." };
}

function ruleInsiderBuying(c) {
  // The dashboard merges insider data from public/data/insider-trades.json
  // into each company under c.insider_*. If the merge didn't find a match,
  // those fields are absent → N/A with explanation.
  if (!c.insider_loaded) {
    return { ...NA, max: 1, note: "Insider trades data not loaded — NSE PIT feed unavailable. Will populate on next refresh." };
  }
  if (c.insider_transactions == null || c.insider_transactions === 0) {
    return { ...NA, max: 1, note: "No insider trades disclosed in the last 6 months for this company." };
  }
  const netSh = c.insider_net_shares ?? 0;
  const netVal = c.insider_net_value ?? 0;
  const buySh  = c.insider_buy_shares ?? 0;
  const sellSh = c.insider_sell_shares ?? 0;
  // Compute sell % of total shares using market cap / price as a rough proxy
  const mcap = parseNumber((c["Market Cap"] || "").replace(/Cr\.?/i, "").replace(/,/g, ""));
  const cmp = parseNumber((c["Current Price"] || "").replace(/,/g, ""));
  const totalShares = (mcap != null && cmp != null && cmp > 0) ? (mcap * 1e7) / cmp : null;
  const sellPctOfFloat = totalShares ? (sellSh / totalShares) * 100 : null;
  const sellHardFail = sellPctOfFloat != null && sellPctOfFloat > 1;

  const val = `Buy ${formatShares(buySh)} | Sell ${formatShares(sellSh)} | Net ${(netSh>=0?"+":"")}${formatShares(netSh)} (${c.insider_transactions} disclosure${c.insider_transactions===1?"":"s"})`;
  if (sellHardFail) {
    return { points: 0, max: 1, status: "fail", value: val, note: `Insider selling exceeded 1% of float (${sellPctOfFloat.toFixed(2)}%) — red flag per client framework.` };
  }
  if (netVal > 0) return { points: 1, max: 1, status: "pass", value: val, note: "Net insider buying over last 6 months — positive signal." };
  if (netVal === 0) return { points: 1, max: 1, status: "partial", value: val, note: "Insider activity roughly balanced." };
  return { points: 0, max: 1, status: "fail", value: val, note: "Net insider selling over last 6 months." };
}

function formatShares(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e7) return (n / 1e7).toFixed(2) + " Cr";
  if (abs >= 1e5) return (n / 1e5).toFixed(2) + " L";
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + " K";
  return n.toString();
}

// ---- deferred parameters (data source pending) ----
const DEFERRED = [
  { key: "auditorRemarks", label: "Auditor Remarks", category: "Governance", reason: "Annual-report parsing not yet integrated.", max: 2 },
  { key: "governanceIssues", label: "Corporate Governance Issues", category: "Governance", reason: "SEBI orders / litigation feed not yet integrated.", max: 2 },
];

// ---- master ----
const ACTIVE_RULES = [
  { key: "roe", label: "ROE", category: "Profitability", criteria: "> 12%", fn: ruleROE },
  { key: "roce", label: "ROCE", category: "Profitability", criteria: "> 15%", fn: ruleROCE },
  { key: "ebitda", label: "EBITDA Margin (YoY)", category: "Profitability", criteria: "Improving", fn: ruleEBITDAMargin },
  { key: "npm", label: "Net Profit Margin", category: "Profitability", criteria: "Stable / expanding", fn: ruleNPM },
  { key: "cfo", label: "Operating Cash Flow", category: "Profitability", criteria: "Positive", fn: ruleCFO },
  { key: "rev3y", label: "Revenue Growth (3Y)", category: "Growth", criteria: "≥ 12–15%", fn: ruleRevenueGrowth },
  { key: "pat3y", label: "PAT Growth (3Y)", category: "Growth", criteria: "≥ 15%", fn: rulePATGrowth },
  { key: "eps", label: "EPS Growth", category: "Growth", criteria: "Positive & consistent", fn: ruleEPSGrowth },
  { key: "qoq", label: "Quarterly Earnings", category: "Growth", criteria: "QoQ improving 3 qtrs", fn: ruleQuarterlyEarnings },
  { key: "de", label: "Debt / Equity", category: "Balance Sheet", criteria: "< 0.5", fn: ruleDebtEquity },
  { key: "icr", label: "Interest Coverage", category: "Balance Sheet", criteria: "> 3", fn: ruleInterestCoverage },
  { key: "cr", label: "Current Ratio", category: "Balance Sheet", criteria: "> 1.2", fn: ruleCurrentRatio },
  { key: "pledge", label: "Promoter Pledge", category: "Balance Sheet", criteria: "< 5%", fn: rulePledge },
  { key: "ph", label: "Promoter Holding", category: "Shareholding", criteria: "Stable / increasing", fn: rulePromoterHolding },
  { key: "fiidii", label: "FII + DII Holding", category: "Shareholding", criteria: "Increasing", fn: ruleFIIDII },
  { key: "insider", label: "Insider Buying", category: "Shareholding", criteria: "Net buying in last 6 mo", fn: ruleInsiderBuying },
  { key: "div", label: "Dividend Consistency", category: "Governance", criteria: "Positive", fn: ruleDividendConsistency },
];

export function scoreCompany(company) {
  const breakdown = ACTIVE_RULES.map((r) => ({ ...r, ...r.fn(company) }));
  const totalPoints = breakdown.reduce((s, b) => s + b.points, 0);
  const totalMax = breakdown.reduce((s, b) => s + b.max, 0);
  const hardFails = breakdown.filter((b) => b.status === "hard_fail").map((b) => b.label);
  const naCount = breakdown.filter((b) => b.status === "na").length;
  return {
    company,
    breakdown,
    deferred: DEFERRED,
    totalPoints,
    totalMax,
    scorePct: totalMax ? Math.round((totalPoints / totalMax) * 100) : 0,
    hardFails,
    naCount,
  };
}

export { ACTIVE_RULES, DEFERRED };
