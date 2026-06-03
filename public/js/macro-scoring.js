// Macro scoring — rules taken verbatim from the client's scoring sheet.
// Each rule takes a company that has had c._macro merged in (the contents of
// public/data/macro.json) plus per-company convenience flags (c.in_pli,
// c.in_renewable). The Macro tab uses the same {points, max, status, value,
// note} shape as the other scoring modules.

const NA = { points: 0, max: 0, status: "na", value: null, note: "Data not available" };

function inTheme(c, themeKey) {
  const themes = c?._macro?.sector_themes || {};
  const list = themes[themeKey] || [];
  const ind = (c?.industry || c?.broadIndustry || c?.["Broad Industry"] || "").trim();
  const sec = (c?.sector || c?.["Sector"] || "").trim();
  return list.some((s) => s === ind || s === sec);
}

function getSector(c) {
  return (c?.industry || c?.broadIndustry || c?.["Broad Industry"] || c?.sector || c?.["Sector"] || "").trim();
}
function naIfNoSector(c, max) {
  if (getSector(c)) return null;
  return { points: 0, max, status: "na", value: null,
    note: "Sector data not yet populated for this company — Fundamentals workflow needs to run once after sector scraping was added." };
}

function fmtList(arr, max = 3) {
  if (!arr || !arr.length) return "—";
  const head = arr.slice(0, max).join(", ");
  return arr.length > max ? `${head} (+${arr.length - max} more)` : head;
}

// ----- Per-company annual-report extraction helpers ----------------------------
// company-revenue-mix.json is populated by the daily Claude.ai routine that
// reads each company's BSE annual report MD&A. When data exists for the
// company, the affected rules use per-company truth instead of the sector
// proxy. Companies still awaiting extraction fall through to the sector
// proxy (current behaviour).
function rmix(c) { return c?._revenue_mix || null; }
function truncEvidence(s, n = 220) {
  if (!s) return "";
  const str = String(s).trim();
  return str.length > n ? str.slice(0, n).trimEnd() + "..." : str;
}
// Append the per-company evidence to the rule note, tagged as "Verified".
function withEvidence(note, ev, year) {
  if (!ev) return note;
  const tag = year ? `[Verified from ${year} AR]` : `[Verified from annual report]`;
  return `${note} ${tag} ${truncEvidence(ev)}`;
}

// ---- Sector Rotation (7 pts) ----

function ruleInfraPush(c) {
  const m = c?._macro;
  if (!m) return { ...NA, max: 2 };
  const na = naIfNoSector(c, 2); if (na) return na;
  const active = m.regime?.gov_capex_active;
  const isBenef = inTheme(c, "infra_push");
  const sector = getSector(c);
  // Sector neutrality: client framework gives 1 pt to companies in non-
  // infra sectors (the macro theme doesn't apply to them either way).
  if (!isBenef) return { points: 1, max: 2, status: "partial", value: sector, note: `Sector not on the infra-beneficiary list — 1 pt neutral per client framework.` };
  if (!active) return { points: 0, max: 2, status: "fail", value: sector, note: "Government capex push not flagged as active in macro context." };
  return { points: 2, max: 2, status: "pass", value: sector, note: m.regime?.gov_capex_note || "In a sector benefiting from active government capex push." };
}

function ruleRateCuts(c) {
  const m = c?._macro;
  if (!m) return { ...NA, max: 2 };
  const na = naIfNoSector(c, 2); if (na) return na;
  const inCycle = m.regime?.rate_cut_cycle;
  const isBenef = inTheme(c, "rate_sensitive");
  const sector = getSector(c);
  // Sector neutrality: non-rate-sensitive sectors get 1 pt per client.
  if (!isBenef) return { points: 1, max: 2, status: "partial", value: sector, note: `Sector not rate-sensitive — 1 pt neutral per client framework.` };
  if (!inCycle) return { points: 1, max: 2, status: "partial", value: sector, note: "RBI not in rate-cut cycle — neutral for rate-sensitive sectors." };
  return { points: 2, max: 2, status: "pass", value: sector, note: m.regime?.rate_cut_cycle_note || "Rate-sensitive sector benefiting from RBI rate-cut cycle." };
}

function ruleChinaPlusOne(c) {
  const m = c?._macro;
  if (!m) return { ...NA, max: 2 };
  const na = naIfNoSector(c, 2); if (na) return na;
  const active = m.regime?.china_plus_one_active;
  const sector = getSector(c);

  // PRIMARY: per-company truth from annual report MD&A.
  const rm = rmix(c);
  if (rm?.china_plus_one) {
    const exp = rm.geography?.export_pct ?? null;
    const strength = rm.china_plus_one.strength;
    const ev = rm.china_plus_one.evidence;
    const yr = rm.report_year;
    if (!active) {
      return { points: 0, max: 2, status: "fail", value: `${sector} · exports ${exp ?? "?"}%`,
        note: withEvidence("China+1 theme not flagged as active in current macro regime — company-specific exposure not scored.", ev, yr) };
    }
    if (strength === "strong" && exp != null && exp >= 40) {
      return { points: 2, max: 2, status: "pass", value: `${exp}% exports · China+1 strong`,
        note: withEvidence(`Per-company verified — strong China+1 narrative, ${exp}% export revenue.`, ev, yr) };
    }
    if (strength === "moderate" || (strength === "strong" && exp != null && exp >= 25)) {
      return { points: 1, max: 2, status: "partial", value: `${exp ?? "?"}% exports · China+1 moderate`,
        note: withEvidence(`Per-company verified — moderate China+1 narrative.`, ev, yr) };
    }
    if (strength === "weak") {
      return { points: 0, max: 2, status: "fail", value: `${exp ?? "?"}% exports · China+1 weak`,
        note: withEvidence(`Per-company verified — weak/passing China+1 narrative.`, ev, yr) };
    }
    return { points: 0, max: 2, status: "fail", value: `${exp ?? "?"}% exports · no China+1`,
      note: withEvidence(`Annual report contains no China+1 narrative.`, ev, yr) };
  }

  // FALLBACK: sector / curated-list proxy (current behaviour) until per-
  // company extraction lands for this ticker. Tagged so the user can see
  // the difference between "verified" and "proxy" in the drill-down.
  const onCompanyList = !!c?.in_china_plus_one;
  const inSectorList = inTheme(c, "china_plus_one");
  if (onCompanyList) {
    if (!active) return { points: 0, max: 2, status: "fail", value: sector, note: "[Proxy — pending AR extraction] China+1 theme not flagged as active — even curated-list companies score 0." };
    return { points: 2, max: 2, status: "pass", value: sector,
      note: `[Proxy — pending AR extraction] ${m.regime?.china_plus_one_note || "Benefiting from China+1 reorientation."} On curated company list with material China+1 / EMS revenue.` };
  }
  if (inSectorList) {
    if (!active) return { points: 0, max: 2, status: "fail", value: sector, note: "[Proxy — pending AR extraction] China+1 theme not flagged as active — sector match alone scores 0." };
    return { points: 1, max: 2, status: "partial", value: sector,
      note: `[Proxy — pending AR extraction] Sector benefits from China+1 theme but company not on the curated >15%-revenue list — partial credit.` };
  }
  return { points: 1, max: 2, status: "partial", value: sector, note: `[Proxy — pending AR extraction] Neither on the China+1 curated company list nor in a benefiting sector — 1 pt neutral per client framework.` };
}

function ruleRuralRecovery(c) {
  const m = c?._macro;
  if (!m) return { ...NA, max: 1 };
  const na = naIfNoSector(c, 1); if (na) return na;
  const signal = m.regime?.rural_recovery_signal || "neutral";
  const isBenef = inTheme(c, "rural_recovery");
  const sector = getSector(c);
  // Non-rural-facing sector: 1 pt neutral per client framework.
  if (!isBenef) return { points: 1, max: 1, status: "pass", value: sector, note: `Sector not rural-facing — 1 pt neutral per client framework.` };
  if (signal === "good") return { points: 1, max: 1, status: "pass", value: sector, note: m.regime?.rural_recovery_note || "Rural indicators improving — favourable for FMCG/Tractors/Agro." };
  if (signal === "neutral") return { points: 1, max: 1, status: "partial", value: sector, note: "Rural-facing sector but indicators are mixed." };
  return { points: 0, max: 1, status: "fail", value: sector, note: "Rural signal weak / drought risk flagged." };
}

// ---- Economic Indicators (7 pts) ----

function ruleGDPGrowth(c) {
  const m = c?._macro;
  if (!m?.economic) return { ...NA, max: 2 };
  const v = m.economic.gdp_yoy;
  const up = m.economic.gdp_trending_up;
  const val = `GDP YoY ${v}%${up ? " (trending up)" : " (not trending up)"}`;
  if (v >= 6.5 && up) return { points: 2, max: 2, status: "pass", value: val, note: "GDP ≥ 6.5% and trending up — broad market re-rating tailwind." };
  if (v >= 6.0) return { points: 1, max: 2, status: "partial", value: val, note: "GDP between 6.0–6.5% — broad-market caution." };
  return { points: 1, max: 2, status: "partial", value: val, note: "GDP below 6% — broad market caution (per client framework: 1 pt caution flag)." };
}

function ruleInflation(c) {
  const m = c?._macro;
  if (!m?.economic) return { ...NA, max: 1 };
  const v = m.economic.cpi;
  const inBand = m.economic.cpi_within_rbi_band;
  const val = `CPI ${v}% (RBI target 4% ± 2%)`;
  if (inBand && v <= 5.5) return { points: 1, max: 1, status: "pass", value: val, note: "CPI within RBI band and stable — margin-friendly." };
  if (inBand) return { points: 1, max: 1, status: "partial", value: val, note: "CPI within band but elevated — margin pressure for margin-sensitive cos." };
  return { points: 0, max: 1, status: "fail", value: val, note: "CPI outside RBI band — compresses margins for input-cost-sensitive sectors." };
}

function ruleCrudeOil(c) {
  const m = c?._macro;
  if (!m?.live?.crude_brent?.latest) return { ...NA, max: 1, note: "Live crude price not yet fetched — run the Macro workflow once." };
  const na = naIfNoSector(c, 1); if (na) return na;
  const crude = m.live.crude_brent.latest;
  const trend = m.live.crude_brent.trend;
  const sector = getSector(c);
  const benefitsLow = inTheme(c, "crude_low_beneficiary");
  const hurtsHigh = inTheme(c, "crude_high_hurt");
  const val = `Brent $${crude}/bbl (${trend})`;
  if (crude < 85 && benefitsLow) return { points: 1, max: 1, status: "pass", value: val, note: `Crude below $85 — favourable for ${sector}.` };
  if (crude > 90 && hurtsHigh) return { points: 0, max: 1, status: "fail", value: val, note: `Crude above $90 — input-cost headwind for ${sector}.` };
  // Non-crude-sensitive sector: 1 pt neutral per client framework.
  return { points: 1, max: 1, status: "pass", value: val, note: `Sector not directly crude-sensitive — 1 pt neutral per client framework.` };
}

function ruleINRUSD(c) {
  const m = c?._macro;
  if (!m?.live?.usdinr?.latest) return { ...NA, max: 1, note: "Live USD/INR not yet fetched — run the Macro workflow once." };
  const na = naIfNoSector(c, 1); if (na) return na;
  const rate = m.live.usdinr.latest;
  const trend = m.live.usdinr.trend;
  const inrWeakening = trend === "rising";  // USD/INR rising == INR weakening
  const inrStrengthening = trend === "falling";
  const sector = getSector(c);
  const exporter = inTheme(c, "inr_weakening_benefit");
  const importer = inTheme(c, "inr_weakening_hurt");
  const val = `USD/INR ₹${rate} (INR ${inrWeakening ? "weakening" : inrStrengthening ? "strengthening" : "stable"})`;
  if (inrWeakening && exporter) return { points: 1, max: 1, status: "pass", value: val, note: `INR weakening trend — adds ~70 bps margin tailwind for ${sector} exporters.` };
  if (inrStrengthening && exporter) return { points: 0, max: 1, status: "fail", value: val, note: `Strong INR hurts ${sector} exporters.` };
  if (inrWeakening && importer) return { points: 0, max: 1, status: "fail", value: val, note: `INR weakening hurts ${sector} importers.` };
  // Non-INR-sensitive sector: 1 pt neutral per client framework.
  return { points: 1, max: 1, status: "pass", value: val, note: `Sector not directly INR-sensitive — 1 pt neutral per client framework.` };
}

function ruleBondYields(c) {
  const m = c?._macro;
  if (!m?.economic) return { ...NA, max: 1 };
  const na = naIfNoSector(c, 1); if (na) return na;
  const y = m.economic.gsec10y;
  const trend = m.economic.gsec10y_trend;
  const src = m.economic.gsec10y_source || "macro-context.json";
  const sector = getSector(c);
  const benefitsFall = inTheme(c, "bond_falling_benefit");
  const val = `10Y G-Sec ${y}% (${trend})`;
  const srcNote = src.toLowerCase().includes("macro-context") ? "" : ` Source: ${src}.`;
  if (trend === "declining" && benefitsFall) return { points: 1, max: 1, status: "pass", value: val, note: "Falling 10Y yield — spread compression eases for Banks/NBFCs/Realty." + srcNote };
  if (trend === "rising" && benefitsFall) return { points: 0, max: 1, status: "fail", value: val, note: "Rising yields compress NIMs for rate-sensitive financials." + srcNote };
  // Non-bond-yield-sensitive sector: 1 pt neutral per client framework.
  return { points: 1, max: 1, status: "pass", value: val, note: `Sector not directly bond-yield-sensitive — 1 pt neutral per client framework.` };
}

// ---- Government Policy (4 pts) ----

function rulePLIBeneficiary(c) {
  const m = c?._macro;
  if (!m?.pli_companies) return { ...NA, max: 2 };
  const inList = !!c?.in_pli;
  if (inList) return { points: 2, max: 2, status: "pass", value: "On PLI list", note: "Company has approved PLI allocation or confirmed PLI-scheme revenue." };
  return { points: 0, max: 2, status: "fail", value: "Not on PLI list", note: `Not in the curated list of ${m.pli_companies.length} PLI beneficiaries.` };
}

function ruleRenewableEnergy(c) {
  const m = c?._macro;
  if (!m?.renewable_companies) return { ...NA, max: 2 };
  const inList = !!c?.in_renewable;
  if (inList) return { points: 2, max: 2, status: "pass", value: "On renewable list", note: "Direct participant in renewable capacity addition (solar / wind / green energy)." };
  return { points: 0, max: 2, status: "fail", value: "Not on renewable list", note: `Not in the curated list of ${m.renewable_companies.length} renewable players.` };
}

// ---- master ----

const ACTIVE_RULES = [
  { key: "infra",      label: "Infra Push",         category: "Sector Rotation",     criteria: "Capex-led sector",     fn: ruleInfraPush },
  { key: "ratecut",    label: "Rate Cuts",          category: "Sector Rotation",     criteria: "Rate-sensitive sector", fn: ruleRateCuts },
  { key: "chinaplus1", label: "China+1",            category: "Sector Rotation",     criteria: "Chemicals / EMS",      fn: ruleChinaPlusOne },
  { key: "rural",      label: "Rural Recovery",     category: "Sector Rotation",     criteria: "FMCG / Tractors",      fn: ruleRuralRecovery },
  { key: "gdp",        label: "GDP Growth",         category: "Economic Indicators", criteria: "≥ 6.5% and rising",    fn: ruleGDPGrowth },
  { key: "cpi",        label: "Inflation",          category: "Economic Indicators", criteria: "Within RBI band",      fn: ruleInflation },
  { key: "crude",      label: "Crude Oil",          category: "Economic Indicators", criteria: "Brent < $85 (sector overlay)", fn: ruleCrudeOil },
  { key: "inr",        label: "INR / USD",          category: "Economic Indicators", criteria: "Sector × INR trend",   fn: ruleINRUSD },
  { key: "bonds",      label: "Bond Yields",        category: "Economic Indicators", criteria: "10Y yield direction",  fn: ruleBondYields },
  { key: "pli",        label: "PLI Beneficiary",    category: "Government Policy",   criteria: "On PLI scheme",        fn: rulePLIBeneficiary },
  { key: "renewable",  label: "Renewable Energy",   category: "Government Policy",   criteria: "Renewable participant", fn: ruleRenewableEnergy },
];

const DEFERRED = [];   // no deferred rules in Macro for now

export function scoreCompany(c) {
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
