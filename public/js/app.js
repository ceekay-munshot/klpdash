import * as fund from "./scoring.js";
import * as tech from "./tech-scoring.js";
import * as macro from "./macro-scoring.js";
import * as senliq from "./sentiment-liquidity-scoring.js";
import * as composite from "./composite-scoring.js";
import { META as RULE_META } from "./rule-meta.js";
import { exportToExcel as exportToExcelNew } from "./excel-export.js";

// ---------------- Tab configuration ----------------
const CONFIGS = {
  fundamentals: {
    label: "Fundamentals",
    dataUrl: "data/screener-companies.json",
    metaUrl: "data/metadata.json",
    parseData: (raw) => raw,
    rules: fund.ACTIVE_RULES,
    deferred: fund.DEFERRED,
    score: fund.scoreCompany,
    // accessors
    name: (c) => c.Company,
    marketCap: (c) => c["Market Cap"] || "",
    screenerUrl: (c) => c["Screener URL"],
    sector: (c) => c["Sector"] || null,
    industry: (c) => c["Broad Industry"] || null,
    // table columns (in addition to #, Company, Score, Signals, Link)
    columns: [
      { label: "ROE",    get: (c) => c.ROE || "—" },
      { label: "ROCE",   get: (c) => c.ROCE || "—" },
      { label: "Rev 3Y", get: (c) => c["Sales growth 3Years"] || "—" },
      { label: "PAT 3Y", get: (c) => c["Profit Var 3Yrs"] || "—" },
      { label: "D/E",    get: (c) => c["Debt to equity"] || "—" },
      { label: "P/E",    get: (c) => c["Stock P/E"] || "—" },
    ],
    // 3 stat-card values for the header strip
    stats: {
      rules: "19 / 19",   rulesNote: "Active rules",
      maxScore: "29 pts", maxNote: "All rules active",
    },
    drillHeaderStats: (c) => [
      { label: "Market Cap", main: c["Market Cap"] || "—", sub: `CMP ${c["Current Price"] || "—"}` },
      { label: "Valuation & Returns",
        metrics: [
          { name: "P/E",  value: c["Stock P/E"]       || "—" },
          { name: "D/E",  value: c["Debt to equity"]  || "—" },
          { name: "ROCE", value: c["ROCE"]            || "—" },
        ],
        sub: `Capital efficiency snapshot` },
    ],
  },
  macro: {
    label: "Macro",
    dataUrl: "data/screener-companies.json",
    metaUrl: "data/macro.json",
    parseData: (raw) => raw,
    rules: macro.ACTIVE_RULES,
    deferred: macro.DEFERRED,
    score: macro.scoreCompany,
    name: (c) => c.Company,
    marketCap: (c) => c["Market Cap"] || "",
    screenerUrl: (c) => c["Screener URL"],
    sector: (c) => c["Sector"] || null,
    industry: (c) => c["Broad Industry"] || null,
    columns: [
      { label: "Sector",   get: (c) => c["Sector"] || "—" },
      { label: "Industry", get: (c) => c["Broad Industry"] || "—" },
      { label: "PLI",      get: (c) => c.in_pli ? "✓" : "—" },
      { label: "Renewable", get: (c) => c.in_renewable ? "✓" : "—" },
    ],
    stats: {
      rules: "11 / 11",   rulesNote: "Active rules",
      maxScore: "17 pts", maxNote: "Sector overlays + macro context",
    },
    drillHeaderStats: (c) => [
      { label: "Sector · Industry", main: c["Sector"] || "—",
        sub: c["Broad Industry"] || "" },
      { label: "Policy flags",
        main: [c.in_pli ? "PLI" : null, c.in_renewable ? "Renewable" : null].filter(Boolean).join(" · ") || "—",
        sub: "" },
    ],
  },
  sentiment: {
    label: "Sentiment & Liquidity",
    dataUrl: "data/technicals.json",
    metaUrl: "data/macro.json",
    parseData: (raw) => ({ rows: raw.companies || [], meta: raw }),
    rules: senliq.ACTIVE_RULES,
    deferred: senliq.DEFERRED,
    score: senliq.scoreCompany,
    name: (c) => c.name,
    marketCap: (c) => c.marketCap || "",
    screenerUrl: (c) => c.screenerUrl,
    sector: (c) => c.sector || null,
    industry: (c) => c.industry || null,
    columns: [
      { label: "Sector",  get: (c) => c.sector || "—" },
      { label: "ADTV ₹Cr", get: (c) => c.adtv_20d_cr == null ? "—" : "₹" + c.adtv_20d_cr },
      { label: "F&O",     get: (c) => c.fno_eligible ? "✓" : "—" },
      { label: "CMP",     get: (c) => c.cmp ? "₹" + Math.round(c.cmp).toLocaleString("en-IN") : "—" },
    ],
    stats: {
      rules: "8 / 8",    rulesNote: "Active rules",
      maxScore: "12 pts", maxNote: "Impact + Spread estimated from OHLCV",
    },
    drillHeaderStats: (c) => [
      { label: "ADTV · F&O",
        main: c.adtv_20d_cr == null ? "—" : "₹" + c.adtv_20d_cr + " Cr",
        sub: c.fno_eligible ? "On NSE F&O list" : "Cash-only" },
      { label: "Sentiment regime",
        main: c._macro?.live?.india_vix?.latest != null ? "VIX " + c._macro.live.india_vix.latest : "—",
        sub: c._macro?.sentiment?.fii_net_positive_last_20d === "yes" ? "FII flow net positive" : (c._macro?.sentiment?.fii_net_positive_last_20d || "") },
    ],
  },
  technicals: {
    label: "Technicals",
    dataUrl: "data/technicals.json",
    metaUrl: null,
    parseData: (raw) => ({ rows: raw.companies || [], meta: raw }),
    rules: tech.ACTIVE_RULES,
    deferred: tech.DEFERRED,
    score: tech.scoreCompany,
    name: (c) => c.name,
    marketCap: (c) => c.marketCap || "",
    screenerUrl: (c) => c.screenerUrl,
    sector: (c) => c.sector || null,
    industry: (c) => c.industry || null,
    columns: [
      { label: "CMP",  get: (c) => c.cmp ? "₹" + Math.round(c.cmp).toLocaleString("en-IN") : "—" },
      { label: "RSI",  get: (c) => c.rsi14 ?? "—" },
      { label: "ADX",  get: (c) => c.adx14 ?? "—" },
      { label: "6M RS", get: (c) => c.relative_strength_6m == null ? "—" : (c.relative_strength_6m > 0 ? "+" : "") + (c.relative_strength_6m * 100).toFixed(1) + "%" },
      { label: "Beta", get: (c) => c.beta_1y ?? "—" },
      { label: "ATR%", get: (c) => c.atr14_pct == null ? "—" : c.atr14_pct + "%" },
    ],
    stats: {
      rules: "16 / 16",   rulesNote: "Active rules",
      maxScore: "24 pts", maxNote: "All rules active",
    },
    drillHeaderStats: (c) => [
      { label: "CMP · 52W High", main: c.cmp ? "₹" + Math.round(c.cmp).toLocaleString("en-IN") : "—",
        sub: c.high_52w ? `52W ₹${Math.round(c.high_52w).toLocaleString("en-IN")}` : "" },
      { label: "Momentum & Risk",
        metrics: [
          { name: "RSI",  value: c.rsi14 ?? "—" },
          { name: "ADX",  value: c.adx14 ?? "—" },
          { name: "β",    value: c.beta_1y ?? "—" },
        ],
        sub: c.relative_strength_6m == null ? "" : `6M relative strength ${(c.relative_strength_6m * 100).toFixed(1)}% vs Nifty 500` },
    ],
  },
  composite: {
    label: "SPIP Basket",
    composite: true,                  // marker — special loading + drill
    // Loaded specially in loadTab (fuses fundamentals + technicals + macro).
    dataUrl: "data/screener-companies.json",
    metaUrl: "data/macro.json",
    parseData: (raw) => raw,
    rules: [],                        // no per-rule breakdown — pillars instead
    deferred: [],
    score: (x) => x,                  // identity — scoring is done in loadTab
    // Accessors receive s.company (the fund row), matching all other tabs.
    name: (co) => co?.Company || "",
    marketCap: (co) => co?.["Market Cap"] || "",
    screenerUrl: (co) => co?.["Screener URL"],
    sector: (co) => co?.["Sector"] || null,
    industry: (co) => co?.["Broad Industry"] || null,
    // Column getters read from co._composite which loadTab stashes on each row.
    // Composite-as-number is already shown in the standard Score pill column —
    // no duplicate column here.
    columns: [
      { label: "Rating", html: true, get: (co) => {
        const r = co._composite?.rating;
        if (!r) return `<span class="text-slate-400">—</span>`;
        const cls = composite.ratingClass(r);
        return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ring-1 whitespace-nowrap ${cls}">${escapeHtml(r)}</span>`;
      } },
      { label: "Fund", get: (co) => `${co._composite?.pillars?.fundamentals?.raw ?? "—"}/29` },
      { label: "Tech", get: (co) => co._composite?.pillars?.technicals?.raw == null ? "—" : `${co._composite.pillars.technicals.raw}/${co._composite.pillars.technicals.max}` },
      { label: "Macro", get: (co) => `${co._composite?.pillars?.macro?.raw ?? "—"}/17` },
      { label: "Sent", get: (co) => co._composite?.pillars?.sentiment?.raw == null ? "—" : `${co._composite.pillars.sentiment.raw}/${co._composite.pillars.sentiment.max}` },
      { label: "Liq", get: (co) => co._composite?.pillars?.liquidity?.raw == null ? "—" : `${co._composite.pillars.liquidity.raw}/${co._composite.pillars.liquidity.max}` },
    ],
    stats: {
      rules: "5 pillars",  rulesNote: "Weighted: 40 · 35 · 15 · 5 · 5",
      maxScore: "100 pts", maxNote: "≥75 STRONG BUY · 60 BUY · 45 WATCH",
    },
    drillHeaderStats: (co) => [
      { label: "Market Cap", main: co["Market Cap"] || "—", sub: `CMP ${co["Current Price"] || "—"}` },
      { label: "Rating",     main: co._composite?.rating || "—",
        sub: co._composite?.composite != null ? `Composite ${co._composite.composite.toFixed(1)} / 100` : "Unrated — data missing" },
    ],
  },
  // Premium hero page — surfaces stocks scoring above 75 composite
  // (STRONG BUY band) with hard-fails excluded. Renders bespoke cards,
  // not the standard table layout — handled by renderTopPicks().
  topPicks: {
    label: "Top Picks",
    hero: true,
  },
  // History — shows realized return on every past STRONG BUY pick.
  // Data comes from public/data/snapshots/* (daily JSON files written by
  // screener-test/write-snapshot.mjs). Lazy-loaded on tab activation.
  history: {
    label: "History",
    history: true,
  },
};

// ---------------- State ----------------
// Watchlist persisted in localStorage. Stored as an array of company
// identifiers (Screener URL slug — stable across sessions). Toggled via
// the ☆/★ button in each row and the "Watchlist" filter pill in the toolbar.
// Client-adjustable pillar weights — stored in localStorage so the
// per-client tweak survives reloads. Defaults to the framework's
// PILLAR_WEIGHTS (40/35/15/5/5). SPIP basket + Top Picks tabs re-score
// composites whenever the user changes these.
const PILLAR_WEIGHTS_KEY = "klpdash-pillar-weights-v1";
function loadPillarWeights() {
  try {
    const stored = JSON.parse(localStorage.getItem(PILLAR_WEIGHTS_KEY) || "null");
    if (stored && typeof stored === "object") {
      // Sanity-clamp + sum normalisation guard so a corrupted value
      // can't silently break composite scoring.
      const w = {
        fundamentals: Math.max(0, Math.min(100, Number(stored.fundamentals) || 0)),
        technicals:   Math.max(0, Math.min(100, Number(stored.technicals)   || 0)),
        macro:        Math.max(0, Math.min(100, Number(stored.macro)        || 0)),
        sentiment:    Math.max(0, Math.min(100, Number(stored.sentiment)    || 0)),
        liquidity:    Math.max(0, Math.min(100, Number(stored.liquidity)    || 0)),
      };
      const sum = w.fundamentals + w.technicals + w.macro + w.sentiment + w.liquidity;
      if (sum >= 95 && sum <= 105) return w; // accept ±5 tolerance
    }
  } catch {}
  return { ...composite.PILLAR_WEIGHTS };
}
function savePillarWeights(w) {
  try { localStorage.setItem(PILLAR_WEIGHTS_KEY, JSON.stringify(w)); } catch {}
}

// Client-configurable allocation per pick for the History portfolio
// backtest. Defaults to ₹1L. Stored as a plain integer in localStorage.
const ALLOC_KEY = "klpdash-alloc-per-pick-v1";
function loadAllocPerPick() {
  try {
    const v = Number(localStorage.getItem(ALLOC_KEY));
    if (Number.isFinite(v) && v >= 1000) return v;
  } catch {}
  return 100000;
}
function saveAllocPerPick(n) {
  try { localStorage.setItem(ALLOC_KEY, String(n)); } catch {}
}

const WATCHLIST_KEY = "klpdash-watchlist-v1";
function loadWatchlist() {
  try { return new Set(JSON.parse(localStorage.getItem(WATCHLIST_KEY) || "[]")); }
  catch { return new Set(); }
}
function saveWatchlist(set) {
  try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...set])); }
  catch {}
}
function companyKey(co) {
  // Stable identifier: URL slug from Screener URL (NSE ticker or BSE code)
  const slug = String(co?.["Screener URL"] || co?.["Composite URL"] || "").match(/\/company\/([^/]+)/)?.[1];
  return slug ? slug.toUpperCase() : (co?.Company || co?.name || "").toUpperCase();
}

const state = {
  activeTab: "fundamentals",
  cache: {},                  // tab → { scored, raw, meta, filtered }
  search: "",
  scoreFilter: "all",
  sortBy: "score",
  sortDir: "desc",
  watchlist: loadWatchlist(),
  watchOnly: false,
  pillarWeights: loadPillarWeights(),
  allocPerPick: loadAllocPerPick(),
  // Lazy composite cache — populated on first drill-down or when composite
  // tab loads. Maps slug → composite result { pillars, composite, rating, ... }.
  compositeBySlug: new Map(),
  lazyTechBySlug: null,        // Map slug → tech row (loaded on demand)
  lazyMacroCtx: null,          // raw macro.json (loaded on demand)
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---------------- visual helpers ----------------
const PALETTE = [
  "from-purple-500 to-indigo-500", "from-pink-500 to-rose-500", "from-amber-500 to-orange-500",
  "from-emerald-500 to-teal-500", "from-blue-500 to-cyan-500", "from-fuchsia-500 to-pink-500",
  "from-violet-500 to-purple-500", "from-lime-500 to-emerald-500", "from-sky-500 to-indigo-500",
  "from-red-500 to-pink-500", "from-yellow-500 to-amber-500", "from-teal-500 to-cyan-500",
];
function avatarFor(name) {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const color = PALETTE[h % PALETTE.length];
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase().slice(0, 2) || "?";
  return { color, initials };
}
function scoreBadgeClass(pct) {
  if (pct >= 80) return "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200";
  if (pct >= 60) return "bg-blue-100 text-blue-700 ring-1 ring-blue-200";
  if (pct >= 40) return "bg-amber-100 text-amber-700 ring-1 ring-amber-200";
  return "bg-rose-100 text-rose-700 ring-1 ring-rose-200";
}
function scoreTier(pct) {
  if (pct >= 80) return "excellent";
  if (pct >= 60) return "good";
  if (pct >= 40) return "average";
  return "weak";
}
function tierLabel(t) { return ({ excellent: "Excellent", good: "Good", average: "Average", weak: "Weak", hardfail: "Hard Fail" })[t]; }
function tierColor(t) { return ({ excellent: "text-emerald-600", good: "text-blue-600", average: "text-amber-600", weak: "text-rose-600", hardfail: "text-rose-700" })[t]; }
// Gradient theme keyed off the per-tab tier — feeds renderScoreGauge / renderPillarRadar
// (both expect the { from, to } shape that ratingTheme returns for composite tab).
function themeFromTier(t) {
  const map = {
    excellent: { from: "from-emerald-500", to: "to-teal-500" },
    good:      { from: "from-blue-500",    to: "to-indigo-500" },
    average:   { from: "from-amber-500",   to: "to-orange-500" },
    weak:      { from: "from-rose-500",    to: "to-pink-500" },
    hardfail:  { from: "from-slate-500",   to: "to-slate-600" },
  };
  return map[t] || { from: "from-slate-400", to: "to-slate-500" };
}
function statusPill(status) {
  switch (status) {
    case "pass":      return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">✓ Pass</span>`;
    case "partial":   return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 ring-1 ring-amber-200">~ Partial</span>`;
    case "fail":      return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 ring-1 ring-rose-200">✕ Fail</span>`;
    case "hard_fail": return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800 ring-1 ring-rose-300">⚠ Hard Fail</span>`;
    case "na":        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 ring-1 ring-slate-200">— N/A</span>`;
    default: return "";
  }
}
function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

// SVG icons (heroicons-style, monoline)
const ICON_LINK = `<svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>`;
const ICON_CALC = `<svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 7h6m-6 4h6m-3 4h3M7 21h10a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z"/></svg>`;
const ICON_LOGIC = `<svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z"/></svg>`;
const ICON_CHEVRON = `<svg class="w-2.5 h-2.5 flex-shrink-0 text-slate-400 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>`;

// Renders 3 small chips on each drill-down rule card:
//   Source — opens the actual data source in a new tab
//   Calculation — expands to show the formula (only when computed)
//   Implementation — expands; if we deviate from client (source, calc,
//   or scoring), chip is amber + shows client logic vs our implementation
function renderRuleMetaButtons(ruleKey, company) {
  const tab = state.activeTab;
  const meta = RULE_META[tab]?.[ruleKey];
  if (!meta) return "";
  const src = typeof meta.source === "function" ? meta.source(company || {}) : meta.source;

  const baseChip = "group inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-md border transition-colors select-none";
  const neutralChip = "bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border-slate-200 hover:border-slate-300";
  const amberChip   = "bg-amber-50 hover:bg-amber-100 text-amber-800 hover:text-amber-900 border-amber-200 hover:border-amber-300";

  const sourceBtn = src ? `
    <a href="${escapeHtml(src.url)}" target="_blank" rel="noopener"
       class="${baseChip} ${neutralChip} no-underline"
       title="${escapeHtml(src.label + (src.section ? " — " + src.section : ""))}">
      ${ICON_LINK}<span>${escapeHtml(src.label)}</span>
    </a>` : "";

  const calcBtn = meta.calculation ? `
    <details class="meta-details">
      <summary class="${baseChip} ${neutralChip} cursor-pointer">
        ${ICON_CALC}<span>Calculation</span>${ICON_CHEVRON}
      </summary>
      <div class="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-700 leading-relaxed">
        ${escapeHtml(meta.calculation)}
      </div>
    </details>` : "";

  const logicBody = meta.ourLogic
    ? `<div>
         <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Client's scoring logic</div>
         <div class="text-slate-700 mb-3">${escapeHtml(meta.clientLogic)}</div>
         <div class="text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-1">Our implementation</div>
         <div class="text-amber-800">${escapeHtml(meta.ourLogic)}</div>
       </div>`
    : `<div>
         <div class="text-slate-700">${escapeHtml(meta.clientLogic)}</div>
         <div class="text-[10px] text-emerald-600 mt-2 font-bold uppercase tracking-wider">✓ Matches our implementation exactly</div>
       </div>`;

  const logicBtn = meta.clientLogic ? `
    <details class="meta-details">
      <summary class="${baseChip} ${meta.ourLogic ? amberChip : neutralChip} cursor-pointer">
        ${ICON_LOGIC}<span>Implementation${meta.ourLogic ? " · diff" : ""}</span>${ICON_CHEVRON}
      </summary>
      <div class="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-md text-xs leading-relaxed">${logicBody}</div>
    </details>` : "";

  if (!sourceBtn && !calcBtn && !logicBtn) return "";
  return `
    <div class="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-100">
      ${sourceBtn}${calcBtn}${logicBtn}
    </div>`;
}
function cfg() { return CONFIGS[state.activeTab]; }
function tabState() { return state.cache[state.activeTab]; }

// ---------------- load / switch tab ----------------
async function switchTab(tabId) {
  if (!CONFIGS[tabId]) return;
  // Toggle nav. All tabs carry a permanent transparent `border-b-2`
  // (for layout consistency — keeps the row height constant regardless
  // of active state). The visible underline is painted exclusively by
  // the .tab-btn::after pseudo-element driven by .is-active, so we
  // never touch border-colour classes here (toggling those alongside
  // ::after produces the double-underline reported by user).
  $$(".tab-btn").forEach((b) => {
    const active = b.dataset.tab === tabId;
    b.classList.toggle("text-indigo-600", active);
    b.classList.toggle("text-slate-500", !active);
    b.classList.toggle("hover:text-slate-700", !active);
    b.classList.toggle("is-active", active);
  });
  state.activeTab = tabId;
  state.search = "";
  state.scoreFilter = "all";
  state.sortBy = "score";
  state.sortDir = "desc";
  $("#search").value = "";
  $("#score-filter").value = "all";

  // Section toggles per tab type:
  // - Hero    (Top Picks): only #top-picks-section visible
  // - History            : only #history-section visible
  // - Normal             : all other sections
  const c = CONFIGS[tabId];
  const hero = !!c?.hero;
  const history = !!c?.history;
  const bespoke = hero || history;
  document.querySelectorAll("main > section").forEach((sec) => {
    if (sec.id === "top-picks-section") sec.classList.toggle("hidden", !hero);
    else if (sec.id === "history-section") sec.classList.toggle("hidden", !history);
    else sec.classList.toggle("hidden", bespoke);
  });
  if (hero) {
    // Composite scoring drives Top Picks. Lazy-build the composite cache.
    if (!state.cache.composite) await loadTab("composite");
    renderTopPicks();
    return;
  }
  if (history) {
    await renderHistory();
    return;
  }

  if (!state.cache[tabId]) await loadTab(tabId);
  renderAll();
}

async function loadTab(tabId) {
  const c = CONFIGS[tabId];

  // Composite (SPIP Basket) tab: fuse fundamentals + technicals + macro
  // (the same enrichments the per-pillar tabs do) and run the weighted
  // composite scorer. The output rows are composite-result objects, not
  // plain companies — drill/table renderers branch on c.composite.
  if (c.composite) {
    const [fundData, techData, macroData] = await Promise.all([
      fetch("data/screener-companies.json").then((r) => r.json()),
      fetch("data/technicals.json").then((r) => r.json()),
      fetch("data/macro.json").then((r) => r.json()),
    ]);
    const fundCompanies = Array.isArray(fundData) ? fundData : (fundData.companies || []);
    const techCompanies = techData.companies || [];

    // Apply the same per-tab enrichments so each pillar scores identically
    // to the standalone tab. Best-effort fetches.
    let insiderByTicker = {}, governanceByTicker = {}, auditorByTicker = {};
    let insiderLoaded = false, governanceLoaded = false, auditorLoaded = false;
    try { insiderByTicker = await loadInsiderMerged(); insiderLoaded = Object.keys(insiderByTicker).length > 0; } catch {}
    // Per-company annual-report extraction (replaces sector proxies in macro rules
    // once extraction lands for a ticker — routine processes ~10/day in SPIP order).
    let revenueMixByTicker = {};
    try { revenueMixByTicker = (await fetch("data/company-revenue-mix.json").then((r) => r.json()))?.companies || {}; } catch {}
    try { const j = await fetch("data/governance-flags.json").then((r) => r.json()); governanceByTicker = j?.flagged_companies || {}; governanceLoaded = !!j && !j.error; } catch {}
    try { const j = await fetch("data/auditor-opinions.json").then((r) => r.json()); auditorByTicker = j?.companies || {}; auditorLoaded = !!j && Object.keys(auditorByTicker).length > 0; } catch {}
    const pli   = new Set((macroData.pli_companies || []).map((s) => String(s).toUpperCase()));
    const renew = new Set((macroData.renewable_companies || []).map((s) => String(s).toUpperCase()));
    const cp1   = new Set((macroData.china_plus_one_companies || []).map((s) => String(s).toUpperCase()));
    for (const row of fundCompanies) {
      const m = String(row["Screener URL"] || "").match(/\/company\/([^/]+)/);
      const ticker = m ? m[1].toUpperCase() : null;
      // Insider / governance / auditor (Fundamentals enrichments)
      const ins = ticker ? insiderByTicker[ticker] : null;
      row.insider_loaded = insiderLoaded;
      if (ins) {
        row.insider_net_shares = ins.net_shares; row.insider_net_value = ins.net_value;
        row.insider_buy_shares = ins.buy_shares; row.insider_sell_shares = ins.sell_shares;
        row.insider_transactions = ins.transactions; row.insider_last_date = ins.last_date;
        row.insider_pledges_excluded = ins.pledges_excluded || 0;
      } else { row.insider_transactions = 0; }
      row.governance_loaded = governanceLoaded;
      row.governance_flag = ticker && governanceByTicker[ticker] ? governanceByTicker[ticker] : null;
      row.auditor_opinions_loaded = auditorLoaded;
      const aud = ticker ? auditorByTicker[ticker] : null;
      row.auditor_opinion = aud?.opinion || null;
      row.auditor_opinion_source = aud?.source || null;
      row.auditor_firm = aud?.auditor_firm || null;
      row.auditor_opinion_date = aud?.auditor_opinion_date || null;
      row.auditor_report_year = aud?.auditor_report_year || null;
      row.auditor_emphasis_of_matter = aud?.auditor_emphasis_of_matter || null;
      row.auditor_key_concerns = aud?.auditor_key_concerns || null;
      row.auditor_confidence = aud?.auditor_confidence || null;
      // Macro sector overlays
      row.in_pli = ticker ? pli.has(ticker) : false;
      row.in_renewable = ticker ? renew.has(ticker) : false;
      row.in_china_plus_one = ticker ? cp1.has(ticker) : false;
      // Per-company revenue-mix extraction (truth from annual report,
      // replaces sector proxy in macro rules once extraction lands).
      row._revenue_mix = ticker ? (revenueMixByTicker[ticker] || null) : null;
    }
    // ATR history for technicals
    try {
      const atrHistory = await fetch("data/atr-history.json").then((r) => r.json());
      for (const row of techCompanies) if (row.ticker && atrHistory[row.ticker]) row.atr_history = atrHistory[row.ticker];
    } catch {}

    const compositeResults = composite.scoreCompositeBatch(fundCompanies, techCompanies, macroData, state.pillarWeights);
    // Stash composite result on the company so column getters can reach it,
    // and map to the score-shape existing renderers expect.
    const scored = compositeResults.map((r) => {
      r.company._composite = r;
      return {
        company: r.company,
        composite: r.composite,
        rating: r.rating,
        pillars: r.pillars,
        pillarResults: r.pillarResults,
        hardFails: r.hardFails,
        hardFailed: r.hardFailed,
        unrated: !r.dataComplete,
        totalPoints: r.composite ?? 0,
        totalMax: 100,
        scorePct: r.composite != null ? Math.round(r.composite) : 0,
        breakdown: [],
        naCount: 0,
      };
    });
    state.cache[tabId] = { rows: fundCompanies, scored, meta: macroData, filtered: scored };
    return;
  }

  const [rawData, rawMeta] = await Promise.all([
    fetch(c.dataUrl).then((r) => r.json()),
    c.metaUrl ? fetch(c.metaUrl).then((r) => r.json()) : Promise.resolve(null),
  ]);
  const parsed = c.parseData(rawData);
  const rows = parsed.rows || parsed;
  const meta = parsed.meta || rawMeta || rawData;

  // Fundamentals tab: merge insider-trades.json + governance-flags.json
  // onto each row by NSE ticker. Both files are best-effort — missing
  // or empty file degrades cleanly to N/A in the associated rule.
  if (tabId === "fundamentals") {
    let insiderByTicker = {};
    let insiderLoaded = false;
    try {
      insiderByTicker = await loadInsiderMerged();
      insiderLoaded = Object.keys(insiderByTicker).length > 0;
    } catch { /* insider file missing — rule shows N/A */ }

    let governanceByTicker = {};
    let governanceLoaded = false;
    try {
      const gov = await fetch("data/governance-flags.json").then((r) => r.json());
      governanceByTicker = gov?.flagged_companies || {};
      // Treat the file as "loaded" whenever it parses — even an empty
      // flagged_companies map is a real signal ("no SEBI proceedings"),
      // not "data missing".
      governanceLoaded = !!gov && !gov.error;
    } catch { /* governance file missing — rule shows N/A */ }

    let auditorByTicker = {};
    let auditorLoaded = false;
    try {
      const aud = await fetch("data/auditor-opinions.json").then((r) => r.json());
      auditorByTicker = aud?.companies || {};
      auditorLoaded = !!aud && Object.keys(auditorByTicker).length > 0;
    } catch { /* file missing — rule shows N/A until first refresh writes it */ }

    for (const row of rows) {
      const m = String(row["Screener URL"] || "").match(/\/company\/([^/]+)/);
      const ticker = m ? m[1].toUpperCase() : null;
      const insiderData = ticker ? insiderByTicker[ticker] : null;
      row.insider_loaded = insiderLoaded;
      if (insiderData) {
        row.insider_net_shares  = insiderData.net_shares;
        row.insider_net_value   = insiderData.net_value;
        row.insider_buy_shares  = insiderData.buy_shares;
        row.insider_sell_shares = insiderData.sell_shares;
        row.insider_transactions = insiderData.transactions;
        row.insider_pledges_excluded = insiderData.pledges_excluded || 0;
        row.insider_last_date   = insiderData.last_date;
      } else {
        row.insider_transactions = 0;
      }
      row.governance_loaded = governanceLoaded;
      row.governance_flag = ticker && governanceByTicker[ticker] ? governanceByTicker[ticker] : null;
      row.auditor_opinions_loaded = auditorLoaded;
      const auditEntry = ticker ? auditorByTicker[ticker] : null;
      row.auditor_opinion = auditEntry?.opinion || null;
      row.auditor_opinion_source = auditEntry?.source || null;
      row.auditor_firm = auditEntry?.auditor_firm || null;
      row.auditor_opinion_date = auditEntry?.auditor_opinion_date || null;
      row.auditor_report_year = auditEntry?.auditor_report_year || null;
      row.auditor_emphasis_of_matter = auditEntry?.auditor_emphasis_of_matter || null;
      row.auditor_key_concerns = auditEntry?.auditor_key_concerns || null;
      row.auditor_confidence = auditEntry?.auditor_confidence || null;
    }
  }

  // Macro tab: merge the loaded macro.json into each row as ._macro, and
  // set per-company convenience flags in_pli / in_renewable / in_china_plus_one
  // based on NSE ticker (extracted from Screener URL slug).
  if (tabId === "macro" && rawMeta) {
    const pli = new Set((rawMeta.pli_companies || []).map((s) => String(s).toUpperCase()));
    const renew = new Set((rawMeta.renewable_companies || []).map((s) => String(s).toUpperCase()));
    const cp1 = new Set((rawMeta.china_plus_one_companies || []).map((s) => String(s).toUpperCase()));
    let revenueMixByTicker = {};
    try { revenueMixByTicker = (await fetch("data/company-revenue-mix.json").then((r) => r.json()))?.companies || {}; } catch {}
    for (const row of rows) {
      const m = String(row["Screener URL"] || "").match(/\/company\/([^/]+)/);
      const ticker = m ? m[1].toUpperCase() : null;
      row._macro = rawMeta;
      row.in_pli = ticker ? pli.has(ticker) : false;
      row.in_renewable = ticker ? renew.has(ticker) : false;
      row.in_china_plus_one = ticker ? cp1.has(ticker) : false;
      row._revenue_mix = ticker ? (revenueMixByTicker[ticker] || null) : null;
    }
  }

  // Sentiment & Liquidity: tab data is technicals.json (gives us ADTV +
  // F&O eligibility + bid/ask snapshot per company), and macro.json provides
  // the market-wide sentiment context (VIX, FII/DII flow, breadth). Plus
  // we fold in sentiment-extras.json — Firecrawl-sourced PCR + per-ticker
  // Impact Cost map (NSE blocks our IPs directly; Firecrawl proxies through).
  if (tabId === "sentiment" && rawMeta) {
    let extras = null;
    try { extras = await fetch("data/sentiment-extras.json").then((r) => r.json()); }
    catch { /* sentiment-extras.json missing — rules stay deferred */ }
    const impactByTicker = extras?.impact_cost?.companies || {};
    // Stamp PCR onto the macro object so the rule reads from a stable place.
    if (rawMeta && extras?.pcr?.value != null) {
      rawMeta.sentiment = rawMeta.sentiment || {};
      rawMeta.sentiment.put_call_ratio = extras.pcr.value;
      rawMeta.sentiment.put_call_ratio_source = extras.pcr.source;
      rawMeta.sentiment.put_call_ratio_stale = !!extras.pcr.stale;
    }
    for (const row of rows) {
      row._macro = rawMeta;
      // Ticker key: prefer the explicit field, else derive from Screener URL slug.
      let ticker = (row.ticker || row.symbol || "").toUpperCase();
      if (!ticker) {
        const m = String(row.screenerUrl || "").match(/\/company\/([^/]+)/);
        if (m) ticker = m[1].toUpperCase();
      }
      const ic = ticker ? impactByTicker[ticker] : null;
      // impact_cost map values can be either a bare number or { impact_cost_pct }
      if (typeof ic === "number") row.impact_cost_pct = ic;
      else if (ic && ic.impact_cost_pct != null) row.impact_cost_pct = ic.impact_cost_pct;
      // bid_ask_spread_pct already arrives on each technicals row when Yahoo's
      // snapshot meta carried it — nothing extra to do here.
    }
  }

  // Technicals + Sentiment tabs: merge ATR history per ticker so the ATR
  // Stability rule can detect declining vs rising volatility trend.
  if (tabId === "technicals" || tabId === "sentiment") {
    try {
      const atrHistory = await fetch("data/atr-history.json").then((r) => r.json());
      for (const row of rows) if (row.ticker && atrHistory[row.ticker]) row.atr_history = atrHistory[row.ticker];
    } catch { /* file may not exist yet — accumulator will populate over days */ }

    // Per-company source values from TradingView (scrape-technicals-source.mjs).
    // When available for a ticker, we silently overwrite the OHLCV-derived
    // indicator values so the dashboard shows what an analyst would see on
    // TradingView. Missing tickers keep their calculated values.
    try {
      const src = await fetch("data/technicals-source.json").then((r) => r.json());
      const bySlug = src?.companies || {};
      for (const row of rows) {
        const s = row.ticker && bySlug[row.ticker.toUpperCase()];
        if (!s) continue;
        const o = s.oscillators || {};
        const ma = s.moving_averages || {};
        // Track which fields were sourced from TradingView so rule-meta.js
        // can label the Source button accurately per-rule.
        const sourced = new Set();
        if (o.rsi_14   != null) { row.rsi14  = o.rsi_14;   sourced.add("rsi14"); }
        if (o.adx_14   != null) { row.adx14  = o.adx_14;   sourced.add("adx14"); }
        if (ma.ema_50  != null) { row.ema50  = ma.ema_50;  sourced.add("ema50"); }
        if (ma.sma_50  != null) { row.sma50  = ma.sma_50;  sourced.add("sma50"); }
        if (ma.sma_200 != null) { row.sma200 = ma.sma_200; sourced.add("sma200"); }
        if (sourced.size) row._source_tech_fields = sourced;
      }
    } catch { /* source file may not exist yet */ }
  }

  const scored = rows.map(c.score).sort((a, b) => b.totalPoints - a.totalPoints);
  state.cache[tabId] = { rows, scored, meta, filtered: scored };
}

// ---------------- rendering ----------------
function renderAll() {
  renderMeta();
  renderStats();
  renderDeferredList();
  renderTopCards();
  applyFilters();   // also renders the table
}

function renderMeta() {
  const c = cfg(); const st = tabState();
  const m = st.meta;
  if (m && m.generated_at) {
    $("#meta-updated").textContent = new Date(m.generated_at).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
    });
  }
  $("#meta-count").textContent = `${st.scored.length} companies`;
  // Render a friendly source label instead of dumping the raw saved-screen URL.
  $("#meta-source").textContent = sourceFriendly(c, m);
  // Top-right refresh card: show "Xh ago" + source line (replaces the
  // previous hardcoded "Daily / 06:00 IST" copy with the real freshness).
  const agoEl = $("#refresh-ago"), srcEl = $("#refresh-source");
  if (agoEl && srcEl && m && m.generated_at) {
    agoEl.textContent = relativeTimeFrom(m.generated_at);
    srcEl.textContent = sourceFriendly(c, m);
  } else if (agoEl) {
    agoEl.textContent = "—";
  }
}

// Compact relative-time formatter ("2h ago", "yesterday", "3 days ago").
function relativeTimeFrom(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diffMin = Math.round((Date.now() - t) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function sourceFriendly(c, m) {
  if (c.label === "Fundamentals") return "Screener.in saved screen · NSE 500";
  if (c.label === "Technicals") return "Yahoo Finance EOD · NSE 500";
  if (c.label === "Macro") return "Multi-source · Yahoo + RBI + curated";
  if (c.label === "Sentiment & Liquidity") return "Yahoo + NSE + computed breadth";
  if (c.label === "SPIP Basket") return "5-pillar weighted composite";
  return c.label;
}

function renderStats() {
  const c = cfg(); const st = tabState();
  const maxCard = $("#stat-max-card");
  // Composite tab overrides the stat cards. The 4-bucket strip below the
  // header carries the rating distribution, so the stat cards here stay
  // intentionally minimal — universe size + pillar weighting.
  if (c.composite && st) {
    const counts = { strong: 0, buy: 0, watch: 0, hardfail: 0, avoid: 0, unrated: 0 };
    for (const s of st.scored) {
      if (s.hardFailed) counts.hardfail++;
      else if (s.unrated) counts.unrated++;
      else if (s.rating === "STRONG BUY") counts.strong++;
      else if (s.rating === "BUY") counts.buy++;
      else if (s.rating === "WATCH") counts.watch++;
      else counts.avoid++;
    }
    const inBasket = counts.strong + counts.buy + counts.watch;
    $("#stat-rules").textContent = `${inBasket}`;
    $("#stat-rules-note").textContent = `In SPIP Basket of ${st.scored.length}`;
    // Repurpose the third card for the pillar weights mini-strip (was a
    // confusing "Max Score 300" reading before).
    $("#stat-max-label").textContent = "Pillar Weights";
    $("#stat-max").innerHTML = `<span class="text-base font-semibold text-slate-700">40 · 35 · 15 · 5 · 5</span>`;
    $("#stat-max-note").textContent = "Fund · Tech · Macro · Sent · Liq";
    if (maxCard) maxCard.classList.remove("hidden");
    // Rich title — uses innerHTML so the trophy can render properly.
    $("#top-cards-title").innerHTML = `<span class="text-amber-500">🏆</span> SPIP Basket — Top 10 Picks <span class="ml-2 text-xs font-normal text-slate-500">composite-weighted, hard-fails excluded</span>`;
    return;
  }
  $("#stat-rules").textContent = c.stats.rules;
  $("#stat-rules-note").textContent = c.stats.rulesNote;
  $("#stat-max-label").textContent = "Max Score";
  $("#stat-max").textContent = c.stats.maxScore;
  $("#stat-max-note").textContent = c.stats.maxNote;
  if (maxCard) maxCard.classList.remove("hidden");
  $("#top-cards-title").textContent = `Top 10 by ${c.label} Score`;
}

function renderDeferredList() {
  const c = cfg();
  const panel = $("#deferred-panel");
  // Composite tab has no "pending data source" concept — hide the panel entirely.
  if (c.composite || c.deferred.length === 0) {
    panel?.classList.add("hidden");
    return;
  }
  panel?.classList.remove("hidden");
  $("#deferred-summary").textContent = `${c.deferred.length} parameter${c.deferred.length>1?"s":""} pending data source`;
  $("#deferred-list").innerHTML = c.deferred.map((d) => `
    <div class="flex items-start gap-3 p-3 rounded-lg bg-amber-50 ring-1 ring-amber-100">
      <div class="text-amber-500 text-lg leading-none">⚠</div>
      <div class="flex-1">
        <div class="font-semibold text-slate-900 text-sm">${escapeHtml(d.label)} <span class="text-xs font-normal text-slate-500">· ${escapeHtml(d.category)} · max ${d.max} pts</span></div>
        <div class="text-xs text-slate-600 mt-0.5">${escapeHtml(d.reason)}</div>
      </div>
    </div>
  `).join("");
}

function renderTopCards() {
  const c = cfg(); const st = tabState();
  if (c.composite) return renderCompositeTopCards();
  const top = st.scored.slice(0, 10);
  $("#top-cards").innerHTML = top.map((s, i) => {
    const name = c.name(s.company);
    const { color, initials } = avatarFor(name);
    const tier = s.hardFails.length ? "hardfail" : scoreTier(s.scorePct);
    return `
      <button data-idx="${i}" class="top-card group text-left bg-white hover:shadow-xl hover:-translate-y-1 transition-all duration-200 rounded-2xl p-4 shadow-sm ring-1 ring-slate-100 relative overflow-hidden">
        <div class="absolute top-3 right-3 text-xs font-bold text-slate-400">#${i + 1}</div>
        <div class="flex items-center gap-3 mb-3">
          <div class="w-11 h-11 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white font-bold text-sm shadow-md">${initials}</div>
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-slate-900 truncate text-sm">${escapeHtml(name)}</div>
            <div class="text-xs text-slate-500">${escapeHtml(c.marketCap(s.company))}</div>
          </div>
        </div>
        <div class="flex items-end justify-between">
          <div>
            <div class="text-3xl font-bold ${tierColor(tier)}">${s.totalPoints}<span class="text-base text-slate-400">/${s.totalMax}</span></div>
            <div class="text-xs text-slate-500 mt-0.5">${tierLabel(tier)}</div>
          </div>
          ${s.hardFails.length ? `<div class="text-rose-500 text-xl" title="Hard fail flag">⚠</div>` : ""}
        </div>
      </button>
    `;
  }).join("");
  $$("#top-cards .top-card").forEach((el) => el.addEventListener("click", () => openDrillDown(top[Number(el.dataset.idx)])));
}

// SPIP Basket — premium overview: a rating-distribution strip
// (visual breakdown across STRONG / BUY / WATCH / AVOID / FILTERED)
// plus a hero card grid for the top 10 picks. Designed for impact.
function renderCompositeTopCards() {
  const st = tabState();
  const all = st.scored;
  // 6-bucket count (filtered + unrated separated from rated tiers)
  const counts = { strong: 0, buy: 0, watch: 0, avoid: 0, filtered: 0, unrated: 0 };
  for (const s of all) {
    if (s.hardFailed) counts.filtered++;
    else if (s.unrated) counts.unrated++;
    else if (s.rating === "STRONG BUY") counts.strong++;
    else if (s.rating === "BUY") counts.buy++;
    else if (s.rating === "WATCH") counts.watch++;
    else counts.avoid++;
  }
  const total = all.length;
  const inBasket = counts.strong + counts.buy + counts.watch;

  // Pillar-weight summary — just a compact pill showing current weights
  // with a small "Adjust" button. Full editor lives in a modal so the
  // SPIP basket header stays clean.
  const w = state.pillarWeights;
  const isDefaultWeights = ["fundamentals","technicals","macro","sentiment","liquidity"]
    .every((k) => w[k] === composite.PILLAR_WEIGHTS[k]);
  const pillarWeightPill = `
    <button id="pillar-weight-btn" type="button" class="inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-full bg-white ring-1 ring-slate-200 hover:ring-indigo-300 hover:bg-indigo-50 transition shadow-sm">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-indigo-600"><path d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16l-3-1m3 1l3-1"/></svg>
      <span class="font-semibold text-slate-700">Weights</span>
      <span class="tabular-nums text-slate-500">${w.fundamentals}·${w.technicals}·${w.macro}·${w.sentiment}·${w.liquidity}</span>
      ${isDefaultWeights ? "" : `<span class="text-[9px] font-bold uppercase tracking-wider text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">Custom</span>`}
    </button>
  `;

  // Compact single-line breakdown — distribution bar + inline chips for
  // each bucket. One row, easy to scan, no scrolling needed before the
  // user reaches the picks below.
  const seg = (pct, klass) => pct > 0 ? `<div class="${klass} h-full" style="width:${pct}%" title="${pct.toFixed(1)}%"></div>` : "";
  const pctOf = (n) => total ? (n / total) * 100 : 0;
  const cats = [
    { count: counts.strong,   label: "Strong Buy", dot: "bg-emerald-500" },
    { count: counts.buy,      label: "Buy",        dot: "bg-blue-500" },
    { count: counts.watch,    label: "Watch",      dot: "bg-amber-500" },
    { count: counts.avoid,    label: "Avoid",      dot: "bg-rose-500" },
    { count: counts.unrated,  label: "Unrated",    dot: "bg-slate-400" },
    { count: counts.filtered, label: "Hard-Fail",  dot: "bg-slate-700" },
  ];
  const distributionStrip = `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
      <div class="flex items-center gap-3 flex-1 min-w-[320px]">
        <span class="text-xs text-slate-500 whitespace-nowrap">${total} stocks scanned</span>
        <div class="flex-1 flex h-2 overflow-hidden rounded-full ring-1 ring-slate-200/80 bg-slate-100" title="${cats.map(c=>`${c.count} ${c.label}`).join(" · ")}">
          ${seg(pctOf(counts.strong),   "bg-emerald-500")}
          ${seg(pctOf(counts.buy),      "bg-blue-500")}
          ${seg(pctOf(counts.watch),    "bg-amber-500")}
          ${seg(pctOf(counts.avoid),    "bg-rose-500")}
          ${seg(pctOf(counts.unrated),  "bg-slate-300")}
          ${seg(pctOf(counts.filtered), "bg-slate-700")}
        </div>
      </div>
      ${pillarWeightPill}
    </div>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-5 text-xs text-slate-600">
      ${cats.map((c) => `
        <span class="inline-flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full ${c.dot}"></span>
          <span class="font-semibold text-slate-900 tabular-nums">${c.count}</span>
          <span class="text-slate-500">${c.label}</span>
        </span>
      `).join("")}
      <span class="ml-auto text-slate-400">→ <span class="font-semibold text-indigo-700 tabular-nums">${inBasket}</span> in basket</span>
    </div>
  `;

  // Premium hero cards for top 10 (basket only — exclude filtered/unrated/AVOID).
  const top = all.filter((s) => !s.hardFailed && !s.unrated && s.rating !== "AVOID").slice(0, 10);
  const heroCards = top.map((s, i) => {
    const co = s.company;
    const name = co.Company || "—";
    const { color, initials } = avatarFor(name);
    const theme = composite.ratingTheme(s.rating);
    const ratingTone = s.rating === "STRONG BUY" ? "text-emerald-700" : s.rating === "BUY" ? "text-blue-700" : s.rating === "WATCH" ? "text-amber-700" : "text-slate-700";
    const ribbon = i === 0 ? `<div class="absolute top-0 left-0 px-2 py-0.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[10px] font-bold uppercase tracking-wider rounded-br-lg shadow">🏆 #1</div>` : `<div class="absolute top-2 right-2 text-xs font-bold text-slate-400">#${i+1}</div>`;
    // Mini pillar bars
    const pillarBars = ["fundamentals","technicals","macro","sentiment","liquidity"].map((k) => {
      const p = s.pillars?.[k];
      const pct = p?.pct ?? 0;
      const tier = pct >= 75 ? "bg-emerald-500" : pct >= 60 ? "bg-blue-500" : pct >= 45 ? "bg-amber-500" : "bg-rose-500";
      return `<div class="flex-1 h-1 rounded-full bg-slate-100 overflow-hidden"><div class="${tier} h-full rounded-full" style="width:${Math.min(100,pct)}%"></div></div>`;
    }).join("");
    return `
      <button data-idx="${i}" class="top-card group text-left bg-white hover:shadow-2xl hover:-translate-y-1 transition-all duration-200 rounded-2xl p-4 shadow-sm ring-1 ring-slate-100 relative overflow-hidden">
        <!-- Top accent line tinted by rating -->
        <div class="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${theme.from} ${theme.to}"></div>
        ${ribbon}
        <div class="flex items-center gap-3 mb-3 mt-1">
          <div class="w-11 h-11 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white font-bold text-sm shadow-md flex-shrink-0">${initials}</div>
          <div class="flex-1 min-w-0">
            <div class="font-bold text-slate-900 truncate text-sm">${escapeHtml(name)}</div>
            <div class="text-[11px] text-slate-500 truncate">${escapeHtml(co.Sector || "")}</div>
          </div>
        </div>
        <div class="flex items-baseline gap-1 mb-1">
          <span class="text-3xl font-bold text-slate-900">${s.composite.toFixed(1)}</span>
          <span class="text-xs text-slate-400">/ 100</span>
        </div>
        <div class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r ${theme.from} ${theme.to} ${theme.textOn} text-[10px] font-bold uppercase tracking-wider shadow-sm mb-3">
          <span class="w-1 h-1 rounded-full bg-white"></span>
          ${escapeHtml(s.rating)}
        </div>
        <div class="flex items-center gap-0.5" title="Pillar scores: Fund · Tech · Macro · Sent · Liq">
          ${pillarBars}
        </div>
        <div class="text-[10px] text-slate-400 mt-1 flex justify-between">
          <span>F</span><span>T</span><span>M</span><span>S</span><span>L</span>
        </div>
      </button>
    `;
  }).join("");

  // Print cover — only renders on @media print. Title + date + key
  // counts in a clean A4-friendly layout.
  const printCover = `
    <div class="print-only print-cover">
      <div style="padding: 30mm 10mm; text-align: center;">
        <div style="font-size: 11px; letter-spacing: 0.25em; text-transform: uppercase; color: #64748b;">LKP Stock Screener · SPIP Brief</div>
        <h1 style="font-size: 42px; font-weight: 800; margin: 12px 0 8px; color: #0f172a;">SPIP Basket</h1>
        <p style="font-size: 14px; color: #64748b; margin: 0;">5-pillar weighted composite · NSE 500 universe · ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}</p>
        <div style="margin: 36px auto 0; max-width: 480px; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background: linear-gradient(135deg, #eef2ff 0%, #ecfeff 100%);">
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">
            <div>
              <div style="font-size: 28px; font-weight: 800; color: #10b981;">${counts.strong}</div>
              <div style="font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: #64748b;">Strong Buy</div>
            </div>
            <div>
              <div style="font-size: 28px; font-weight: 800; color: #3b82f6;">${counts.buy}</div>
              <div style="font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: #64748b;">Buy</div>
            </div>
            <div>
              <div style="font-size: 28px; font-weight: 800; color: #f59e0b;">${counts.watch}</div>
              <div style="font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: #64748b;">Watch</div>
            </div>
          </div>
          <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #cbd5e1; font-size: 11px; color: #64748b;">
            ${inBasket} of ${total} stocks in basket · ${counts.filtered} hard-failed · ${counts.unrated} unrated
          </div>
        </div>
        <p style="font-size: 11px; color: #94a3b8; margin-top: 36px;">For internal use only · LKP Research</p>
      </div>
    </div>
  `;

  $("#top-cards").innerHTML = `
    ${printCover}
    <div class="col-span-full">
      ${distributionStrip}
    </div>
    ${heroCards}
  `;
  $$("#top-cards .top-card").forEach((el) => el.addEventListener("click", () => openDrillDown(top[Number(el.dataset.idx)])));
  $("#pillar-weight-btn")?.addEventListener("click", () => openPillarWeightsModal());
}

// Pillar Weights modal — invoked from the SPIP basket header pill.
function openPillarWeightsModal() {
  const w = state.pillarWeights;
  const isDefault = ["fundamentals","technicals","macro","sentiment","liquidity"]
    .every((k) => w[k] === composite.PILLAR_WEIGHTS[k]);
  openModal(`
    <div class="px-7 py-6">
      <div class="flex items-start justify-between gap-4 mb-1">
        <div>
          <h2 class="font-display text-xl font-bold text-slate-900">Adjust Pillar Weights</h2>
          <p class="text-sm text-slate-500 mt-1">Set the relative importance of each pillar. Composite scores update across SPIP Basket and Top Picks.</p>
        </div>
        <button id="modal-close-btn" class="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
      </div>
      <div class="mt-5 grid grid-cols-2 sm:grid-cols-5 gap-3">
        ${["fundamentals","technicals","macro","sentiment","liquidity"].map((k) => `
          <label class="block">
            <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">${k.charAt(0).toUpperCase() + k.slice(1)}</div>
            <div class="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg focus-within:ring-2 focus-within:ring-indigo-500 focus-within:bg-white">
              <input type="number" min="0" max="100" step="1" data-weight-key="${k}" value="${w[k]}"
                class="w-full px-2 py-2 text-base font-bold tabular-nums bg-transparent border-0 focus:outline-none">
              <span class="text-xs text-slate-400 pr-2">%</span>
            </div>
            <div class="text-[10px] text-slate-400 mt-1">Default: ${composite.PILLAR_WEIGHTS[k]}</div>
          </label>
        `).join("")}
      </div>
      <div class="mt-5 flex items-center justify-between gap-2 pt-4 border-t border-slate-100">
        <div class="text-sm text-slate-600">
          Total: <span id="pillar-weight-sum" class="font-bold tabular-nums text-emerald-700">${w.fundamentals+w.technicals+w.macro+w.sentiment+w.liquidity}</span>%
          <span class="text-xs text-slate-400" id="pillar-weight-hint">${isDefault ? "(framework default)" : ""}</span>
        </div>
        <div class="flex items-center gap-2">
          <button id="pillar-weight-reset" type="button" class="px-3 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition">↺ Reset to default</button>
          <button id="pillar-weight-apply" type="button" class="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition">Apply</button>
        </div>
      </div>
    </div>
  `, { size: "wide" });
  $("#modal-close-btn")?.addEventListener("click", closeModal);
  $("#modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  }, { once: true });
  const sumEl = $("#pillar-weight-sum");
  const hintEl = $("#pillar-weight-hint");
  const inputs = $$('#modal-content input[data-weight-key]');
  function recomputeSum() {
    let s = 0;
    inputs.forEach((el) => { s += Number(el.value) || 0; });
    if (sumEl) {
      sumEl.textContent = String(s);
      sumEl.classList.toggle("text-emerald-700", s === 100);
      sumEl.classList.toggle("text-amber-700", s !== 100);
    }
    if (hintEl) hintEl.textContent = s === 100 ? "" : `(will normalise to 100 on Apply)`;
  }
  inputs.forEach((el) => el.addEventListener("input", recomputeSum));
  function commitAndClose(next) {
    state.pillarWeights = next;
    savePillarWeights(next);
    delete state.cache.composite;
    delete state.cache.topPicks;
    state.compositeBySlug.clear();
    closeModal();
    // Re-route to whichever rating tab the user is on (composite or topPicks).
    switchTab(state.activeTab === "topPicks" ? "topPicks" : "composite");
  }
  $("#pillar-weight-apply")?.addEventListener("click", () => {
    const next = { fundamentals: 40, technicals: 35, macro: 15, sentiment: 5, liquidity: 5 };
    inputs.forEach((el) => { next[el.dataset.weightKey] = Math.max(0, Math.min(100, Number(el.value) || 0)); });
    const s = next.fundamentals + next.technicals + next.macro + next.sentiment + next.liquidity;
    if (s > 0 && s !== 100) {
      const k = 100 / s;
      for (const key of Object.keys(next)) next[key] = Math.round(next[key] * k);
    }
    commitAndClose(next);
  });
  $("#pillar-weight-reset")?.addEventListener("click", () => commitAndClose({ ...composite.PILLAR_WEIGHTS }));
}

// Sources modal — single place to see every data source the dashboard
// touches, grouped by domain. Add new sources here as we wire them.
function openSourcesModal() {
  const groups = [
    {
      title: "Market data — live", icon: "💹",
      items: [
        { name: "Yahoo Finance", url: "https://finance.yahoo.com", desc: "Daily OHLCV for the universe, plus Brent crude, USD/INR and India VIX live values" },
        { name: "TradingView", url: "https://in.tradingview.com/", desc: "RSI, MACD, ADX, moving averages — scraped daily so dashboard values match the analyst's screen" },
      ],
    },
    {
      title: "Fundamentals", icon: "📊",
      items: [
        { name: "Screener.in", url: "https://www.screener.in/", desc: "Top ratios, P&L / cash-flow / shareholding series — daily scrape via the saved-screen workflow" },
        { name: "BSE — Annual Reports", url: "https://www.bseindia.com/corporates/AnnualReport_New.aspx", desc: "Auditor opinion + per-company revenue-mix MD&A extraction (weekly routine)" },
      ],
    },
    {
      title: "Shareholding · Insider · Liquidity", icon: "🤝",
      items: [
        { name: "NSE PIT (Insider Trading)", url: "https://www.nseindia.com/companies-listing/corporate-filings-insider-trading", desc: "Reg 7(2) disclosures — daily" },
        { name: "NSE F&O eligible list", url: "https://www.nseindia.com/products-services/equity-derivatives-list-underlyings", desc: "Stocks with active futures + options — routine-refreshed monthly" },
        { name: "NSE BhavCopy", url: "https://www.nseindia.com/all-reports", desc: "Daily delivery percentage from sec_bhavdata_full" },
        { name: "NSE FII / DII flow", url: "https://www.nseindia.com/reports/fii-dii", desc: "Daily institutional buying / selling" },
        { name: "NSE option chain", url: "https://www.nseindia.com/option-chain", desc: "Put-Call Ratio via Firecrawl" },
      ],
    },
    {
      title: "Governance", icon: "⚖️",
      items: [
        { name: "SEBI — Orders + Press Releases", url: "https://www.sebi.gov.in/enforcement/orders.html", desc: "Active proceedings against listed entities — weekly Firecrawl" },
        { name: "Mint / Business Standard / ET — SEBI topic pages", url: "https://www.livemint.com/topic/sebi", desc: "News-driven detection of enforcement actions" },
      ],
    },
    {
      title: "Macro · Economic", icon: "🌍",
      items: [
        { name: "MoSPI", url: "https://www.mospi.gov.in/press-release", desc: "Quarterly GDP + monthly CPI — weekly routine" },
        { name: "RBI — MPC", url: "https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx", desc: "Rate-cut / hold cycle, policy rate" },
        { name: "CCIL / RBI", url: "https://www.ccilindia.com/", desc: "10-year G-Sec benchmark yield" },
        { name: "PIB / Union Budget", url: "https://pib.gov.in/", desc: "Government capex push, PLI scheme additions" },
        { name: "DPIIT / Ministry of Commerce", url: "https://www.dpiit.gov.in/", desc: "China+1 substitution + trade policy commentary" },
        { name: "NABARD / IMD", url: "https://nabard.org/", desc: "Rural-recovery + monsoon indicators" },
        { name: "MNRE", url: "https://mnre.gov.in/", desc: "Renewable energy capacity additions" },
      ],
    },
  ];
  openModal(`
    <div class="px-7 py-6 max-h-[80vh] overflow-y-auto scrollbar-thin">
      <div class="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 class="font-display text-2xl font-bold text-slate-900">All Data Sources</h2>
          <p class="text-sm text-slate-500 mt-1">Every external source that feeds this dashboard, grouped by domain.</p>
        </div>
        <button id="modal-close-btn" class="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
      </div>
      <div class="space-y-5">
        ${groups.map((g) => `
          <div>
            <div class="flex items-center gap-2 mb-2">
              <span class="text-base">${g.icon}</span>
              <h3 class="text-xs font-bold uppercase tracking-wider text-indigo-700">${g.title}</h3>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              ${g.items.map((it) => `
                <a href="${it.url}" target="_blank" rel="noopener" class="group block p-3 rounded-xl bg-slate-50 hover:bg-indigo-50/60 ring-1 ring-slate-200/70 hover:ring-indigo-200 transition">
                  <div class="flex items-start justify-between gap-2 mb-0.5">
                    <span class="font-semibold text-slate-900 text-sm group-hover:text-indigo-700">${it.name}</span>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-slate-400 group-hover:text-indigo-500 flex-shrink-0 mt-1"><path d="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                  </div>
                  <div class="text-[11px] text-slate-500 leading-snug">${it.desc}</div>
                </a>
              `).join("")}
            </div>
          </div>
        `).join("")}
      </div>
      <div class="mt-6 pt-4 border-t border-slate-100 text-[11px] text-slate-400 leading-relaxed">
        Each rule's drill-down has its own Source button that deep-links to the exact page (or PDF) where THAT number lives.
      </div>
    </div>
  `, { size: "magazine" });
  $("#modal-close-btn")?.addEventListener("click", closeModal);
  $("#modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  }, { once: true });
}

// ---------------- Top Picks (Hero) ----------------
// Client-facing premium tab. Composite ≥ 75 only, hard-fails excluded.
// Layout philosophy:
//   - Compact hero strip — single row, ~80px tall
//   - Top 3 as a "podium" with showcase cards
//   - Rest as tight horizontal row cards so 8+ picks fit per viewport
//   - Each card's visual signature is a stacked horizontal contribution
//     bar — segment widths = pillar contribution to composite, total
//     fill = composite score itself. One glance: how high + how earned.
function renderTopPicks() {
  const st = state.cache.composite;
  if (!st) return;
  const picks = st.scored.filter((s) => !s.hardFailed && !s.unrated && (s.composite ?? 0) >= 75);
  const meta = st.meta || {};

  if (picks.length === 0) {
    $("#top-picks-content").innerHTML = `
      <div class="bg-white rounded-3xl shadow-sm ring-1 ring-slate-200 p-12 text-center">
        <div class="text-6xl mb-4">🔍</div>
        <h2 class="text-2xl font-bold text-slate-900 mb-2">No stocks above 75 right now</h2>
        <p class="text-slate-600">The current macro regime + framework rules have produced no STRONG BUY picks today.<br>Try adjusting your pillar weights or wait for the next refresh.</p>
      </div>`;
    return;
  }

  const avgComposite = (picks.reduce((a, s) => a + (s.composite || 0), 0) / picks.length).toFixed(1);
  const sectors = new Set();
  picks.forEach((s) => { const sec = s.company?.["Sector"] || s.company?.["Broad Industry"]; if (sec) sectors.add(sec); });
  const topScore = picks[0]?.composite ?? 0;

  const PILLAR_KEYS = ["fundamentals", "technicals", "macro", "sentiment", "liquidity"];
  const PILLAR_NAME = { fundamentals: "Fundamentals", technicals: "Technicals", macro: "Macro", sentiment: "Sentiment", liquidity: "Liquidity" };
  // Solid tailwind classes — one per pillar — used by both the per-card
  // contribution bar and the legend below the grid.
  const PILLAR_BAR = {
    fundamentals: "bg-emerald-500",
    technicals:   "bg-indigo-500",
    macro:        "bg-violet-500",
    sentiment:    "bg-amber-500",
    liquidity:    "bg-sky-500",
  };
  const w = state.pillarWeights || composite.PILLAR_WEIGHTS;

  // The contribution bar — visual signature of each pick.
  // Each segment's width = pillar_pct × pillar_weight / 100, summed = composite.
  // Bar total width = 100, so the filled portion equals the composite score.
  function contributionBar(s) {
    const segments = PILLAR_KEYS.map((k) => {
      const pct = s.pillars?.[k]?.pct ?? 0;
      const wt = w[k] ?? composite.PILLAR_WEIGHTS[k];
      return { key: k, contribution: (pct / 100) * wt };
    });
    return `
      <div class="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/70">
        ${segments.map(({ key, contribution }) =>
          contribution > 0
            ? `<div class="${PILLAR_BAR[key]} h-full" style="width:${contribution.toFixed(2)}%" title="${PILLAR_NAME[key]}: ${contribution.toFixed(1)} of ${w[key]} possible"></div>`
            : "").join("")}
      </div>
    `;
  }

  // Hero — slim single-bar header. Picks start ~80px below the tab nav.
  const heroHeader = `
    <div class="relative overflow-hidden rounded-2xl mb-5 print-hide">
      <div class="absolute inset-0 bg-gradient-to-r from-slate-900 via-indigo-900 to-violet-900"></div>
      <div class="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_10%_50%,rgba(245,158,11,0.35),transparent_45%)]"></div>
      <div class="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_90%_30%,rgba(16,185,129,0.4),transparent_50%)]"></div>
      <div class="relative px-6 py-4 text-white flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="text-2xl leading-none">★</div>
          <div>
            <div class="text-[10px] font-bold uppercase tracking-[0.25em] text-amber-200/80">The Top Picks</div>
            <h1 class="font-display text-2xl sm:text-[28px] font-extrabold leading-none mt-0.5">${picks.length} <span class="text-base font-bold text-white/60">stocks · composite ≥ 75</span></h1>
          </div>
        </div>
        <div class="flex items-center gap-2 text-[11px]">
          <span class="bg-white/10 backdrop-blur px-3 py-1.5 rounded-lg ring-1 ring-white/15"><span class="text-white/60">Top</span> <span class="font-bold tabular-nums text-white">${topScore.toFixed(1)}</span></span>
          <span class="bg-white/10 backdrop-blur px-3 py-1.5 rounded-lg ring-1 ring-white/15"><span class="text-white/60">Avg</span> <span class="font-bold tabular-nums text-white">${avgComposite}</span></span>
          <span class="bg-white/10 backdrop-blur px-3 py-1.5 rounded-lg ring-1 ring-white/15"><span class="text-white/60">Sectors</span> <span class="font-bold tabular-nums text-white">${sectors.size}</span></span>
          ${meta.generated_at ? `<span class="text-white/50 whitespace-nowrap">${relativeTimeFrom(meta.generated_at)}</span>` : ""}
        </div>
      </div>
    </div>
  `;

  // Podium: top 3 as showcase cards
  function podiumCard(s, i) {
    const co = s.company;
    const name = co.Company || "—";
    const { color, initials } = avatarFor(name);
    const sector = co.Sector || co["Broad Industry"] || "";
    const marketCap = co["Market Cap"] || "";
    const medals = ["🥇", "🥈", "🥉"];
    const haloByRank = [
      "from-amber-100/80 via-yellow-50 to-white",
      "from-slate-100 via-slate-50 to-white",
      "from-orange-100/70 via-amber-50 to-white",
    ];
    const accentByRank = [
      "from-amber-400 via-yellow-400 to-orange-400",
      "from-slate-300 via-slate-400 to-slate-500",
      "from-orange-400 via-amber-400 to-amber-500",
    ];
    return `
      <button data-pick-idx="${i}" class="pick-card group relative text-left w-full overflow-hidden rounded-2xl bg-gradient-to-br ${haloByRank[i]} ring-1 ring-slate-200/80 hover:ring-emerald-300 hover:shadow-xl hover:-translate-y-0.5 transition-all">
        <div class="absolute top-0 inset-x-0 h-1 bg-gradient-to-r ${accentByRank[i]}"></div>
        <div class="p-5">
          <div class="flex items-start justify-between gap-4 mb-4">
            <div class="flex items-center gap-3 min-w-0 flex-1">
              <div class="text-3xl leading-none">${medals[i]}</div>
              <div class="w-12 h-12 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white font-bold text-base shadow-md flex-shrink-0">${initials}</div>
              <div class="min-w-0">
                <div class="font-display font-bold text-slate-900 text-base leading-tight truncate" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                <div class="text-[11px] text-slate-500 truncate mt-0.5">${escapeHtml(sector)}${marketCap ? ` · ${escapeHtml(marketCap)}` : ""}</div>
              </div>
            </div>
            <div class="text-right flex-shrink-0">
              <div class="text-[9px] uppercase tracking-wider text-slate-500 font-bold leading-none mb-1">Composite</div>
              <div class="text-[40px] font-extrabold tabular-nums leading-none bg-gradient-to-br from-emerald-600 to-teal-600 bg-clip-text text-transparent">${s.composite.toFixed(1)}</div>
            </div>
          </div>
          <div class="mb-1">${contributionBar(s)}</div>
          <div class="flex items-center justify-between mt-3">
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200 text-[10px] font-bold uppercase tracking-wider">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>STRONG BUY
            </span>
            <span class="text-[11px] font-semibold text-slate-400 group-hover:text-emerald-600 transition-colors">View details →</span>
          </div>
        </div>
      </button>
    `;
  }

  // Compact horizontal row card — one full-width row per pick. Heavy
  // info-density: 7-8 picks visible per viewport on a desktop monitor.
  function rowCard(s, i) {
    const co = s.company;
    const name = co.Company || "—";
    const { color, initials } = avatarFor(name);
    const sector = co.Sector || co["Broad Industry"] || "";
    const marketCap = co["Market Cap"] || "";
    return `
      <button data-pick-idx="${i}" class="pick-card group w-full text-left flex items-center gap-3 sm:gap-4 px-4 py-3 rounded-xl bg-white ring-1 ring-slate-200/80 hover:ring-emerald-300 hover:shadow-md hover:-translate-y-px transition-all">
        <div class="w-8 flex-shrink-0 text-center text-xs font-bold text-slate-400 tabular-nums tracking-wider">#${String(i + 1).padStart(2, "0")}</div>
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center text-white font-bold text-xs shadow-sm flex-shrink-0">${initials}</div>
        <div class="min-w-0 flex-1">
          <div class="font-display font-bold text-slate-900 text-sm leading-tight truncate" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
          <div class="text-[11px] text-slate-500 truncate mt-0.5">${escapeHtml(sector)}${marketCap ? ` · ${escapeHtml(marketCap)}` : ""}</div>
        </div>
        <div class="hidden md:block flex-1 max-w-[260px]">${contributionBar(s)}</div>
        <div class="text-right flex-shrink-0 w-16">
          <div class="text-2xl font-extrabold tabular-nums leading-none bg-gradient-to-br from-emerald-600 to-teal-600 bg-clip-text text-transparent">${s.composite.toFixed(1)}</div>
          <div class="text-[9px] uppercase tracking-wider text-slate-400 font-bold mt-0.5">/100</div>
        </div>
        <span class="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200 text-[9px] font-bold uppercase tracking-wider flex-shrink-0">STRONG BUY</span>
        <span class="text-slate-300 group-hover:text-emerald-600 transition-colors flex-shrink-0">→</span>
      </button>
    `;
  }

  const podium = picks.slice(0, 3).map((s, i) => podiumCard(s, i)).join("");
  const rest = picks.slice(3).map((s, i) => rowCard(s, i + 3)).join("");

  // Legend tied to the contribution bar's pillar colors.
  const legend = `
    <div class="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
      <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1">Pillar mix:</span>
      ${PILLAR_KEYS.map((k) => `
        <span class="inline-flex items-center gap-1.5">
          <span class="w-2.5 h-2.5 rounded-full ${PILLAR_BAR[k]}"></span>${PILLAR_NAME[k]}
        </span>
      `).join("")}
    </div>
  `;

  $("#top-picks-content").innerHTML = `
    ${heroHeader}
    ${picks.length > 0 ? `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
        ${podium}
      </div>` : ""}
    ${picks.length > 3 ? `
      <div class="space-y-1.5">
        ${rest}
      </div>` : ""}
    ${legend}
  `;
  $$("#top-picks-content .pick-card").forEach((el) => el.addEventListener("click", () => openDrillDown(picks[Number(el.dataset.pickIdx)])));
}

// ---------------- History (predictions performance) ----------------
// Loads the snapshot manifest from public/data/snapshots/index.json,
// fetches every dated snapshot file, and reconstructs per-ticker
// timelines. For each ticker that was ever rated STRONG BUY, we anchor
// at the FIRST such day and measure return to today's close — that's
// the "we said STRONG BUY at ₹444 → today ₹555" story client wants.
async function renderHistory() {
  const host = $("#history-content");
  if (!host) return;
  host.innerHTML = `<div class="bg-white rounded-2xl ring-1 ring-slate-200 p-10 text-center text-slate-500 text-sm">Loading history…</div>`;

  // Cache the loaded timeline so flipping tabs doesn't re-fetch.
  if (!state.cache.history) {
    try {
      const idx = await fetch("data/snapshots/index.json").then((r) => {
        if (!r.ok) throw new Error("manifest missing");
        return r.json();
      });
      if (!idx.dates?.length) throw new Error("no snapshot dates");
      const snapshots = await Promise.all(idx.dates.map((d) =>
        fetch(`data/snapshots/${d}.json`).then((r) => r.json())
      ));
      // Benchmark history (Nifty 50 / Bank Nifty) is optional — when
      // the daily workflow hasn't yet written benchmark-history.json,
      // alpha columns fall back to "—" instead of breaking the view.
      const benchmark = await fetch("data/benchmark-history.json")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      state.cache.history = { idx, snapshots, benchmark };
    } catch (e) {
      host.innerHTML = renderHistoryEmpty(e.message);
      return;
    }
  }
  const { idx, snapshots, benchmark } = state.cache.history;

  // Per-ticker timeline of points {date, close, composite, rating, pillars}
  // plus identity (name, sector). Pillars are kept for forensics decomp
  // in the drill modal — composite delta = sum of per-pillar weighted deltas.
  const byTicker = new Map();
  for (const snap of snapshots) {
    for (const s of snap.stocks) {
      if (!s.ticker) continue;
      const t = byTicker.get(s.ticker) || { ticker: s.ticker, name: s.name, sector: s.sector, slug: s.slug, points: [] };
      // Always keep the freshest non-null name / sector
      if (s.name) t.name = s.name;
      if (s.sector) t.sector = s.sector;
      if (s.slug) t.slug = s.slug;
      t.points.push({ date: snap.date, close: s.close, composite: s.composite, rating: s.rating, pillars: s.pillars || null });
      byTicker.set(s.ticker, t);
    }
  }

  // Today's close per ticker (from the most recent snapshot, falling
  // back to any earlier non-null close if today is missing).
  const todayDate = idx.dates[idx.dates.length - 1];
  const todayClose = {};
  const todayMap = snapshots[snapshots.length - 1];
  for (const s of todayMap.stocks) if (typeof s.close === "number") todayClose[s.ticker] = s.close;

  // Benchmark series lookup — Nifty close on any date, falling back to
  // the most recent close on or before the requested date.
  const niftyClosesByDate = benchmark?.indices?.["^NSEI"]?.closes || null;
  const niftyDatesSorted = niftyClosesByDate ? Object.keys(niftyClosesByDate).sort() : null;
  function niftyOn(date) {
    if (!niftyClosesByDate) return null;
    if (niftyClosesByDate[date] != null) return niftyClosesByDate[date];
    let last = null;
    for (const d of niftyDatesSorted) { if (d <= date) last = niftyClosesByDate[d]; else break; }
    return last;
  }

  // For each ticker that had at least one STRONG BUY day, pin the FIRST
  // such day as the "we said" anchor and compute realized return + alpha.
  const picks = [];
  for (const t of byTicker.values()) {
    const firstSB = t.points.find((p) => p.rating === "STRONG BUY" && typeof p.close === "number");
    if (!firstSB) continue;
    const now = todayClose[t.ticker];
    if (typeof now !== "number") continue;
    const ret = (now / firstSB.close - 1) * 100;
    const days = daysBetween(firstSB.date, todayDate);
    // Latest snapshot point (for "current rating" + pillars-now forensics)
    let lastPoint = null;
    for (let i = t.points.length - 1; i >= 0; i--) {
      if (t.points[i].rating) { lastPoint = t.points[i]; break; }
    }
    // Alpha vs Nifty over the same window
    const nStart = niftyOn(firstSB.date), nEnd = niftyOn(todayDate);
    const niftyReturn = (nStart && nEnd) ? (nEnd / nStart - 1) * 100 : null;
    const alpha = niftyReturn != null ? ret - niftyReturn : null;
    picks.push({
      ticker: t.ticker, name: t.name, sector: t.sector,
      firstSBDate: firstSB.date,
      firstSBClose: firstSB.close,
      firstSBComposite: firstSB.composite,
      firstSBPillars: firstSB.pillars || null,
      todayClose: now,
      todayPillars: lastPoint?.pillars || null,
      ret, days,
      niftyReturn, alpha,
      currentRating: lastPoint?.rating || null,
      points: t.points,
    });
  }

  picks.sort((a, b) => b.ret - a.ret);

  if (picks.length === 0) {
    host.innerHTML = renderHistoryEmpty(`Snapshots loaded (${idx.dates.length} days) but no STRONG BUY picks have been recorded yet.`);
    return;
  }

  const winners = picks.filter((p) => p.ret > 0);
  const avg = picks.reduce((a, b) => a + b.ret, 0) / picks.length;
  const best = picks[0];
  const dateRange = idx.dates.length > 1 ? `${idx.dates[0]} → ${idx.dates[idx.dates.length - 1]}` : idx.dates[0];

  // --- Portfolio backtest (equal-weight, client-set ₹ per pick at first STRONG BUY) ---
  // Simulate buying every STRONG BUY equally on its first-appearance date and
  // holding through today. Daily portfolio value is summed across whatever
  // picks have entered by that date — the curve shows compounding of the
  // basket as more picks come in. Drawdown is the peak-to-trough %.
  const ALLOC = state.allocPerPick;
  // ticker → Map<date, close> for daily mark-to-market
  const closeByTickerDate = new Map();
  for (const snap of snapshots) {
    for (const s of snap.stocks) {
      if (typeof s.close !== "number") continue;
      let m = closeByTickerDate.get(s.ticker);
      if (!m) { m = new Map(); closeByTickerDate.set(s.ticker, m); }
      m.set(snap.date, s.close);
    }
  }
  function closeAt(ticker, date) {
    const m = closeByTickerDate.get(ticker);
    if (!m) return null;
    if (m.has(date)) return m.get(date);
    // most recent date ≤ requested
    let last = null;
    for (const d of [...m.keys()].sort()) { if (d <= date) last = m.get(d); else break; }
    return last;
  }
  const portfolioSeries = idx.dates.map((d) => {
    let value = 0, invested = 0;
    for (const p of picks) {
      if (d < p.firstSBDate) continue;
      const shares = ALLOC / p.firstSBClose;
      const c = closeAt(p.ticker, d);
      if (c == null) continue;
      value += shares * c;
      invested += ALLOC;
    }
    return { date: d, value, invested, ret: invested > 0 ? (value / invested - 1) * 100 : 0 };
  });
  // Max drawdown over the series
  let peak = 0, maxDD = 0, maxDDdate = null;
  for (const pt of portfolioSeries) {
    if (pt.value > peak) peak = pt.value;
    if (peak > 0) {
      const dd = (peak - pt.value) / peak * 100;
      if (dd > maxDD) { maxDD = dd; maxDDdate = pt.date; }
    }
  }
  const lastPt = portfolioSeries[portfolioSeries.length - 1] || { value: 0, invested: 0, ret: 0 };
  const portInvested = lastPt.invested;
  const portValue = lastPt.value;
  const portRet = lastPt.ret;
  // Same money in Nifty equivalent (only when benchmark data is loaded)
  let niftyMatchedRet = null;
  if (niftyClosesByDate) {
    let niftyValue = 0, niftyInvested = 0;
    for (const p of picks) {
      const nStart = niftyOn(p.firstSBDate);
      const nEnd = niftyOn(todayDate);
      if (nStart == null || nEnd == null) continue;
      const units = ALLOC / nStart;
      niftyValue += units * nEnd;
      niftyInvested += ALLOC;
    }
    if (niftyInvested > 0) niftyMatchedRet = (niftyValue / niftyInvested - 1) * 100;
  }

  // --- Hero strip ---
  const heroHeader = `
    <div class="relative overflow-hidden rounded-2xl mb-4 print-hide">
      <div class="absolute inset-0 bg-gradient-to-r from-slate-900 via-indigo-900 to-purple-900"></div>
      <div class="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_15%_50%,rgba(34,211,238,0.35),transparent_45%)]"></div>
      <div class="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_85%_30%,rgba(16,185,129,0.4),transparent_50%)]"></div>
      <div class="relative px-6 py-5 text-white">
        <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div class="text-[10px] font-bold uppercase tracking-[0.25em] text-cyan-200/80">Predictions · Performance</div>
            <h1 class="font-display text-2xl sm:text-3xl font-extrabold leading-tight mt-1">${picks.length} past STRONG BUY picks ${avg >= 0 ? "earning" : "down"} <span class="${avg >= 0 ? "text-emerald-300" : "text-rose-300"}">${avg >= 0 ? "+" : ""}${avg.toFixed(1)}%</span> on average</h1>
            <p class="text-white/70 text-xs mt-1">From ${dateRange} · realized return from first STRONG BUY date → today's close</p>
          </div>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          ${heroStat("Picks", picks.length, `${idx.dates.length} day window`)}
          ${heroStat("Avg return", `${avg >= 0 ? "+" : ""}${avg.toFixed(1)}%`, "since first STRONG BUY")}
          ${heroStat("Win rate", `${Math.round(winners.length / picks.length * 100)}%`, `${winners.length} of ${picks.length} up`)}
          ${heroStat("Best pick", `${best.ret >= 0 ? "+" : ""}${best.ret.toFixed(1)}%`, best.name)}
        </div>
      </div>
    </div>
  `;

  // --- Portfolio backtest card ---
  // "If you'd bought every STRONG BUY equal-weight" — concrete ₹ numbers
  // a fund manager can show LPs, plus max drawdown and (when benchmark
  // data is loaded) the same money invested in Nifty for comparison.
  const portRetCls = portRet >= 0 ? "text-emerald-700" : "text-rose-700";
  const portChartH = 80;
  const portChart = renderPortfolioSparkline(portfolioSeries, portChartH);
  const presets = [
    { v: 50000,   label: "₹50K"  },
    { v: 100000,  label: "₹1L"   },
    { v: 500000,  label: "₹5L"   },
    { v: 1000000, label: "₹10L"  },
  ];
  const presetChips = presets.map((p) => {
    const active = p.v === ALLOC;
    return `<button type="button" data-alloc-preset="${p.v}" class="px-2 py-1 text-[11px] font-semibold rounded-lg ring-1 transition ${active ? "bg-indigo-600 text-white ring-indigo-600 shadow-sm" : "bg-white text-slate-600 ring-slate-200 hover:ring-indigo-300 hover:text-indigo-700"}">${p.label}</button>`;
  }).join("");
  const portfolioCard = `
    <div class="bg-white rounded-2xl ring-1 ring-slate-100 p-4 sm:p-5 mb-4">
      <div class="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 class="font-display font-bold text-slate-900 text-base">What if you'd bought every STRONG BUY equal-weight?</h2>
          <p class="text-[11px] text-slate-500 mt-0.5">Mark-to-market each day · held through today</p>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <label class="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
              <span>₹</span>
              <input id="alloc-input" type="number" inputmode="numeric" min="1000" step="1000" value="${ALLOC}"
                class="w-24 px-2 py-1 text-xs font-bold tabular-nums bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
              <span class="text-slate-400 font-normal">per pick</span>
            </label>
            <div class="flex items-center gap-1">${presetChips}</div>
          </div>
        </div>
        <div class="text-right">
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total return</div>
          <div class="text-3xl font-display font-extrabold tabular-nums leading-none ${portRetCls}">${portRet >= 0 ? "+" : ""}${portRet.toFixed(2)}%</div>
        </div>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        ${portfolioStat("Invested", `₹${formatINR(portInvested)}`, `${picks.length} pick${picks.length === 1 ? "" : "s"}`)}
        ${portfolioStat("Today's value", `₹${formatINR(portValue)}`, `${portValue >= portInvested ? "+" : ""}₹${formatINR(portValue - portInvested)} net`)}
        ${portfolioStat("Max drawdown", `−${maxDD.toFixed(2)}%`, maxDDdate ? `bottomed ${maxDDdate}` : "—", maxDD > 0 ? "text-rose-700" : "text-slate-500")}
        ${niftyMatchedRet != null
          ? portfolioStat("vs Nifty 50", `${niftyMatchedRet >= 0 ? "+" : ""}${niftyMatchedRet.toFixed(2)}%`, `α ${portRet - niftyMatchedRet >= 0 ? "+" : ""}${(portRet - niftyMatchedRet).toFixed(2)}%`, portRet - niftyMatchedRet >= 0 ? "text-emerald-700" : "text-rose-700")
          : portfolioStat("vs Nifty 50", "—", "loading daily", "text-slate-400")}
      </div>
      <div class="rounded-xl bg-slate-50 ring-1 ring-slate-100 p-3">
        ${portChart}
      </div>
    </div>
  `;

  // --- Table of past picks (one row per ticker, sortable visually) ---
  const rows = picks.map((p, i) => {
    const { color, initials } = avatarFor(p.name || "—");
    const ratingChipCls = composite.ratingClass(p.currentRating || "—");
    const retCls = p.ret >= 0 ? "text-emerald-700" : "text-rose-700";
    const retBg = p.ret >= 0 ? "bg-emerald-50 ring-emerald-100" : "bg-rose-50 ring-rose-100";
    const alphaCls = p.alpha == null ? "" : p.alpha >= 0 ? "text-emerald-700" : "text-rose-700";
    return `
      <button data-pick="${i}" class="hist-row w-full text-left grid grid-cols-12 items-center gap-3 px-4 py-3 rounded-xl bg-white ring-1 ring-slate-200/80 hover:ring-indigo-300 hover:shadow-md hover:-translate-y-px transition-all">
        <div class="col-span-1 sm:col-span-1 flex items-center gap-2">
          <span class="text-xs font-bold text-slate-400 tabular-nums">#${String(i + 1).padStart(2, "0")}</span>
        </div>
        <div class="col-span-5 sm:col-span-4 flex items-center gap-3 min-w-0">
          <div class="w-9 h-9 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center text-white font-bold text-xs shadow-sm flex-shrink-0">${initials}</div>
          <div class="min-w-0">
            <div class="font-display font-bold text-slate-900 text-sm leading-tight truncate" title="${escapeHtml(p.name || "")}">${escapeHtml(p.name || "—")}</div>
            <div class="text-[11px] text-slate-500 truncate">${escapeHtml(p.sector || "")}</div>
          </div>
        </div>
        <div class="hidden sm:block col-span-3">
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">We said STRONG BUY</div>
          <div class="text-xs text-slate-700 mt-0.5">
            <span class="font-semibold">${p.firstSBDate}</span>
            <span class="text-slate-400">·</span>
            <span>₹${formatPrice(p.firstSBClose)}</span>
            ${p.firstSBComposite != null ? `<span class="text-slate-400">·</span><span class="font-bold tabular-nums">${p.firstSBComposite.toFixed(1)}</span>` : ""}
          </div>
        </div>
        <div class="hidden sm:block col-span-2">
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">Today</div>
          <div class="text-xs text-slate-700 mt-0.5">
            <span>₹${formatPrice(p.todayClose)}</span>
            <span class="text-slate-400">·</span>
            <span class="inline-flex items-center px-1.5 py-0 rounded text-[9px] font-bold uppercase tracking-wider ring-1 whitespace-nowrap ${ratingChipCls}">${escapeHtml(p.currentRating || "—")}</span>
          </div>
        </div>
        <div class="col-span-6 sm:col-span-2 flex flex-col items-end gap-0.5">
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center px-2.5 py-1 rounded-lg ring-1 text-sm font-extrabold tabular-nums ${retCls} ${retBg}">${p.ret >= 0 ? "+" : ""}${p.ret.toFixed(1)}%</span>
            <span class="text-[10px] text-slate-400 tabular-nums whitespace-nowrap">${p.days}d</span>
          </div>
          ${p.alpha != null
            ? `<span class="text-[10px] font-semibold tabular-nums ${alphaCls}">α ${p.alpha >= 0 ? "+" : ""}${p.alpha.toFixed(2)}% vs Nifty</span>`
            : ""}
        </div>
      </button>
    `;
  }).join("");

  host.innerHTML = `
    ${heroHeader}
    ${portfolioCard}
    <div class="bg-white rounded-2xl ring-1 ring-slate-100 p-4 sm:p-5">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-display font-bold text-slate-900 text-base">Past STRONG BUYs · realized return</h2>
        <span class="text-[11px] text-slate-500 tabular-nums">Sorted by return · click any row to see the chart</span>
      </div>
      <div class="space-y-1.5">${rows}</div>
    </div>
  `;
  $$("#history-content .hist-row").forEach((el) => el.addEventListener("click", () => openHistoryDrill(picks[Number(el.dataset.pick)])));

  // Allocation editor — preset chips snap to common ₹ amounts, the
  // number input takes any custom value. % return, drawdown, alpha are
  // all unchanged by ALLOC (they're proportional), but the absolute
  // ₹ figures rescale, so we re-render the History tab on commit.
  function applyAlloc(v) {
    const n = Math.max(1000, Math.round(Number(v) || 0));
    if (n === state.allocPerPick) return;
    state.allocPerPick = n;
    saveAllocPerPick(n);
    renderHistory();
  }
  $$("#history-content [data-alloc-preset]").forEach((btn) => btn.addEventListener("click", () => applyAlloc(btn.dataset.allocPreset)));
  const allocInput = $("#alloc-input");
  if (allocInput) {
    allocInput.addEventListener("change", (e) => applyAlloc(e.target.value));
    allocInput.addEventListener("keydown", (e) => { if (e.key === "Enter") applyAlloc(e.target.value); });
  }
}

// Tiny portfolio-value sparkline drawn inside the backtest card. Shows
// the running portfolio return (%) day-over-day, with each pick-entry
// date marked as a small green dot on the line.
function renderPortfolioSparkline(series, H) {
  if (!series || series.length < 2) return `<div class="text-[11px] text-slate-400 text-center py-4">Not enough days to draw a curve yet.</div>`;
  const W = 800;
  const M = { top: 8, right: 8, bottom: 22, left: 36 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const rets = series.map((p) => p.ret);
  const yMin = Math.min(0, ...rets);
  const yMax = Math.max(0, ...rets);
  const ySpan = Math.max(yMax - yMin, 0.5);
  const yLo = yMin - ySpan * 0.1, yHi = yMax + ySpan * 0.1;
  const xAt = (i) => M.left + (i / (series.length - 1)) * innerW;
  const yAt = (v) => M.top + innerH - ((v - yLo) / (yHi - yLo)) * innerH;
  const path = series.map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(p.ret).toFixed(1)}`).join(" ");
  const lastRet = series[series.length - 1].ret;
  const lineColor = lastRet >= 0 ? "#10b981" : "#f43f5e";
  const areaPath = `${path} L ${xAt(series.length - 1).toFixed(1)} ${yAt(yLo).toFixed(1)} L ${M.left.toFixed(1)} ${yAt(yLo).toFixed(1)} Z`;
  const zeroLineY = yAt(0).toFixed(1);
  const dateTickEvery = Math.max(1, Math.ceil(series.length / 6));
  const xLabels = series.map((p, i) => {
    if (i % dateTickEvery !== 0 && i !== series.length - 1) return "";
    return `<text x="${xAt(i).toFixed(1)}" y="${(M.top + innerH + 14).toFixed(1)}" text-anchor="middle" font-size="9" fill="#94a3b8">${p.date.slice(5)}</text>`;
  }).join("");
  return `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" class="w-full" style="max-height:${H + 20}px">
      <defs>
        <linearGradient id="portArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="${lineColor}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <line x1="${M.left}" x2="${(M.left + innerW).toFixed(1)}" y1="${zeroLineY}" y2="${zeroLineY}" stroke="#cbd5e1" stroke-width="0.6" stroke-dasharray="3 4" />
      <text x="${(M.left - 6).toFixed(1)}" y="${zeroLineY}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="#94a3b8">0%</text>
      <text x="${(M.left - 6).toFixed(1)}" y="${(M.top + 6).toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="#94a3b8">${yHi >= 0 ? "+" : ""}${yHi.toFixed(1)}%</text>
      <text x="${(M.left - 6).toFixed(1)}" y="${(M.top + innerH - 2).toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="#94a3b8">${yLo >= 0 ? "+" : ""}${yLo.toFixed(1)}%</text>
      <path d="${areaPath}" fill="url(#portArea)" />
      <path d="${path}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="${xAt(series.length - 1).toFixed(1)}" cy="${yAt(lastRet).toFixed(1)}" r="3.5" fill="${lineColor}" stroke="#fff" stroke-width="1.5" />
      ${xLabels}
    </svg>
  `;
}

function portfolioStat(label, value, sub, valueCls = "text-slate-900") {
  return `
    <div class="rounded-xl bg-slate-50 ring-1 ring-slate-100 px-3 py-2">
      <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">${escapeHtml(label)}</div>
      <div class="text-base font-display font-extrabold tabular-nums mt-0.5 leading-tight ${valueCls}">${value}</div>
      <div class="text-[10px] text-slate-500 mt-0.5 truncate" title="${escapeHtml(sub)}">${escapeHtml(sub)}</div>
    </div>
  `;
}

// Indian-rupee compact formatter — ₹X,XX,XXX up to a lakh, then
// ₹X.XL / ₹X.XCr for bigger numbers (matches Indian convention).
function formatINR(n) {
  if (n == null || !isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 10000000) return `${sign}${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000)   return `${sign}${(abs / 100000).toFixed(2)}L`;
  return `${sign}${Math.round(abs).toLocaleString("en-IN")}`;
}

// Score forensics — decompose the composite change between the
// STRONG BUY anchor day and today into per-pillar weighted-delta
// contributions. The sum of all five deltas equals the composite
// delta, so a fund manager can see *why* the model changed its mind
// (or didn't). Quiet if either endpoint lacks pillar data.
function renderScoreForensics(pick) {
  const a = pick.firstSBPillars;
  const b = pick.todayPillars;
  if (!a || !b) return "";
  const PILLAR_KEYS = ["fundamentals", "technicals", "macro", "sentiment", "liquidity"];
  const LABEL = { fundamentals: "Fundamentals", technicals: "Technicals", macro: "Macro", sentiment: "Sentiment", liquidity: "Liquidity" };
  const COLOR = { fundamentals: "bg-emerald-500", technicals: "bg-indigo-500", macro: "bg-violet-500", sentiment: "bg-amber-500", liquidity: "bg-sky-500" };
  const deltas = PILLAR_KEYS.map((k) => {
    const aw = a[k]?.weighted, bw = b[k]?.weighted;
    const ap = a[k]?.pct,      bp = b[k]?.pct;
    if (aw == null || bw == null) return { key: k, missing: true };
    return { key: k, missing: false, aw, bw, ap, bp, delta: bw - aw };
  });
  const compDelta = deltas.reduce((s, d) => s + (d.missing ? 0 : d.delta), 0);
  const compTotalA = pick.firstSBComposite;
  const compTotalB = (a && b && pick.todayPillars)
    ? deltas.reduce((s, d) => s + (d.missing ? 0 : d.bw), 0)
    : null;
  const maxAbs = Math.max(0.5, ...deltas.map((d) => d.missing ? 0 : Math.abs(d.delta)));
  const deltaSign = compDelta >= 0 ? "+" : "−";
  const deltaCls = compDelta >= 0 ? "text-emerald-700" : "text-rose-700";
  const rowsHtml = deltas.map((d) => {
    if (d.missing) {
      return `
        <div class="grid grid-cols-12 items-center gap-2 py-0.5">
          <div class="col-span-3 text-[11px] font-semibold text-slate-400">${LABEL[d.key]}</div>
          <div class="col-span-9 text-[10px] text-slate-400">no data</div>
        </div>
      `;
    }
    const pos = d.delta >= 0;
    const widthPct = (Math.abs(d.delta) / maxAbs) * 50;          // 0..50% of the bar (centered)
    const valCls = pos ? "text-emerald-700" : "text-rose-700";
    const barCls = pos ? "bg-emerald-500" : "bg-rose-500";
    const dot = COLOR[d.key];
    return `
      <div class="grid grid-cols-12 items-center gap-2 py-0.5">
        <div class="col-span-3 flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 rounded-full ${dot} flex-shrink-0"></span>
          <span class="text-[11px] font-semibold text-slate-800">${LABEL[d.key]}</span>
        </div>
        <div class="col-span-5 relative h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div class="absolute top-0 bottom-0 left-1/2 w-px bg-slate-300"></div>
          <div class="absolute top-0 bottom-0 ${barCls}" style="${pos ? `left:50%;width:${widthPct.toFixed(2)}%` : `right:50%;width:${widthPct.toFixed(2)}%`}"></div>
        </div>
        <div class="col-span-2 text-[11px] font-bold tabular-nums text-right ${valCls}">${pos ? "+" : "−"}${Math.abs(d.delta).toFixed(2)}</div>
        <div class="col-span-2 text-[10px] tabular-nums text-slate-400 text-right whitespace-nowrap">${d.ap}→${d.bp}%</div>
      </div>
    `;
  }).join("");
  return `
    <div class="rounded-2xl ring-1 ring-slate-200 bg-white px-3 py-2 sm:px-4 sm:py-2.5 mb-3">
      <div class="flex flex-wrap items-baseline justify-between gap-2 mb-1.5">
        <div class="flex items-baseline gap-2">
          <div class="font-display font-bold text-slate-900 text-sm">Score forensics</div>
          <div class="text-[11px] text-slate-500">why composite ${compDelta >= 0 ? "rose" : "dropped"} since ${pick.firstSBDate}</div>
        </div>
        <div class="flex items-baseline gap-2 text-xs tabular-nums">
          <span class="text-slate-500">${compTotalA != null ? compTotalA.toFixed(1) : "—"}</span>
          <span class="text-slate-400">→</span>
          <span class="font-bold text-slate-900">${compTotalB != null ? compTotalB.toFixed(1) : "—"}</span>
          <span class="font-bold ${deltaCls}">${deltaSign}${Math.abs(compDelta).toFixed(2)}</span>
        </div>
      </div>
      <div class="rounded-lg bg-slate-50 ring-1 ring-slate-100 px-3 py-1.5">
        ${rowsHtml}
      </div>
    </div>
  `;
}

function heroStat(label, value, sub) {
  return `
    <div class="bg-white/10 backdrop-blur rounded-xl p-3 ring-1 ring-white/15">
      <div class="text-[10px] uppercase tracking-wider text-white/60 font-semibold">${escapeHtml(label)}</div>
      <div class="text-xl font-bold mt-1 tabular-nums">${escapeHtml(String(value))}</div>
      <div class="text-[10px] text-white/60 mt-0.5 truncate" title="${escapeHtml(sub)}">${escapeHtml(sub)}</div>
    </div>
  `;
}

function renderHistoryEmpty(reason) {
  return `
    <div class="bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-10 sm:p-12 text-center">
      <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-400 to-purple-500 text-white text-2xl mb-4 shadow-lg">📈</div>
      <h2 class="text-xl font-bold font-display text-slate-900 mb-2">History is building up</h2>
      <p class="text-sm text-slate-600 max-w-lg mx-auto leading-relaxed">${escapeHtml(reason || "We need a few daily snapshots before this view becomes useful.")}<br><br>Each daily refresh appends a snapshot to <code class="text-[11px] bg-slate-100 px-1.5 py-0.5 rounded">public/data/snapshots/</code>. As STRONG BUY picks accumulate, this tab will show realized return per pick + a chart with rating markers overlaid on the price line.</p>
    </div>
  `;
}

function daysBetween(a, b) {
  const ma = new Date(a + "T00:00:00Z").getTime();
  const mb = new Date(b + "T00:00:00Z").getTime();
  return Math.max(0, Math.round((mb - ma) / 86400000));
}

function formatPrice(n) {
  if (n == null || !isFinite(n)) return "—";
  if (n >= 1000) return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return n.toFixed(2);
}

// History drill — premium per-company chart modal.
// Layout (top to bottom):
//   - Company header (avatar / name / sector / ticker)
//   - "We said vs Now" 3-card hero strip
//   - Chart card:
//       Title row     · "Price · last N days"  | inline rating legend
//       Price line    · with rating-colored markers (halo on rating change)
//       Rating tape   · one colored cell per snapshot day (clearer than
//                       the old floating sparkbars)
//       Date labels
//   - Hover crosshair + floating tooltip card that follows the cursor
//     and snaps to the nearest data point
const RATING_FILL = {
  "STRONG BUY": "#10b981", "BUY": "#3b82f6", "WATCH": "#f59e0b", "AVOID": "#f43f5e",
  "FILTERED":   "#64748b", "UNRATED": "#cbd5e1",
};

function openHistoryDrill(pick) {
  if (!pick) return;
  const { color, initials } = avatarFor(pick.name || "—");
  const todayDate = state.cache.history.idx.dates[state.cache.history.idx.dates.length - 1];

  const points = pick.points.filter((p) => typeof p.close === "number");
  if (points.length < 2) return;

  // --- SVG geometry ---
  // Single viewBox; everything inside is sized in viewBox units, the
  // <svg> itself scales responsively via w-full.
  const W = 820, H = 260;
  const M = { top: 14, right: 24, bottom: 56, left: 64 };     // outer margins
  const TAPE_H = 9;                                           // rating-tape strip height
  const TAPE_GAP = 8;                                         // gap between line chart and tape
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom - TAPE_H - TAPE_GAP;
  const TAPE_Y = M.top + innerH + TAPE_GAP;
  const X_LABEL_Y = TAPE_Y + TAPE_H + 18;

  const closes = points.map((p) => p.close);
  const yMin = Math.min(...closes), yMax = Math.max(...closes);
  const ySpan = Math.max(yMax - yMin, 1);
  const yPad = ySpan * 0.1;
  const yLo = yMin - yPad, yHi = yMax + yPad;

  const xAt = (i) => M.left + (i / (points.length - 1)) * innerW;
  const yAt = (c) => M.top + innerH - ((c - yLo) / (yHi - yLo)) * innerH;

  // Path through closes
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(2)} ${yAt(p.close).toFixed(2)}`).join(" ");
  const areaD = `${pathD} L ${xAt(points.length - 1).toFixed(2)} ${(M.top + innerH).toFixed(2)} L ${M.left.toFixed(2)} ${(M.top + innerH).toFixed(2)} Z`;

  // Y-axis price gridlines + labels (4 steps)
  const yTicks = [0, 1, 2, 3, 4].map((step) => {
    const price = yLo + (yHi - yLo) * (step / 4);
    const yy = (M.top + innerH - (step / 4) * innerH).toFixed(2);
    return `
      <line x1="${M.left}" x2="${(W - M.right).toFixed(2)}" y1="${yy}" y2="${yy}" stroke="#e2e8f0" stroke-width="0.7" stroke-dasharray="3 4" />
      <text x="${(M.left - 10).toFixed(2)}" y="${yy}" text-anchor="end" dominant-baseline="middle" font-size="10.5" font-weight="500" fill="#94a3b8">₹${formatPrice(price)}</text>
    `;
  }).join("");

  // Markers — rating-change points get a halo + ring, same-rating days
  // get a tiny dot. Visual hierarchy makes the explainer footer redundant.
  let prevRating = null;
  const markers = points.map((p, i) => {
    const fill = RATING_FILL[p.rating] || "#cbd5e1";
    const changed = p.rating && p.rating !== prevRating;
    prevRating = p.rating;
    if (changed) {
      return `
        <circle cx="${xAt(i).toFixed(2)}" cy="${yAt(p.close).toFixed(2)}" r="10" fill="${fill}" fill-opacity="0.18" />
        <circle cx="${xAt(i).toFixed(2)}" cy="${yAt(p.close).toFixed(2)}" r="5.5" fill="${fill}" stroke="#fff" stroke-width="2" />
      `;
    }
    return `<circle cx="${xAt(i).toFixed(2)}" cy="${yAt(p.close).toFixed(2)}" r="2.6" fill="#fff" stroke="${fill}" stroke-width="1.5" />`;
  }).join("");

  // Rating tape — one colored cell per snapshot day. Shows rating
  // evolution at a glance under the chart, where the floating sparkbars
  // used to be.
  const cellW = innerW / points.length;
  const tapeCells = points.map((p, i) => {
    const fill = RATING_FILL[p.rating] || "#cbd5e1";
    const x = M.left + i * cellW;
    return `<rect x="${x.toFixed(2)}" y="${TAPE_Y}" width="${Math.max(cellW - 1, 1).toFixed(2)}" height="${TAPE_H}" fill="${fill}" fill-opacity="0.92" rx="1.5" />`;
  }).join("");

  // X-axis date labels — at most 7 to keep the row clean
  const tickEvery = Math.max(1, Math.ceil(points.length / 7));
  const xTicks = points.map((p, i) => {
    if (i % tickEvery !== 0 && i !== points.length - 1) return "";
    return `<text x="${xAt(i).toFixed(2)}" y="${X_LABEL_Y}" text-anchor="middle" font-size="10.5" font-weight="500" fill="#64748b">${p.date.slice(5)}</text>`;
  }).join("");

  // Hover guides — initially invisible, JS toggles opacity on mousemove
  const hoverLayer = `
    <line id="hist-guide" x1="0" y1="${M.top}" x2="0" y2="${(TAPE_Y + TAPE_H).toFixed(2)}" stroke="#94a3b8" stroke-width="0.8" stroke-dasharray="2 3" opacity="0" />
    <circle id="hist-hover-halo" cx="0" cy="0" r="14" fill="#6366f1" fill-opacity="0.16" opacity="0" />
    <circle id="hist-hover-point" cx="0" cy="0" r="6" fill="#fff" stroke="#6366f1" stroke-width="2.5" opacity="0" />
    <rect id="hist-hover-capture" x="${M.left}" y="${M.top}" width="${innerW}" height="${(innerH + TAPE_GAP + TAPE_H).toFixed(2)}" fill="transparent" />
  `;

  // Rating legend (replaces "big rings = ..." footer)
  const legendRatings = ["STRONG BUY", "BUY", "WATCH", "AVOID", "FILTERED"];
  const legend = legendRatings.map((r) => `
    <span class="inline-flex items-center gap-1.5 text-[11px] text-slate-600">
      <span class="w-2.5 h-2.5 rounded-full" style="background:${RATING_FILL[r]}"></span>${r}
    </span>
  `).join("");

  // Hero strip values
  const ret = pick.ret;
  const retCls = ret >= 0 ? "text-emerald-700" : "text-rose-700";
  const retBg = ret >= 0 ? "from-emerald-50 to-teal-50 ring-emerald-200" : "from-rose-50 to-pink-50 ring-rose-200";

  openModal(`
    <div class="px-6 py-4">
      <div class="flex items-start justify-between gap-4 mb-3">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-11 h-11 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white font-bold text-sm shadow-md flex-shrink-0">${initials}</div>
          <div class="min-w-0">
            <div class="font-display font-bold text-slate-900 text-lg leading-tight truncate">${escapeHtml(pick.name || "—")}</div>
            <div class="text-xs text-slate-500 mt-0.5 truncate">${escapeHtml(pick.sector || "")} · ${escapeHtml(pick.ticker)}</div>
          </div>
        </div>
        <button id="modal-close-btn" class="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-3">
        <div class="rounded-xl ring-1 ring-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 px-3 py-2">
          <div class="text-[9px] font-bold uppercase tracking-wider text-emerald-700">We said STRONG BUY</div>
          <div class="text-sm font-display font-bold text-slate-900 mt-0.5">${pick.firstSBDate} · <span class="tabular-nums">₹${formatPrice(pick.firstSBClose)}</span></div>
          ${pick.firstSBComposite != null ? `<div class="text-[11px] text-slate-600 mt-0.5">composite <span class="font-bold tabular-nums">${pick.firstSBComposite.toFixed(1)}</span></div>` : ""}
        </div>
        <div class="rounded-xl ring-1 ring-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2">
          <div class="text-[9px] font-bold uppercase tracking-wider text-slate-500">Today</div>
          <div class="text-sm font-display font-bold text-slate-900 mt-0.5">${todayDate} · <span class="tabular-nums">₹${formatPrice(pick.todayClose)}</span></div>
          ${pick.currentRating ? `<div class="text-[11px] text-slate-600 mt-0.5"><span class="inline-flex items-center px-1.5 py-0 rounded text-[9px] font-bold uppercase tracking-wider ring-1 ${composite.ratingClass(pick.currentRating)}">${escapeHtml(pick.currentRating)}</span></div>` : ""}
        </div>
        <div class="rounded-xl ring-1 bg-gradient-to-br ${retBg} px-3 py-2 flex items-center justify-between gap-3">
          <div>
            <div class="text-[9px] font-bold uppercase tracking-wider ${retCls}">Realized return</div>
            <div class="text-[11px] text-slate-600 mt-0.5">over ${pick.days} day${pick.days === 1 ? "" : "s"}</div>
          </div>
          <div class="text-2xl font-display font-extrabold tabular-nums ${retCls} leading-none">${ret >= 0 ? "+" : ""}${ret.toFixed(2)}%</div>
        </div>
      </div>

      ${renderScoreForensics(pick)}

      <div class="rounded-2xl ring-1 ring-slate-200 bg-white px-3 py-2.5 sm:px-4 sm:py-3">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
          <div class="flex items-baseline gap-2">
            <div class="font-display font-bold text-slate-900 text-sm">Price &amp; rating timeline</div>
            <div class="text-[11px] text-slate-500">${points.length} days · ${points[0].date.slice(5)} → ${points[points.length - 1].date.slice(5)}</div>
          </div>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">${legend}</div>
        </div>

        <div id="hist-chart-container" class="relative">
          <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" class="w-full select-none" style="max-height:280px">
            <defs>
              <linearGradient id="histArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#6366f1" stop-opacity="0.22"/>
                <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
              </linearGradient>
            </defs>
            ${yTicks}
            <path d="${areaD}" fill="url(#histArea)"/>
            <path d="${pathD}" fill="none" stroke="#6366f1" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
            ${markers}
            ${tapeCells}
            ${xTicks}
            <text x="${(M.left - 10).toFixed(2)}" y="${(TAPE_Y + TAPE_H / 2).toFixed(2)}" text-anchor="end" dominant-baseline="middle" font-size="9" font-weight="700" fill="#94a3b8" letter-spacing="0.5">RATING</text>
            ${hoverLayer}
          </svg>
          <div id="hist-tooltip" class="hidden absolute z-10 pointer-events-none -translate-x-1/2 -translate-y-[calc(100%+14px)] bg-slate-900/95 backdrop-blur text-white text-xs rounded-xl shadow-2xl ring-1 ring-slate-700/60 px-3 py-2 whitespace-nowrap"></div>
        </div>
      </div>
    </div>
  `, { size: "magazine" });

  $("#modal-close-btn")?.addEventListener("click", closeModal);
  $("#modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  }, { once: true });

  // Wire hover crosshair + tooltip. The capture <rect> spans the chart
  // + rating-tape band so hovering anywhere reads the same nearest day.
  const container = $("#hist-chart-container");
  const svg = container?.querySelector("svg");
  const capture = $("#hist-hover-capture");
  const guide = $("#hist-guide");
  const hoverPt = $("#hist-hover-point");
  const halo = $("#hist-hover-halo");
  const tip = $("#hist-tooltip");
  if (!container || !svg || !capture || !tip) return;

  function show(idx) {
    const p = points[idx];
    const px = xAt(idx);
    const py = yAt(p.close);
    guide.setAttribute("x1", px); guide.setAttribute("x2", px); guide.setAttribute("opacity", "1");
    hoverPt.setAttribute("cx", px); hoverPt.setAttribute("cy", py); hoverPt.setAttribute("opacity", "1");
    halo.setAttribute("cx", px); halo.setAttribute("cy", py); halo.setAttribute("opacity", "1");

    const rect = svg.getBoundingClientRect();
    // viewBox → pixel mapping (preserveAspectRatio = xMidYMid meet, which
    // for our box scales by the smaller of width/height ratios — but here
    // we control the modal width and the chart is the limiting axis, so
    // x scale equals rect.width / W).
    const sx = rect.width / W;
    const sy = rect.height / H;
    const tipX = px * sx;
    const tipY = py * sy;

    const ratingColor = RATING_FILL[p.rating] || "#cbd5e1";
    const compTxt = p.composite != null ? p.composite.toFixed(1) : "—";
    const first = points[0];
    const chg = ((p.close - first.close) / first.close) * 100;
    const chgCls = chg >= 0 ? "text-emerald-300" : "text-rose-300";
    tip.innerHTML = `
      <div class="font-bold text-sm leading-tight">${p.date}</div>
      <div class="mt-1 flex items-center gap-2">
        <span class="text-base font-extrabold tabular-nums">₹${formatPrice(p.close)}</span>
        <span class="text-[10px] tabular-nums ${chgCls}">${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%</span>
      </div>
      <div class="mt-1.5 flex items-center gap-2 text-[11px]">
        <span class="inline-flex items-center gap-1">
          <span class="w-2 h-2 rounded-full" style="background:${ratingColor}"></span>
          <span class="font-semibold">${p.rating || "—"}</span>
        </span>
        <span class="text-slate-300">·</span>
        <span>composite <span class="font-bold tabular-nums">${compTxt}</span></span>
      </div>
    `;
    tip.classList.remove("hidden");
    // Position then flip horizontally if too close to container edges.
    const cw = container.clientWidth;
    tip.style.left = `${tipX}px`;
    tip.style.top = `${tipY}px`;
    tip.style.transform = "translate(-50%, calc(-100% - 14px))";
    requestAnimationFrame(() => {
      const tr = tip.getBoundingClientRect();
      const cr = container.getBoundingClientRect();
      let dx = 0;
      if (tr.left < cr.left + 6) dx = (cr.left + 6) - tr.left;
      else if (tr.right > cr.right - 6) dx = (cr.right - 6) - tr.right;
      if (dx !== 0) tip.style.transform = `translate(calc(-50% + ${dx}px), calc(-100% - 14px))`;
    });
  }
  function hide() {
    guide.setAttribute("opacity", "0");
    hoverPt.setAttribute("opacity", "0");
    halo.setAttribute("opacity", "0");
    tip.classList.add("hidden");
  }

  function eventToIdx(e) {
    const rect = svg.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    const xPx = t.clientX - rect.left;
    const xView = (xPx / rect.width) * W;
    let bestI = 0, bestD = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(xAt(i) - xView);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    return bestI;
  }

  capture.addEventListener("mousemove", (e) => show(eventToIdx(e)));
  capture.addEventListener("mouseleave", hide);
  capture.addEventListener("touchstart", (e) => { show(eventToIdx(e)); e.preventDefault(); }, { passive: false });
  capture.addEventListener("touchmove",  (e) => { show(eventToIdx(e)); e.preventDefault(); }, { passive: false });
  capture.addEventListener("touchend", hide);

  // Surface today (last point) on open so the panel isn't empty.
  show(points.length - 1);
}

// ---------------- filtering / sorting ----------------
function applyFilters() {
  const c = cfg(); const st = tabState();
  const q = state.search.trim().toLowerCase();
  let rows = st.scored.filter((s) => {
    if (state.watchOnly && !state.watchlist.has(companyKey(s.company))) return false;
    if (q && !c.name(s.company).toLowerCase().includes(q)) return false;
    if (state.scoreFilter === "hardfail") return s.hardFails.length > 0;
    if (state.scoreFilter !== "all") {
      const tier = s.hardFails.length ? "hardfail" : scoreTier(s.scorePct);
      if (tier !== state.scoreFilter) return false;
    }
    return true;
  });
  rows.sort((a, b) => {
    const dir = state.sortDir === "asc" ? 1 : -1;
    let av, bv;
    if (state.sortBy === "score") { av = a.totalPoints; bv = b.totalPoints; }
    else if (state.sortBy === "name") { av = c.name(a.company).toLowerCase(); bv = c.name(b.company).toLowerCase(); }
    if (av < bv) return -1 * dir; if (av > bv) return 1 * dir; return 0;
  });
  st.filtered = rows;
  renderTable();
}

function renderTable() {
  const c = cfg(); const st = tabState();
  const rows = st.filtered;
  $("#row-count").textContent = `${rows.length} of ${st.scored.length}`;
  // dynamic header
  $("#table-head").innerHTML = `
    <tr class="text-left text-xs font-bold uppercase tracking-wider text-slate-600">
      <th class="px-4 py-3 w-12">#</th>
      <th class="px-4 py-3 tab-th" data-sort="name">Company</th>
      <th class="px-4 py-3 tab-th" data-sort="score">Score ▾</th>
      <th class="px-4 py-3">Signals</th>
      ${c.columns.map((col) => `<th class="px-4 py-3">${escapeHtml(col.label)}</th>`).join("")}
      <th class="px-4 py-3 text-right">Link</th>
    </tr>
  `;
  $$("#table-head th[data-sort]").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.sort;
    if (state.sortBy === k) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    else { state.sortBy = k; state.sortDir = "desc"; }
    applyFilters();
  }));
  // body
  $("#table-body").innerHTML = rows.map((s, i) => {
    const name = c.name(s.company);
    const { color, initials } = avatarFor(name);
    const rank = st.scored.indexOf(s) + 1;
    const breakdownIcons = s.breakdown.slice(0, 8).map((b) => {
      const dot = ({ pass: "bg-emerald-500", partial: "bg-amber-400", fail: "bg-rose-400", hard_fail: "bg-rose-600", na: "bg-slate-300" })[b.status];
      return `<span class="w-1.5 h-1.5 rounded-full ${dot}" title="${escapeHtml(b.label)}: ${b.status}"></span>`;
    }).join("");
    const flagged = s.hardFails.length > 0;
    const slug = companyKey(s.company);
    const watched = state.watchlist.has(slug);
    return `
      <tr data-idx="${i}" class="row-clickable border-b border-slate-100 cursor-pointer transition-colors ${flagged ? "bg-rose-50/40 hover:bg-rose-50" : "hover:bg-slate-50"}" ${flagged ? `style="box-shadow: inset 3px 0 0 #f43f5e"` : ""}>
        <td class="px-4 py-3 text-sm text-slate-500 font-medium">
          <div class="flex items-center gap-1">
            <button data-watch="${escapeHtml(slug)}" class="watch-star text-base leading-none transition-colors ${watched ? "text-amber-400" : "text-slate-300 hover:text-amber-400"}" title="${watched ? "Remove from watchlist" : "Add to watchlist"}">${watched ? "★" : "☆"}</button>
            <span>${rank}</span>
          </div>
        </td>
        <td class="px-4 py-3">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center text-white text-xs font-bold shadow-sm flex-shrink-0">${initials}</div>
            <div class="min-w-0">
              <div class="font-semibold text-slate-900 truncate">${escapeHtml(name)}</div>
              <div class="text-xs text-slate-500 truncate">${escapeHtml(c.marketCap(s.company))}</div>
            </div>
          </div>
        </td>
        <td class="px-4 py-3">
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center justify-center min-w-[78px] px-2.5 py-1 rounded-lg text-sm font-bold tabular-nums ${scoreBadgeClass(s.scorePct)}">${c.composite ? Number(s.totalPoints).toFixed(1) : s.totalPoints}/${s.totalMax}</span>
            ${flagged ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-rose-100 text-rose-700 ring-1 ring-rose-200" title="${escapeHtml(s.hardFails.join(", "))}">⚠ Red Flag</span>` : ""}
            ${s.tickerError ? `<span class="text-[10px] text-slate-400 italic" title="${escapeHtml(s.tickerError)}">no data</span>` : ""}
          </div>
        </td>
        <td class="px-4 py-3"><div class="flex items-center gap-1">${breakdownIcons}</div></td>
        ${c.columns.map((col) => `<td class="px-4 py-3 text-sm text-slate-700">${col.html ? col.get(s.company) : escapeHtml(col.get(s.company))}</td>`).join("")}
        <td class="px-4 py-3 text-right">
          <a href="${escapeHtml(c.screenerUrl(s.company) || "")}" target="_blank" rel="noopener" class="text-indigo-600 hover:text-indigo-800 text-sm font-medium" onclick="event.stopPropagation()">↗</a>
        </td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="${4 + c.columns.length + 2}" class="px-4 py-12 text-center text-slate-400">No companies match your filters.</td></tr>`;
  $$("#table-body .row-clickable").forEach((el) => el.addEventListener("click", () => openDrillDown(st.filtered[Number(el.dataset.idx)])));
  // Watchlist star handlers — stop propagation so the row click doesn't fire too
  $$("#table-body .watch-star").forEach((btn) => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const k = btn.dataset.watch;
    if (!k) return;
    if (state.watchlist.has(k)) state.watchlist.delete(k);
    else state.watchlist.add(k);
    saveWatchlist(state.watchlist);
    updateWatchCount();
    // If "Watchlist only" is on, an unstar should drop the row from view
    if (state.watchOnly) applyFilters();
    else renderTable();
  }));
}

// Update the toolbar "Watchlist" pill count + active style.
function updateWatchCount() {
  const el = $("#watch-count");
  if (el) el.textContent = String(state.watchlist.size);
  const btn = $("#watch-toggle");
  if (btn) {
    const on = state.watchOnly;
    btn.classList.toggle("bg-amber-100", on);
    btn.classList.toggle("border-amber-300", on);
    btn.classList.toggle("text-amber-800", on);
    const icon = $("#watch-star-icon");
    if (icon) icon.textContent = on ? "★" : "☆";
  }
}

// ---------------- drill-down ----------------
function openDrillDown(s) {
  if (!s) return;
  const c = cfg();
  if (c.composite) return openCompositeDrill(s);
  const name = c.name(s.company);
  const { color, initials } = avatarFor(name);
  const co = s.company;
  const grouped = c.rules.reduce((acc, r) => { (acc[r.category] ||= []).push(r); return acc; }, {});
  const byKey = Object.fromEntries(s.breakdown.map((b) => [b.key, b]));

  const breakdownHtml = Object.entries(grouped).map(([cat, rules]) => `
    <div class="mb-5">
      <div class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">${escapeHtml(cat)}</div>
      <div class="space-y-2">
        ${rules.map((r) => {
          const b = byKey[r.key] || { status: "na", points: 0, max: r.fn ? 0 : 0, value: null, note: "—" };
          return `
            <div class="bg-white rounded-xl ring-1 ring-slate-100 p-3 hover:ring-slate-200 transition-shadow">
              <div class="flex items-start justify-between gap-2 mb-1">
                <div class="flex-1 min-w-0">
                  <div class="font-semibold text-slate-900 text-sm">${escapeHtml(r.label)}</div>
                  <div class="text-xs text-slate-500">Criteria: <span class="font-medium">${escapeHtml(r.criteria)}</span></div>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  ${statusPill(b.status)}
                  <span class="text-sm font-bold text-slate-700">${b.points}/${b.max}</span>
                </div>
              </div>
              <div class="text-sm text-slate-700 mt-2">${b.value == null ? "—" : escapeHtml(b.value)}</div>
              <div class="text-xs text-slate-500 mt-1 italic">${escapeHtml(b.note)}</div>
              ${renderRuleMetaButtons(r.key, co)}
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `).join("");

  // Only render the "Pending Data Source" block when there are actually
  // deferred rules — empty section was just visual noise on tabs whose
  // rules are all wired (Fundamentals, Technicals, etc. now have 0 deferred).
  const deferredHtml = (c.deferred && c.deferred.length) ? `
    <div class="mb-5">
      <div class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Pending Data Source</div>
      <div class="space-y-2">
        ${c.deferred.map((d) => `
          <div class="bg-amber-50 rounded-xl ring-1 ring-amber-100 p-3">
            <div class="flex items-start justify-between gap-2 mb-1">
              <div class="flex-1">
                <div class="font-semibold text-slate-900 text-sm">${escapeHtml(d.label)}</div>
                <div class="text-xs text-slate-500">Category: ${escapeHtml(d.category)} · Max ${d.max} pts</div>
              </div>
              ${statusPill("na")}
            </div>
            <div class="text-xs text-slate-600 mt-2">${escapeHtml(d.reason)}</div>
          </div>
        `).join("")}
      </div>
    </div>
  ` : "";

  const tier = s.hardFails.length ? "hardfail" : scoreTier(s.scorePct);
  const sector = c.sector(co), industry = c.industry(co);
  const headerStats = c.drillHeaderStats(co);

  $("#drill-content").innerHTML = `
    <div class="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-slate-100 p-5 z-10">
      <button id="drill-close" class="absolute top-4 right-4 text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
      <div class="flex items-center gap-4 pr-8">
        <div class="w-14 h-14 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white font-bold text-lg shadow-md">${initials}</div>
        <div class="flex-1 min-w-0">
          <div class="font-bold text-xl text-slate-900 truncate">${escapeHtml(name)}</div>
          ${(sector || industry) ? `<div class="text-xs text-slate-500 truncate mt-0.5">${escapeHtml(sector || "")}${sector && industry ? " · " : ""}${escapeHtml(industry || "")}</div>` : ""}
          ${c.screenerUrl(co) ? `<a href="${escapeHtml(c.screenerUrl(co))}" target="_blank" rel="noopener" class="text-xs text-indigo-600 hover:text-indigo-800">View on Screener.in ↗</a>` : ""}
        </div>
      </div>
      <div class="grid grid-cols-3 gap-3 mt-4">
        <div class="bg-slate-50 rounded-lg p-3">
          <div class="text-xs text-slate-500 font-medium">${escapeHtml(c.label)} Score</div>
          <div class="text-2xl font-bold ${tierColor(tier)}">${s.totalPoints}<span class="text-sm text-slate-400">/${s.totalMax}</span></div>
          <div class="text-xs text-slate-500">${tierLabel(tier)}</div>
        </div>
        ${headerStats.map((hs) => `
          <div class="bg-slate-50 rounded-lg p-3">
            <div class="text-xs text-slate-500 font-medium">${escapeHtml(hs.label)}</div>
            ${hs.metrics ? `
              <div class="grid grid-cols-${hs.metrics.length} gap-1 mt-1">
                ${hs.metrics.map((m) => `
                  <div class="min-w-0">
                    <div class="text-[9px] text-slate-400 uppercase tracking-wider">${escapeHtml(m.name)}</div>
                    <div class="text-sm font-bold text-slate-900 leading-tight whitespace-nowrap overflow-hidden text-ellipsis" title="${escapeHtml(String(m.value))}">${escapeHtml(String(m.value))}</div>
                  </div>
                `).join("")}
              </div>
            ` : `<div class="text-base font-bold text-slate-900 truncate">${escapeHtml(hs.main || "")}</div>`}
            <div class="text-xs text-slate-500 truncate">${escapeHtml(hs.sub || "")}</div>
          </div>
        `).join("")}
      </div>
      ${s.tickerError ? `
        <div class="mt-3 p-3 bg-slate-100 rounded-lg ring-1 ring-slate-200">
          <div class="text-xs text-slate-600"><span class="font-semibold">Data note:</span> ${escapeHtml(s.tickerError)}. ${c.label} scoring not available for this company.</div>
        </div>` : ""}
      ${s.hardFails.length ? `
        <div class="mt-3 p-3 bg-rose-50 rounded-lg ring-1 ring-rose-100">
          <div class="flex items-start gap-2 mb-2">
            <div class="text-rose-500 text-lg leading-none">⚠</div>
            <div class="flex-1">
              <div class="font-semibold text-rose-800 text-sm">Red flag${s.hardFails.length>1?"s":""} (per client framework)</div>
              <div class="text-[11px] text-rose-700/80">All data is present — these signals are deliberately surfaced as cautionary.</div>
            </div>
          </div>
          <div class="space-y-1.5 mt-2">
            ${s.breakdown.filter(b=>b.status==="hard_fail").map(b=>`
              <div class="text-xs">
                <span class="font-bold text-rose-800">${escapeHtml(b.label)}:</span>
                <span class="text-rose-700">${escapeHtml(b.value || "—")}</span>
                <div class="text-rose-700/80 mt-0.5">${escapeHtml(b.note)}</div>
              </div>
            `).join("")}
          </div>
        </div>` : ""}
    </div>
    <div class="p-5">
      ${breakdownHtml}
      ${deferredHtml}
    </div>
  `;
  $("#drill-panel").classList.remove("translate-x-full");
  $("#drill-overlay").classList.remove("hidden");
  $("#drill-close").addEventListener("click", closeDrillDown);
}
// Render a circular progress gauge as inline SVG. Returns an HTML
// string with the score number centred inside the ring.
function renderScoreGauge(score, theme, max = 100, size = 144) {
  const r = (size - 16) / 2;
  const cx = size / 2; const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, (score / max) * 100));
  const dash = (pct / 100) * circ;
  // Gradient stops keyed off the rating theme. Tailwind gradient
  // classes don't apply to SVG strokes, so we hardcode the hexes per
  // rating tier here.
  const gradMap = {
    "from-emerald-500 to-teal-500":   ["#10b981", "#14b8a6"],
    "from-blue-500 to-indigo-500":    ["#3b82f6", "#6366f1"],
    "from-amber-500 to-orange-500":   ["#f59e0b", "#f97316"],
    "from-rose-500 to-pink-500":      ["#f43f5e", "#ec4899"],
    "from-slate-500 to-slate-600":    ["#64748b", "#475569"],
    "from-slate-400 to-slate-500":    ["#94a3b8", "#64748b"],
  };
  const key = `${theme.from} ${theme.to}`;
  const [c1, c2] = gradMap[key] || ["#94a3b8", "#64748b"];
  const id = `g${Math.random().toString(36).slice(2,8)}`;
  return `
    <div class="relative" style="width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="-rotate-90">
        <defs>
          <linearGradient id="${id}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${c1}"/>
            <stop offset="100%" stop-color="${c2}"/>
          </linearGradient>
        </defs>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="10"/>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
                stroke="url(#${id})" stroke-width="10" stroke-linecap="round"
                stroke-dasharray="${dash} ${circ}"
                data-gauge-arc="${dash} ${circ}" />
      </svg>
      <div class="absolute inset-0 flex flex-col items-center justify-center">
        <div class="text-4xl font-bold text-slate-900 leading-none">${score == null ? "—" : `<span class="count-up" data-target="${score}" data-decimals="1">0.0</span>`}</div>
        <div class="text-[10px] text-slate-500 uppercase tracking-wider mt-1">/ ${max}</div>
      </div>
    </div>
  `;
}

// Loads insider-trades.json (the daily NSE PIT scrape output) and merges
// in public/data/insider-recent-supplement.json (the routine's recent-
// disclosures output) into a single by-ticker map. The supplement covers
// the ~30-day window where NSE PIT's API has a blackout; the daily scrape
// owns everything older. Per-company aggregates are summed so the rule
// sees the FULL picture without us having to merge in scoring.js.
async function loadInsiderMerged() {
  const out = {};
  try {
    const base = await fetch("data/insider-trades.json").then((r) => r.json());
    Object.assign(out, base?.companies || {});
  } catch {}
  let supp = null;
  try { supp = await fetch("data/insider-recent-supplement.json").then((r) => r.json()); }
  catch { return out; }
  if (!supp?.companies) return out;
  for (const [ticker, s] of Object.entries(supp.companies)) {
    const cur = out[ticker] || {
      buy_shares: 0, sell_shares: 0, buy_value: 0, sell_value: 0,
      transactions: 0, pledges_excluded: 0, last_date: null,
      net_shares: 0, net_value: 0,
    };
    cur.buy_shares       = (cur.buy_shares       || 0) + (s.buy_shares       || 0);
    cur.sell_shares      = (cur.sell_shares      || 0) + (s.sell_shares      || 0);
    cur.buy_value        = (cur.buy_value        || 0) + (s.buy_value        || 0);
    cur.sell_value       = (cur.sell_value       || 0) + (s.sell_value       || 0);
    cur.transactions     = (cur.transactions     || 0) + (s.transactions     || 0);
    cur.pledges_excluded = (cur.pledges_excluded || 0) + (s.pledges_excluded || 0);
    cur.net_shares       = (cur.buy_shares || 0) - (cur.sell_shares || 0);
    cur.net_value        = (cur.buy_value  || 0) - (cur.sell_value  || 0);
    if (s.last_date && (!cur.last_date || new Date(s.last_date) > new Date(cur.last_date))) {
      cur.last_date = s.last_date;
    }
    out[ticker] = cur;
  }
  return out;
}

// Lazy composite resolver — used by drill-down (any tab) to get the
// full 5-pillar shape for one company. If composite has already been
// computed (via SPIP tab or a prior drill-down), returns the cached
// result. Otherwise lazy-fetches technicals.json + macro.json and runs
// composite.scoreCompositeOne. Returns null if compute fails.
async function ensureCompositeFor(co) {
  if (!co) return null;
  const slug = companyKey(co);
  if (!slug) return null;
  if (state.compositeBySlug.has(slug)) return state.compositeBySlug.get(slug);
  if (co._composite) {
    state.compositeBySlug.set(slug, co._composite);
    return co._composite;
  }
  // Need technicals + macro to compute pillars. Load each once globally.
  if (!state.lazyTechBySlug) {
    try {
      const tj = await fetch("data/technicals.json").then((r) => r.json());
      const trows = (tj.companies || tj) || [];
      state.lazyTechBySlug = new Map();
      for (const t of trows) {
        const k = String(t.ticker || "").toUpperCase();
        if (k) state.lazyTechBySlug.set(k, t);
      }
    } catch { state.lazyTechBySlug = new Map(); }
  }
  if (!state.lazyMacroCtx) {
    try { state.lazyMacroCtx = await fetch("data/macro.json").then((r) => r.json()); }
    catch { state.lazyMacroCtx = {}; }
  }
  try {
    const techCo = state.lazyTechBySlug.get(slug) || null;
    const result = composite.scoreCompositeOne(co, techCo, state.lazyMacroCtx);
    state.compositeBySlug.set(slug, result);
    return result;
  } catch { return null; }
}

// Pillar card — premium card per pillar showing raw score, %, weight, and
// weighted contribution. Each line gets its own row for clean alignment.
function renderPillarCard(label, p, weight) {
  if (!p || p.raw == null) {
    return `
      <div class="rounded-xl ring-1 ring-slate-200 bg-slate-50/40 p-4">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">${escapeHtml(label)}</div>
        <div class="text-slate-300 text-3xl font-bold leading-none">—</div>
        <div class="text-[10px] text-slate-400 mt-1.5">no data</div>
        <div class="mt-3 h-2 rounded-full bg-slate-100"></div>
        <div class="mt-3 pt-3 border-t border-slate-200/80 flex items-baseline justify-between">
          <span class="text-[10px] text-slate-400 uppercase tracking-wider">${weight}% weight</span>
          <span class="font-bold text-slate-300 text-sm">+0.0</span>
        </div>
      </div>
    `;
  }
  const pct = p.pct ?? 0;
  const tier = pct >= 75 ? "emerald" : pct >= 60 ? "blue" : pct >= 45 ? "amber" : "rose";
  const barFill = ({ emerald: "bg-emerald-500", blue: "bg-blue-500", amber: "bg-amber-500", rose: "bg-rose-500" })[tier];
  const accent  = ({ emerald: "text-emerald-700", blue: "text-blue-700", amber: "text-amber-700", rose: "text-rose-700" })[tier];
  const bg      = ({ emerald: "bg-emerald-50/60", blue: "bg-blue-50/60", amber: "bg-amber-50/60", rose: "bg-rose-50/60" })[tier];
  return `
    <div class="rounded-xl ring-1 ring-slate-200 ${bg} p-4 hover:shadow-md hover:-translate-y-0.5 transition-all">
      <!-- Pillar name -->
      <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500 truncate">${escapeHtml(label)}</div>
      <!-- Raw score on its own row, large -->
      <div class="mt-2 flex items-baseline gap-1.5">
        <span class="text-3xl font-bold text-slate-900 leading-none">${p.raw}</span>
        <span class="text-sm text-slate-400">/ ${p.max}</span>
      </div>
      <!-- Percentage on its own row -->
      <div class="mt-1.5 text-xs font-semibold ${accent}">${pct}%</div>
      <!-- Progress bar -->
      <div class="mt-2.5 h-2 rounded-full bg-white/70 overflow-hidden ring-1 ring-slate-200/80">
        <div class="${barFill} h-2 rounded-full" data-bar-width="${Math.min(100, pct)}%" style="width: ${Math.min(100, pct)}%"></div>
      </div>
      <!-- Weight + contribution footer -->
      <div class="mt-3 pt-3 border-t border-slate-200/80 flex items-baseline justify-between">
        <span class="text-[10px] text-slate-500 uppercase tracking-wider">${weight}% weight</span>
        <span class="font-bold text-slate-900 text-sm">+${(p.weighted ?? 0).toFixed(1)}</span>
      </div>
    </div>
  `;
}

// ---------------- SPIP Basket — radar / thesis / animation / magazine ----------------

// 5-axis pillar radar (Fund / Tech / Macro / Sent / Liq) rendered as
// inline SVG. Concentric rings at 20/40/60/80/100, axes at 5 vertices,
// data polygon coloured to match the rating tier. Each axis is labelled
// at the perimeter with the pillar's raw/max + percentage.
//
// Layout: the `size` parameter is the chart RADIUS extent — labels
// extend into a `LABEL_PAD` zone outside that, so the actual SVG is
// (size + 2*LABEL_PAD) wide/tall. This prevents the right-edge labels
// (e.g. "17.5/24") from getting clipped when long.
function renderPillarRadar(s, theme, size = 280) {
  const LABEL_PAD = 64;             // room around chart for labels
  const svgSize = size + LABEL_PAD * 2;
  const cx = svgSize / 2, cy = svgSize / 2;
  const r = size / 2 - 6;           // chart radius proper
  // 5 axes — start at top (-90°) and step every 72°
  const axes = [
    { key: "fundamentals", label: "FUND" },
    { key: "technicals",   label: "TECH" },
    { key: "macro",        label: "MACRO" },
    { key: "sentiment",    label: "SENT" },
    { key: "liquidity",    label: "LIQ" },
  ];
  const ptAt = (axisIdx, pct) => {
    const angle = -Math.PI / 2 + (axisIdx * 2 * Math.PI / 5);
    return { x: cx + Math.cos(angle) * r * (pct / 100), y: cy + Math.sin(angle) * r * (pct / 100) };
  };
  // Concentric guide rings (20/40/60/80/100 %)
  const rings = [20, 40, 60, 80, 100].map((p) => {
    const pts = axes.map((_, i) => ptAt(i, p)).map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ");
    return `<polygon points="${pts}" fill="none" stroke="#e2e8f0" stroke-width="1"/>`;
  }).join("");
  // Axis lines (centre → vertex at 100%)
  const axisLines = axes.map((_, i) => {
    const p = ptAt(i, 100);
    return `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>`;
  }).join("");
  // Data polygon
  const dataPts = axes.map((a, i) => {
    const pct = s.pillars?.[a.key]?.pct ?? 0;
    const p = ptAt(i, pct);
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(" ");
  // Gradient stops keyed off the theme.
  const gradMap = {
    "from-emerald-500 to-teal-500":   ["#10b981", "#14b8a6"],
    "from-blue-500 to-indigo-500":    ["#3b82f6", "#6366f1"],
    "from-amber-500 to-orange-500":   ["#f59e0b", "#f97316"],
    "from-rose-500 to-pink-500":      ["#f43f5e", "#ec4899"],
    "from-slate-500 to-slate-600":    ["#64748b", "#475569"],
    "from-slate-400 to-slate-500":    ["#94a3b8", "#64748b"],
  };
  const key = `${theme.from} ${theme.to}`;
  const [c1, c2] = gradMap[key] || ["#94a3b8", "#64748b"];
  const gid = `rg${Math.random().toString(36).slice(2, 8)}`;
  // Axis labels — placed at a fixed pixel offset OUTSIDE the chart
  // radius so they never overlap the polygon. We use the LABEL_PAD
  // padding zone for them, so text never clips at the SVG edge.
  const labels = axes.map((a, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI / 5);
    const labelOffset = r + 26;     // distance from centre to the label baseline
    const lx = cx + Math.cos(angle) * labelOffset;
    const ly = cy + Math.sin(angle) * labelOffset;
    const p = s.pillars?.[a.key];
    const pct = p?.pct ?? 0;
    const raw = p?.raw ?? "—";
    const max = p?.max ?? "—";
    // Anchor: middle for top/bottom (i=0,3), start for right (i=1,2),
    // end for left (i=3,4). Determined by sign of cos(angle).
    const cos = Math.cos(angle);
    const anchor = Math.abs(cos) < 0.1 ? "middle" : (cos > 0 ? "start" : "end");
    // Vertical anchor: shift dy upward for top vertex, downward for
    // bottom vertices, so the 3-line label block doesn't overlap the
    // chart polygon visually.
    const sin = Math.sin(angle);
    const blockHeight = 36;          // 3 lines × ~12 px
    const dy = sin < -0.5 ? -blockHeight + 8     // top-ish vertex: pull whole block up
             : sin > 0.5  ? 6                    // bottom-ish vertex: leave it just below
             : -8;                                // sides: centre-ish
    return `
      <g text-anchor="${anchor}" transform="translate(0, ${dy})">
        <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" class="font-bold" font-size="10" fill="#64748b" letter-spacing="0.08em">${a.label}</text>
        <text x="${lx.toFixed(1)}" y="${(ly + 13).toFixed(1)}" font-size="12" font-weight="700" fill="#0f172a">${raw}/${max}</text>
        <text x="${lx.toFixed(1)}" y="${(ly + 25).toFixed(1)}" font-size="10" fill="#94a3b8">${pct}%</text>
      </g>
    `;
  }).join("");
  // Vertex dots on the data polygon
  const vertices = axes.map((a, i) => {
    const pct = s.pillars?.[a.key]?.pct ?? 0;
    const p = ptAt(i, pct);
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#fff" stroke="${c1}" stroke-width="2"/>`;
  }).join("");

  return `
    <div class="relative" style="width:${svgSize}px;height:${svgSize}px" data-radar="1">
      <svg width="${svgSize}" height="${svgSize}" viewBox="0 0 ${svgSize} ${svgSize}" style="overflow: visible;">
        <defs>
          <linearGradient id="${gid}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${c1}" stop-opacity="0.65"/>
            <stop offset="100%" stop-color="${c2}" stop-opacity="0.35"/>
          </linearGradient>
        </defs>
        ${rings}
        ${axisLines}
        <g class="radar-data" style="transform-origin: ${cx}px ${cy}px; transform: scale(0); transition: transform 700ms cubic-bezier(0.34, 1.56, 0.64, 1);">
          <polygon points="${dataPts}" fill="url(#${gid})" stroke="${c1}" stroke-width="2.5"/>
          ${vertices}
        </g>
        ${labels}
      </svg>
    </div>
  `;
}

// Count-up animator. Animates `.count-up` elements from 0 to their
// data-target value over ~900ms with ease-out. Call after the modal
// content is mounted; the same call also fires the radar scale-in
// (CSS transition) and the gauge dash sweep.
function animateScoreEntrance(root = document) {
  // Count-up numbers
  root.querySelectorAll(".count-up").forEach((el) => {
    const target = parseFloat(el.dataset.target);
    const decimals = parseInt(el.dataset.decimals || "0", 10);
    if (!Number.isFinite(target)) return;
    const start = performance.now();
    const dur = 900;
    function tick(now) {
      const t = Math.min(1, (now - start) / dur);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = (target * eased).toFixed(decimals);
      if (t < 1) requestAnimationFrame(tick);
      else el.textContent = target.toFixed(decimals);
    }
    requestAnimationFrame(tick);
  });
  // Gauge ring sweep: start at 0 dasharray, transition to final
  root.querySelectorAll("[data-gauge-arc]").forEach((arc) => {
    const finalDash = arc.dataset.gaugeArc;
    arc.setAttribute("stroke-dasharray", "0 100000");
    requestAnimationFrame(() => {
      arc.style.transition = "stroke-dasharray 1100ms cubic-bezier(0.34, 1.56, 0.64, 1)";
      arc.setAttribute("stroke-dasharray", finalDash);
    });
  });
  // Radar polygon scale-in (transform set inline; just kick the property)
  root.querySelectorAll(".radar-data").forEach((el) => {
    requestAnimationFrame(() => { el.style.transform = "scale(1)"; });
  });
  // Pillar bar width sweep
  root.querySelectorAll("[data-bar-width]").forEach((bar) => {
    const finalWidth = bar.dataset.barWidth;
    bar.style.width = "0%";
    requestAnimationFrame(() => {
      bar.style.transition = "width 900ms cubic-bezier(0.34, 1.56, 0.64, 1)";
      bar.style.width = finalWidth;
    });
  });
}

// Synthesised "thesis" — short narrative built from the actual scoring
// data. Picks the strongest pillar contribution, the weakest pillar,
// and the recommended action; assembles them into 2–3 sentences. No
// LLM call, no fabricated numbers; everything reads from `s`.
function synthesizeThesis(s) {
  const p = s.pillars || {};
  const valid = Object.entries(p).filter(([_, v]) => v.raw != null && v.pct != null);
  if (!valid.length) return "Scoring data incomplete — thesis unavailable.";
  const labelMap = { fundamentals: "Fundamentals", technicals: "Technicals", macro: "Macro tailwind", sentiment: "Sentiment", liquidity: "Liquidity" };
  // Strongest = highest percentage; weakest = lowest percentage among those that scored.
  const sorted = [...valid].sort((a, b) => b[1].pct - a[1].pct);
  const top = sorted[0];
  const bot = sorted[sorted.length - 1];
  const composite = s.composite != null ? s.composite.toFixed(1) : "—";
  const rating = s.rating || "—";

  const sentences = [];
  sentences.push(`Composite scores <strong>${composite}/100</strong> — ${rating} territory per the SPIP framework.`);
  if (top && top[1].pct >= 75) {
    sentences.push(`Anchored by <strong>${labelMap[top[0]] || top[0]}</strong> at <strong>${top[1].raw}/${top[1].max}</strong> (${top[1].pct}%), contributing <strong>+${(top[1].weighted ?? 0).toFixed(1)}</strong> of the composite.`);
  } else if (top) {
    sentences.push(`Leading contributor: ${labelMap[top[0]] || top[0]} at ${top[1].raw}/${top[1].max} (${top[1].pct}%).`);
  }
  if (bot && bot[1].pct < 50 && bot[0] !== top[0]) {
    const isMarketWide = (bot[0] === "sentiment" || bot[0] === "macro");
    const qualifier = isMarketWide ? " (market-wide factor — not company-specific)" : "";
    sentences.push(`Watch: <strong>${labelMap[bot[0]] || bot[0]}</strong> drags at ${bot[1].pct}%${qualifier}.`);
  }
  if (s.hardFails && s.hardFails.length) {
    sentences.push(`<strong>Hard-fail triggered:</strong> ${s.hardFails.join(", ")} — stock excluded from basket regardless of composite.`);
  }
  return sentences.join(" ");
}

// Magazine ("Full Story") drill — fullscreen takeover with a hero,
// pillar radar, by-the-numbers sidebar, thesis pull-quote, and
// recommended action. Triggered from the standard drill via the
// "View Full Story" button (only when not hard-failed).
function openMagazineDrill(s) {
  const co = s.company || {};
  const name = co.Company || "—";
  const sector = co.Sector || "";
  const theme = composite.ratingTheme(s.rating);
  const decision = composite.decisionFor(s.rating);
  const thesis = synthesizeThesis(s);

  // "By the numbers" — pull whatever ratios are available from the
  // fundamentals row. Each cell falls back to "—" when missing. The
  // first two (Composite + Rating) are rendered in their own hero
  // block above the secondary metrics list.
  const heroMetrics = [
    { label: "Composite",  value: s.composite != null ? s.composite.toFixed(1) : "—", suffix: "/ 100", accent: theme.accent },
    { label: "Rating",     value: s.rating, suffix: "",       accent: theme.accent },
  ];
  const ratios = [
    { label: "Market Cap",      value: co["Market Cap"] || "—" },
    { label: "CMP",             value: co["Current Price"] ? `₹${co["Current Price"]}` : "—" },
    { label: "P/E",             value: co["Stock P/E"] || "—" },
    { label: "ROE",             value: co["ROE"] || "—" },
    { label: "ROCE",            value: co["ROCE"] || "—" },
    { label: "Debt / Equity",   value: co["Debt to equity"] || "—" },
    { label: "Rev 3Y CAGR",     value: co["Sales growth 3Years"] || "—" },
    { label: "PAT 3Y CAGR",     value: co["Profit Var 3Yrs"] || "—" },
  ];

  openModal(`
    <div class="relative overflow-hidden">
      <div class="absolute inset-0 bg-gradient-to-br ${theme.from} ${theme.to}"></div>
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.20),transparent_55%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.10),transparent_60%)]"></div>
      <button id="modal-close" class="absolute top-4 right-4 z-10 text-white/85 hover:text-white text-2xl leading-none w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur flex items-center justify-center transition-colors">×</button>
      <div class="relative px-8 py-7 ${theme.textOn}">
        <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.25em] opacity-85">
          <span>SPIP Brief</span>
          <span class="opacity-50">·</span>
          <span>${escapeHtml(s.rating)}</span>
          <span class="opacity-50">·</span>
          <span>${escapeHtml(sector || "—")}</span>
        </div>
        <h1 class="font-display font-extrabold text-4xl sm:text-5xl mt-3 leading-[1.05] tracking-tight">${escapeHtml(name)}</h1>
        <p class="text-[15px] opacity-95 mt-3 max-w-3xl leading-[1.65]">${thesis}</p>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-0 max-h-[calc(95vh-240px)] overflow-y-auto">
      <!-- LEFT 2/3 — radar + decision -->
      <div class="lg:col-span-2 p-7 border-r border-slate-100">
        <div class="flex items-baseline justify-between mb-2">
          <div class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500">Pillar Composition</div>
          <div class="text-[11px] text-slate-500">Weighted 40 · 35 · 15 · 5 · 5</div>
        </div>
        <div class="flex items-center justify-center -my-2">
          ${renderPillarRadar(s, theme, 280)}
        </div>

        <!-- Decision band -->
        <div class="bg-gradient-to-br ${theme.soft} rounded-2xl ring-1 ${theme.ring} p-5">
          <div class="flex items-center justify-between mb-2">
            <div class="text-[10px] font-bold uppercase tracking-[0.15em] ${theme.accent}">Recommended Action</div>
            <span class="text-[10px] text-slate-500 whitespace-nowrap">SPIP · Section C</span>
          </div>
          <div class="text-lg font-bold text-slate-900 mb-4 leading-snug">${escapeHtml(decision.action)}</div>
          <div class="grid grid-cols-3 gap-4">
            <div class="border-l-2 ${theme.ring.replace("ring-", "border-")} pl-3">
              <div class="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Size</div>
              <div class="font-semibold text-slate-900 leading-snug text-xs">${escapeHtml(decision.size)}</div>
            </div>
            <div class="border-l-2 ${theme.ring.replace("ring-", "border-")} pl-3">
              <div class="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Review</div>
              <div class="font-semibold text-slate-900 leading-snug text-xs">${escapeHtml(decision.review)}</div>
            </div>
            <div class="border-l-2 ${theme.ring.replace("ring-", "border-")} pl-3">
              <div class="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Exit Trigger</div>
              <div class="font-semibold text-slate-900 leading-snug text-[11px]">${escapeHtml(decision.exit)}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- RIGHT 1/3 — by the numbers -->
      <div class="p-7 bg-slate-50/40">
        <div class="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-500 mb-4">By the Numbers</div>

        <!-- Hero metrics: Composite + Rating, larger format -->
        <div class="space-y-2.5 mb-5">
          ${heroMetrics.map((m) => `
            <div class="bg-white rounded-xl p-3 ring-1 ring-slate-200/70">
              <div class="text-[10px] text-slate-500 uppercase tracking-wider">${escapeHtml(m.label)}</div>
              <div class="flex items-baseline gap-1.5 mt-0.5">
                <span class="text-2xl font-bold ${m.accent} leading-none">${escapeHtml(m.value || "—")}</span>
                ${m.suffix ? `<span class="text-xs text-slate-400">${escapeHtml(m.suffix)}</span>` : ""}
              </div>
            </div>
          `).join("")}
        </div>

        <!-- Secondary metrics: vertical-accent rows -->
        <div class="space-y-0">
          ${ratios.map((r, i) => `
            <div class="flex items-center justify-between gap-3 py-2.5 ${i < ratios.length - 1 ? "border-b border-slate-200/60" : ""}">
              <div class="flex items-center gap-2.5">
                <div class="w-0.5 h-4 rounded-full bg-gradient-to-b ${theme.from} ${theme.to} opacity-60"></div>
                <div class="text-xs text-slate-600">${escapeHtml(r.label)}</div>
              </div>
              <div class="font-bold text-slate-900 text-sm text-right">${escapeHtml(r.value || "—")}</div>
            </div>
          `).join("")}
        </div>

        <div class="mt-6 pt-4 border-t border-slate-200">
          <button id="mag-back" class="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors inline-flex items-center gap-1">
            <span class="text-base leading-none">←</span> Back to standard view
          </button>
        </div>
      </div>
    </div>
  `, { size: "magazine" });

  // Wire close / back / dismiss + run the entrance animations
  $("#modal-close")?.addEventListener("click", closeModal);
  $("#mag-back")?.addEventListener("click", () => { closeModal(); openCompositeDrill(s); });
  $("#modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  }, { once: true });
  // Fire animations on the radar (gauge isn't on this view)
  requestAnimationFrame(() => animateScoreEntrance($("#modal-content")));
}

// SPIP Basket drill — opens as a CENTRED MODAL (not the side panel).
// Hero gauge + decision card on top, 5-card pillar composition below,
// then drill-deeper shortcuts to the per-pillar tabs.
function openCompositeDrill(s) {
  const co = s.company || {};
  const name = co.Company || "—";
  const sector = co.Sector || ""; const industry = co["Broad Industry"] || "";
  const url = co["Screener URL"] || null;
  const theme = composite.ratingTheme(s.rating);
  const decision = composite.decisionFor(s.rating);
  const initials = avatarFor(name).initials;

  // --- Hero header
  const heroHeader = `
    <div class="relative overflow-hidden">
      <div class="absolute inset-0 bg-gradient-to-br ${theme.from} ${theme.to}"></div>
      <div class="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.20),transparent_55%)]"></div>
      <button id="modal-close" class="absolute top-3 right-3 z-10 text-white/85 hover:text-white text-2xl leading-none w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur flex items-center justify-center transition-colors">×</button>
      <div class="relative p-6 ${theme.textOn}">
        <div class="flex items-center gap-4 pr-12">
          <div class="w-16 h-16 rounded-2xl bg-white/20 backdrop-blur ring-1 ring-white/30 flex items-center justify-center text-white font-bold text-xl shadow-lg flex-shrink-0">${initials}</div>
          <div class="flex-1 min-w-0">
            <div class="font-bold text-2xl sm:text-3xl truncate">${escapeHtml(name)}</div>
            ${(sector || industry) ? `<div class="text-sm opacity-90 truncate mt-1">${escapeHtml(sector)}${sector && industry ? " · " : ""}${escapeHtml(industry)}</div>` : ""}
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs">
              ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="opacity-95 hover:opacity-100 underline decoration-white/40 hover:decoration-white whitespace-nowrap">View on Screener.in ↗</a>` : ""}
              <span class="opacity-95 whitespace-nowrap">${escapeHtml(co["Market Cap"] || "—")} mkt cap</span>
              <span class="opacity-95 whitespace-nowrap">CMP ${escapeHtml(co["Current Price"] || "—")}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // --- Hero panel: gauge | decision card. Modal is wide, so we can give
  // each panel real breathing room rather than cramming them.
  const heroPanel = `
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
      <div class="bg-white rounded-2xl ring-1 ring-slate-200 p-6 flex items-center gap-6">
        ${renderScoreGauge(s.composite, theme, 100, 168)}
        <div class="flex-1 min-w-0">
          <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Composite Score</div>
          <div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r ${theme.from} ${theme.to} ${theme.textOn} text-sm font-bold shadow-sm">
            <span class="w-1.5 h-1.5 rounded-full bg-white"></span>
            ${escapeHtml(s.rating)}
          </div>
          <div class="text-sm text-slate-600 mt-3 leading-snug">${escapeHtml(decision.profile)}</div>
        </div>
      </div>
      <div class="bg-gradient-to-br ${theme.soft} rounded-2xl ring-1 ${theme.ring} p-6">
        <div class="flex items-center justify-between mb-2">
          <div class="text-[10px] font-bold uppercase tracking-wider ${theme.accent}">Recommended Action</div>
          <span class="text-[10px] text-slate-500 whitespace-nowrap">SPIP · Section C</span>
        </div>
        <div class="text-lg font-bold text-slate-900 mb-4 leading-snug">${escapeHtml(decision.action)}</div>
        <div class="grid grid-cols-3 gap-3 text-xs">
          <div>
            <div class="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Size</div>
            <div class="font-semibold text-slate-900 leading-snug">${escapeHtml(decision.size)}</div>
          </div>
          <div>
            <div class="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Review</div>
            <div class="font-semibold text-slate-900 leading-snug">${escapeHtml(decision.review)}</div>
          </div>
          <div>
            <div class="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Exit Trigger</div>
            <div class="font-semibold text-slate-900 leading-snug text-[11px]">${escapeHtml(decision.exit)}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  const hardFailPanel = s.hardFails.length ? `
    <div class="mb-6 p-5 bg-gradient-to-br from-rose-50 to-pink-50 rounded-2xl ring-1 ring-rose-200">
      <div class="flex items-start gap-3 mb-3">
        <div class="w-10 h-10 rounded-xl bg-rose-500 text-white flex items-center justify-center text-xl flex-shrink-0">⚠</div>
        <div class="flex-1">
          <div class="font-bold text-rose-900 text-base">Excluded from SPIP Basket</div>
          <div class="text-sm text-rose-700/90 mt-0.5">Hard fail per client framework · stock exits pipeline regardless of composite score</div>
        </div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-${s.hardFails.length > 2 ? 3 : 2} gap-2 mt-3">
        ${s.hardFails.map((h) => `
          <div class="bg-white rounded-lg p-3 ring-1 ring-rose-100">
            <div class="text-[10px] font-bold uppercase tracking-wider text-rose-500">Red Flag</div>
            <div class="text-sm font-bold text-rose-900 mt-0.5">${escapeHtml(h)}</div>
          </div>
        `).join("")}
      </div>
    </div>
  ` : "";

  const unratedPanel = (!s.hardFails.length && s.unrated) ? `
    <div class="mb-6 p-5 bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl ring-1 ring-amber-200">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center text-xl flex-shrink-0">ℹ</div>
        <div class="flex-1">
          <div class="font-bold text-amber-900 text-base">Unrated — Technicals data missing</div>
          <div class="text-sm text-amber-800/90 mt-0.5">Yahoo doesn't carry OHLCV for this ticker (REITs / InvITs / very-recent listings). Composite will populate when a vendor with NSE coverage is wired.</div>
        </div>
      </div>
    </div>
  ` : "";

  // --- Pillar composition: 5-card grid with proper breathing room
  const pillarCards = `
    <div class="mb-6">
      <div class="flex items-baseline justify-between mb-3">
        <div class="text-xs font-bold uppercase tracking-wider text-slate-500">Pillar Composition</div>
        <div class="text-[11px] text-slate-500">Sum of weighted contributions = Composite</div>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        ${renderPillarCard("Fundamentals", s.pillars?.fundamentals, 40)}
        ${renderPillarCard("Technicals",   s.pillars?.technicals,   35)}
        ${renderPillarCard("Macro",        s.pillars?.macro,        15)}
        ${renderPillarCard("Sentiment",    s.pillars?.sentiment,    5)}
        ${renderPillarCard("Liquidity",    s.pillars?.liquidity,    5)}
      </div>
      <div class="mt-3 flex items-center justify-between bg-gradient-to-r from-slate-50 to-slate-100 rounded-xl px-4 py-3 ring-1 ring-slate-200">
        <div class="flex items-center gap-2">
          <span class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Composite Score</span>
          <span class="text-[10px] text-slate-400">(weighted sum)</span>
        </div>
        <div class="flex items-baseline gap-1">
          <span class="text-2xl font-bold ${theme.accent}">${s.composite != null ? s.composite.toFixed(1) : "—"}</span>
          <span class="text-sm text-slate-400">/ 100</span>
        </div>
      </div>
    </div>
  `;

  const PILLAR_INFO = {
    fundamentals: { icon: "📊", label: "Fundamentals", count: "19 rules", color: "from-violet-500 to-purple-500" },
    technicals:   { icon: "📈", label: "Technicals",   count: "16 rules", color: "from-sky-500 to-blue-500" },
    macro:        { icon: "🌐", label: "Macro",        count: "11 rules", color: "from-emerald-500 to-teal-500" },
    sentiment:    { icon: "💹", label: "Sentiment",    count: "8 rules",  color: "from-amber-500 to-orange-500" },
  };
  const tabShortcuts = `
    <div>
      <div class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Drill Deeper Into Each Pillar</div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        ${Object.entries(PILLAR_INFO).map(([tab, info]) => `
          <button class="composite-jump group relative overflow-hidden rounded-xl ring-1 ring-slate-200 hover:ring-slate-300 bg-white hover:shadow-md transition-all text-left p-3"
                  data-jump-tab="${tab}">
            <div class="absolute inset-0 bg-gradient-to-br ${info.color} opacity-0 group-hover:opacity-5 transition-opacity"></div>
            <div class="relative flex items-start gap-2.5">
              <div class="w-9 h-9 rounded-lg bg-gradient-to-br ${info.color} text-white flex items-center justify-center text-sm shadow-sm flex-shrink-0">${info.icon}</div>
              <div class="flex-1 min-w-0">
                <div class="font-bold text-slate-900 text-sm">${escapeHtml(info.label)}</div>
                <div class="text-[10px] text-slate-500">${info.count} → see breakdown</div>
              </div>
              <div class="text-slate-300 group-hover:text-slate-500 transition-colors text-sm">→</div>
            </div>
          </button>
        `).join("")}
      </div>
    </div>
  `;

  // Pillar radar — sits centred between the hero panel and pillar cards
  // when there's data to chart (skip on hard-fails / unrated to keep
  // the message focused on the exclusion reason).
  const hasPillarData = Object.values(s.pillars || {}).some((p) => p && p.raw != null);
  const radarSection = (!s.hardFails.length && !s.unrated && hasPillarData) ? `
    <div class="mb-6 bg-white rounded-2xl ring-1 ring-slate-200 p-5">
      <div class="flex items-baseline justify-between mb-2">
        <div class="text-xs font-bold uppercase tracking-wider text-slate-500">Pillar Shape</div>
        <div class="text-[11px] text-slate-500">Visual read on the 5-pillar profile</div>
      </div>
      <div class="flex items-center justify-center pt-2 pb-3">
        ${renderPillarRadar(s, theme, 300)}
      </div>
    </div>
  ` : "";

  // "View Full Story" button — opens the magazine layout. Offered for
  // any rated stock that didn't hard-fail. Strong-buy gets a louder pill.
  const magazineCta = (!s.hardFails.length && !s.unrated) ? `
    <div class="mb-6 flex items-center justify-between gap-4 p-4 bg-gradient-to-br from-slate-50 to-indigo-50/60 rounded-2xl ring-1 ring-slate-200">
      <div class="flex-1 min-w-0">
        <div class="font-bold text-slate-900 text-sm">Magazine Brief</div>
        <div class="text-xs text-slate-500 mt-0.5">Full-page presentation with hero, thesis, by-the-numbers — built for sharing.</div>
      </div>
      <button id="open-magazine" class="px-4 py-2 rounded-lg bg-gradient-to-r ${theme.from} ${theme.to} ${theme.textOn} text-sm font-bold shadow-sm hover:shadow-md transition-all flex items-center gap-1.5 flex-shrink-0">
        View Full Story <span class="text-base leading-none">→</span>
      </button>
    </div>
  ` : "";

  openModal(`
    ${heroHeader}
    <div class="p-6 max-h-[calc(90vh-200px)] overflow-y-auto">
      ${hardFailPanel}
      ${unratedPanel}
      ${heroPanel}
      ${radarSection}
      ${pillarCards}
      ${magazineCta}
      ${tabShortcuts}
    </div>
  `, { size: "wide" });

  // Entrance animation: gauge sweep, radar polygon scale-in, pillar
  // bars sweep, composite number counts up.
  requestAnimationFrame(() => animateScoreEntrance($("#modal-content")));

  $("#open-magazine")?.addEventListener("click", () => { closeModal(); openMagazineDrill(s); });
  $("#modal-close")?.addEventListener("click", closeModal);
  $("#modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  }, { once: true });
  // Drill-deeper button: close composite modal, switch to the target
  // pillar tab, then immediately open the per-company side panel for
  // THIS company on that tab (instead of dropping the user into an
  // unfocused table).
  $$(".composite-jump").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const targetTab = btn.dataset.jumpTab;
      const companyName = co.Company || co.name || "";
      closeModal();
      await switchTab(targetTab);
      // Find the score-row that corresponds to the same company on
      // the destination tab — different tabs key on Company vs name.
      const st = state.cache[targetTab];
      const target = CONFIGS[targetTab];
      const match = st?.scored.find((s) => {
        try { return target.name(s.company) === companyName; } catch { return false; }
      });
      if (match) openDrillDown(match);
    });
  });
}

function closeDrillDown() {
  $("#drill-panel").classList.add("translate-x-full");
  $("#drill-overlay").classList.add("hidden");
}

// ---------------- Centred modal (composite drill + help) ----------------
// Side-panel drill works for the per-pillar tabs (lots of rules,
// vertical scroll). The composite drill and the help screen need the
// full attention of the page, so they open in a centred modal.

function openModal(innerHtml, opts = {}) {
  const sizeClass = opts.size === "magazine" ? "max-w-6xl" : opts.size === "wide" ? "max-w-5xl" : "max-w-4xl";
  const container = $("#modal-container");
  container.className = `relative bg-white rounded-3xl shadow-2xl w-full ${sizeClass} my-8 scale-95 opacity-0 transition-all duration-200 overflow-hidden`;
  $("#modal-content").innerHTML = innerHtml;
  $("#modal-overlay").classList.add("is-open");
  $("#modal-overlay").classList.remove("hidden");
  // requestAnimationFrame so the entrance transition fires
  requestAnimationFrame(() => container.classList.replace("scale-95", "scale-100"));
  // ESC + click-outside close
  const onKey = (e) => { if (e.key === "Escape") closeModal(); };
  document.addEventListener("keydown", onKey);
  $("#modal-overlay").__onKey = onKey;
}
function closeModal() {
  const ov = $("#modal-overlay");
  ov.classList.remove("is-open");
  ov.classList.add("hidden");
  $("#modal-content").innerHTML = "";
  if (ov.__onKey) { document.removeEventListener("keydown", ov.__onKey); ov.__onKey = null; }
}

// Scoring-framework help content for each tab.
// Pillar tabs: list every rule the tab scores, grouped by category,
//              with the max points and pass criterion.
// Composite tab: pillar weighting + rating bands + decision framework
//                + every hard-fail rule across all pillars.
function buildHelpModal(tabId) {
  const cfgTab = CONFIGS[tabId];

  // SPIP Basket — composite-specific help: weights + bands + hard fails.
  if (cfgTab.composite) {
    const weightedRow = (label, weight, max, color) => `
      <div class="flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-0">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br ${color} text-white flex items-center justify-center font-bold text-sm shadow-sm flex-shrink-0">${weight}%</div>
        <div class="flex-1 min-w-0">
          <div class="font-bold text-slate-900 text-sm">${label}</div>
          <div class="text-xs text-slate-500">Max ${max} raw pts → weighted contribution up to ${weight} pts</div>
        </div>
        <div class="text-xs text-slate-400 font-mono">×${weight}%</div>
      </div>
    `;
    const ratingRow = (rating, range, color, action) => `
      <div class="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
        <div class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${color} flex-shrink-0 min-w-[88px] text-center">${rating}</div>
        <div class="text-xs text-slate-500 font-mono flex-shrink-0 w-16">${range}</div>
        <div class="text-xs text-slate-700">${action}</div>
      </div>
    `;
    const hardFails = [
      { pillar: "Fundamentals", rule: "Operating Cash Flow", trigger: "Negative CFO in latest year" },
      { pillar: "Fundamentals", rule: "Interest Coverage",    trigger: "ICR < 1.5 (debt-serviceability risk)" },
      { pillar: "Fundamentals", rule: "Promoter Pledge",      trigger: "Pledge > 20%" },
      { pillar: "Fundamentals", rule: "Debt / Equity",        trigger: "D/E > 2 (extreme leverage)" },
      { pillar: "Fundamentals", rule: "Auditor Remarks",      trigger: "Adverse opinion / disclaimer" },
      { pillar: "Fundamentals", rule: "SEBI Governance",      trigger: "Active SEBI investigation" },
      { pillar: "Technicals",   rule: "Price Above 200 DMA",  trigger: "Stock below 200 DMA (primary trend filter)" },
      { pillar: "Liquidity",    rule: "Avg Daily Traded Value", trigger: "ADTV < ₹5 Cr (illiquid)" },
    ];

    return `
      <div class="relative bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 p-6 text-white">
        <button id="modal-close" class="absolute top-3 right-3 text-white/80 hover:text-white text-2xl leading-none w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">×</button>
        <div class="text-xs font-semibold uppercase tracking-wider opacity-90">SPIP — Stock Selection &amp; Performance Index</div>
        <h2 class="text-2xl font-bold mt-1">How the SPIP Basket Is Scored</h2>
        <p class="text-sm opacity-90 mt-1">Weighted composite of 5 pillars · rating bands per client framework · hard-fail rules exclude stocks from the basket entirely.</p>
      </div>
      <div class="p-6 max-h-[calc(90vh-180px)] overflow-y-auto">

        <div class="mb-6">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Pillar Weights — composite formula</h3>
          <div class="bg-slate-50 rounded-xl p-4 ring-1 ring-slate-200">
            <div class="font-mono text-[11px] text-slate-700 text-center mb-3 leading-relaxed">
              Composite = (Fund/29)×40 + (Tech/24)×35 + (Macro/17)×15 + (Sent/6)×5 + (Liq/6)×5
            </div>
            ${weightedRow("Fundamentals — 19 rules", 40, 29, "from-violet-500 to-purple-500")}
            ${weightedRow("Technicals — 16 rules",    35, 24, "from-sky-500 to-blue-500")}
            ${weightedRow("Macro / Sector — 11 rules", 15, 17, "from-emerald-500 to-teal-500")}
            ${weightedRow("Sentiment — 4 rules",       5,  6,  "from-amber-500 to-orange-500")}
            ${weightedRow("Liquidity — 4 rules",       5,  6,  "from-rose-500 to-pink-500")}
          </div>
        </div>

        <div class="mb-6">
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Rating Bands — what each score band means</h3>
          <div class="bg-slate-50 rounded-xl p-4 ring-1 ring-slate-200">
            ${ratingRow("STRONG BUY", "≥ 75",   "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200", "Initiate FULL position · 8–10% of basket · monthly review")}
            ${ratingRow("BUY",        "60–74", "bg-blue-100 text-blue-800 ring-1 ring-blue-200",          "Initiate 50–75% position · 5–7% of basket · bi-weekly review")}
            ${ratingRow("WATCH",      "45–59", "bg-amber-100 text-amber-800 ring-1 ring-amber-200",       "Watchlist · do not initiate · weekly review")}
            ${ratingRow("AVOID",      "< 45",  "bg-rose-100 text-rose-800 ring-1 ring-rose-200",          "Exit position · zero allocation · immediate action")}
            ${ratingRow("HARD FAIL",  "—",     "bg-slate-200 text-slate-800 ring-1 ring-slate-300",       "Excluded from basket regardless of composite score")}
          </div>
        </div>

        <div>
          <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Hard-Fail Rules — stock exits pipeline</h3>
          <div class="bg-rose-50/40 rounded-xl p-4 ring-1 ring-rose-200">
            <div class="text-xs text-rose-800 mb-3">If any of these trigger, the stock is excluded from the SPIP basket regardless of its composite score:</div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              ${hardFails.map((hf) => `
                <div class="bg-white rounded-lg p-2.5 ring-1 ring-rose-100">
                  <div class="text-[10px] font-bold uppercase tracking-wider text-rose-500">${escapeHtml(hf.pillar)}</div>
                  <div class="text-sm font-bold text-rose-900 mt-0.5">${escapeHtml(hf.rule)}</div>
                  <div class="text-[11px] text-rose-700/90 mt-0.5">${escapeHtml(hf.trigger)}</div>
                </div>
              `).join("")}
            </div>
          </div>
        </div>

      </div>
    `;
  }

  // Pillar tabs (Fundamentals / Technicals / Macro / Sentiment & Liquidity):
  // list every rule with category, max points, and pass criterion.
  const rules = cfgTab.rules || [];
  const grouped = rules.reduce((acc, r) => { (acc[r.category] ||= []).push(r); return acc; }, {});
  const totalMax = rules.reduce((s, r) => s + ((r.fn ? r.fn({}).max : 0) || 0), 0) || cfgTab.stats?.maxScore?.match(/\d+/)?.[0] || 0;
  const headerColors = {
    fundamentals: "from-violet-500 via-purple-500 to-pink-500",
    technicals:   "from-sky-500 via-blue-500 to-indigo-500",
    macro:        "from-emerald-500 via-teal-500 to-cyan-500",
    sentiment:    "from-amber-500 via-orange-500 to-rose-500",
  };
  const grad = headerColors[tabId] || "from-slate-500 to-slate-700";

  // META holds the verbatim client scoring sheet text — surfaces the
  // full point-band breakdown (pass / partial / fail) per rule so the
  // user sees not just the headline threshold but the full structure.
  const metaForTab = RULE_META[tabId] || {};

  const ruleRow = (r) => {
    let max = 0;
    try { max = r.fn ? (r.fn({}).max || 0) : 0; } catch { max = 0; }
    // Max-point tier styling so 2 pts pops more than 1 pt.
    const pointStyle = max >= 2
      ? "bg-gradient-to-br from-indigo-500 to-purple-500 text-white shadow-sm"
      : max === 1
        ? "bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200"
        : "bg-slate-100 text-slate-500";
    const clientLogic = metaForTab[r.key]?.clientLogic || "";
    return `
      <div class="flex items-start gap-3 py-3 border-b border-slate-100 last:border-0">
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-3 mb-1">
            <div class="font-semibold text-slate-900 text-sm">${escapeHtml(r.label)}</div>
            <div class="inline-flex items-baseline gap-0.5 px-2 py-0.5 rounded-md text-[11px] font-bold ${pointStyle} flex-shrink-0">
              <span>${max}</span>
              <span class="opacity-90">pt${max === 1 ? "" : "s"}</span>
              <span class="opacity-75 ml-0.5 text-[9px] font-semibold uppercase tracking-wider">max</span>
            </div>
          </div>
          <div class="text-[11px] text-slate-500"><span class="font-semibold text-slate-600">Threshold:</span> ${escapeHtml(r.criteria || "—")}</div>
          ${clientLogic ? `<div class="text-[11px] text-slate-600 mt-1 leading-snug bg-slate-50 rounded-md px-2 py-1.5 ring-1 ring-slate-100">${escapeHtml(clientLogic)}</div>` : ""}
        </div>
      </div>
    `;
  };

  return `
    <div class="relative bg-gradient-to-br ${grad} p-6 text-white">
      <button id="modal-close" class="absolute top-3 right-3 text-white/80 hover:text-white text-2xl leading-none w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">×</button>
      <div class="text-xs font-semibold uppercase tracking-wider opacity-90">Client framework</div>
      <h2 class="text-2xl font-bold mt-1">How the ${escapeHtml(cfgTab.label)} Tab Is Scored</h2>
      <p class="text-sm opacity-90 mt-1">${rules.length} rules across ${Object.keys(grouped).length} categories · max ${totalMax} pts · scored verbatim from the client's SPIP framework.</p>
    </div>
    <div class="p-6 max-h-[calc(90vh-180px)] overflow-y-auto">
      ${Object.entries(grouped).map(([cat, rs]) => {
        const catMax = rs.reduce((s, r) => { try { return s + (r.fn ? (r.fn({}).max || 0) : 0); } catch { return s; } }, 0);
        return `
          <div class="mb-5">
            <div class="flex items-baseline justify-between mb-2">
              <h3 class="text-xs font-bold uppercase tracking-wider text-slate-500">${escapeHtml(cat)}</h3>
              <span class="text-[10px] text-slate-400 font-mono">${rs.length} rules · ${catMax} pts</span>
            </div>
            <div class="bg-slate-50 rounded-xl px-4 py-1 ring-1 ring-slate-200">
              ${rs.map(ruleRow).join("")}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function openHelpModal() {
  openModal(buildHelpModal(state.activeTab));
  $("#modal-close")?.addEventListener("click", closeModal);
  $("#modal-overlay").addEventListener("click", (e) => {
    if (e.target.id === "modal-overlay") closeModal();
  }, { once: true });
}

// ---------------- Excel export (active tab) ----------------
async function exportToExcel() {
  const c = cfg(); const st = tabState();
  if (!st || !st.scored) return;

  let effCfg = c, effScored = st.scored, effRuleMeta = RULE_META;

  // Composite tab has cfg.rules=[] (it scores pillars, not rules), so the
  // Excel framework / distribution / ranked sheets came out empty. For
  // the export, synthesise an effective config that aggregates every rule
  // from all 4 pillars, plus merged per-company breakdowns drawn from
  // s.company._composite.pillarResults — so the workbook shows every rule
  // for every company with their actual values.
  if (state.activeTab === "composite") {
    const pillarSpecs = [
      { tag: "fundamentals", rules: fund.ACTIVE_RULES,   prKey: "fund"   },
      { tag: "technicals",   rules: tech.ACTIVE_RULES,   prKey: "tech"   },
      { tag: "macro",        rules: macro.ACTIVE_RULES,  prKey: "macro"  },
      { tag: "sentiment",    rules: senliq.ACTIVE_RULES, prKey: "senliq" },
    ];
    const allRules = [];
    for (const p of pillarSpecs) {
      for (const r of p.rules) allRules.push({ ...r, _pillar: p.tag });
    }
    effCfg = { ...c, rules: allRules };
    effScored = st.scored.map((s) => {
      const pr = s.company?._composite?.pillarResults;
      let merged = [];
      if (pr) {
        for (const p of pillarSpecs) {
          const arr = pr[p.prKey]?.breakdown;
          if (Array.isArray(arr)) merged = merged.concat(arr);
        }
      }
      return { ...s, breakdown: merged };
    });
    // Flatten per-pillar rule metas under a "composite" key so the export's
    // lookup `ruleMeta[tab][ruleKey]` finds clientLogic for every rule.
    const compositeMeta = {};
    for (const p of pillarSpecs) {
      const m = RULE_META[p.tag] || {};
      for (const k of Object.keys(m)) compositeMeta[k] = m[k];
    }
    effRuleMeta = { ...RULE_META, composite: compositeMeta };
  }

  await exportToExcelNew({
    tab: state.activeTab,
    tabLabel: c.label,
    cfg: effCfg,
    scored: effScored,
    ruleMeta: effRuleMeta,
  });
}

// ---------------- global search (header typeahead) ----------------
// Universal search across the whole universe. Selecting a company
// opens the composite drill so every pillar's data (fundamentals,
// technicals, macro, sentiment, liquidity) appears in one modal —
// no tab-switching required. Composite cache lazy-loads on first
// focus if the user hasn't visited the SPIP basket yet.
const globalSearch = { matches: [], selectedIdx: -1, lastQuery: "" };

async function ensureCompositeForSearch() {
  if (state.cache.composite) return true;
  const results = $("#global-search-results");
  if (results) {
    results.innerHTML = `<div class="px-4 py-6 text-center text-sm text-slate-400">Loading universe…</div>`;
    results.classList.remove("hidden");
  }
  try {
    await loadTab("composite");
    return true;
  } catch (e) {
    if (results) results.innerHTML = `<div class="px-4 py-6 text-center text-sm text-rose-500">Couldn't load — try again</div>`;
    return false;
  }
}

function setupGlobalSearch() {
  const input = $("#global-search");
  const results = $("#global-search-results");
  if (!input || !results) return;

  // Use Mac key symbol if user is on Mac, else "Ctrl K"
  const kbd = $("#global-search-kbd");
  if (kbd && !/Mac|iPhone|iPad/.test(navigator.platform || "")) kbd.textContent = "Ctrl K";

  function closeDropdown() {
    results.classList.add("hidden");
    globalSearch.matches = [];
    globalSearch.selectedIdx = -1;
  }

  function renderRow(s, i) {
    const name = s.company?.Company || "—";
    const sector = s.company?.Sector || s.company?.["Broad Industry"] || "";
    const marketCap = s.company?.["Market Cap"] || "";
    const { color, initials } = avatarFor(name);
    const cls = composite.ratingClass(s.rating);
    const comp = s.composite != null ? s.composite.toFixed(1) : "—";
    const active = i === globalSearch.selectedIdx;
    return `
      <button data-search-idx="${i}" class="result-row w-full text-left flex items-center gap-3 px-3.5 py-2.5 border-b border-slate-100 last:border-b-0 transition-colors ${active ? "bg-indigo-50" : "hover:bg-slate-50"}">
        <div class="w-9 h-9 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center text-white font-bold text-xs flex-shrink-0">${initials}</div>
        <div class="min-w-0 flex-1">
          <div class="font-semibold text-slate-900 text-sm truncate">${escapeHtml(name)}</div>
          <div class="text-[11px] text-slate-500 truncate">${escapeHtml(sector)}${marketCap ? ` · ${escapeHtml(marketCap)}` : ""}</div>
        </div>
        <div class="text-right flex-shrink-0">
          <div class="text-base font-bold tabular-nums text-slate-900 leading-none">${comp}</div>
          <span class="inline-flex items-center mt-1 px-1.5 py-0 rounded text-[9px] font-bold uppercase tracking-wider ring-1 whitespace-nowrap ${cls}">${escapeHtml(s.rating || "—")}</span>
        </div>
      </button>
    `;
  }

  function repaint() {
    if (globalSearch.matches.length === 0) {
      results.innerHTML = `<div class="px-4 py-6 text-center text-sm text-slate-400">No companies found</div>`;
    } else {
      results.innerHTML =
        `<div class="px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-50/70 border-b border-slate-100">${globalSearch.matches.length} match${globalSearch.matches.length === 1 ? "" : "es"} · ↑↓ navigate · ↵ open</div>` +
        globalSearch.matches.map((s, i) => renderRow(s, i)).join("");
      results.querySelectorAll(".result-row").forEach((el) => {
        el.addEventListener("click", () => openSearchResult(Number(el.dataset.searchIdx)));
        el.addEventListener("mouseenter", () => {
          globalSearch.selectedIdx = Number(el.dataset.searchIdx);
          highlightSelected();
        });
      });
    }
    results.classList.remove("hidden");
  }

  function highlightSelected() {
    results.querySelectorAll(".result-row").forEach((el, i) => {
      const active = i === globalSearch.selectedIdx;
      el.classList.toggle("bg-indigo-50", active);
      el.classList.toggle("hover:bg-slate-50", !active);
      if (active) el.scrollIntoView({ block: "nearest" });
    });
  }

  function openSearchResult(idx) {
    const match = globalSearch.matches[idx];
    if (!match) return;
    closeDropdown();
    input.blur();
    input.value = "";
    openCompositeDrill(match);
  }

  async function update(q) {
    q = q.trim().toLowerCase();
    if (q.length < 1) { closeDropdown(); globalSearch.lastQuery = ""; return; }
    if (q === globalSearch.lastQuery) return;
    globalSearch.lastQuery = q;
    const ok = await ensureCompositeForSearch();
    if (!ok) return;
    const scored = state.cache.composite?.scored || [];
    // Rank: name starts-with first, then contains. Hide hard-failed at
    // the bottom but still surface them — analyst may want to inspect.
    const startsWith = [];
    const contains = [];
    for (const s of scored) {
      const n = (s.company?.Company || "").toLowerCase();
      if (!n) continue;
      if (n.startsWith(q)) startsWith.push(s);
      else if (n.includes(q)) contains.push(s);
    }
    globalSearch.matches = [...startsWith, ...contains].slice(0, 10);
    globalSearch.selectedIdx = globalSearch.matches.length > 0 ? 0 : -1;
    repaint();
  }

  let debounce;
  input.addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => update(e.target.value), 80);
  });
  input.addEventListener("focus", () => {
    if (input.value.trim().length >= 1) update(input.value);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeDropdown(); input.blur(); }
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (globalSearch.matches.length > 0) {
        globalSearch.selectedIdx = (globalSearch.selectedIdx + 1) % globalSearch.matches.length;
        highlightSelected();
      }
    }
    else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (globalSearch.matches.length > 0) {
        globalSearch.selectedIdx = (globalSearch.selectedIdx - 1 + globalSearch.matches.length) % globalSearch.matches.length;
        highlightSelected();
      }
    }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (globalSearch.selectedIdx >= 0) openSearchResult(globalSearch.selectedIdx);
    }
  });

  // Click outside closes the dropdown
  document.addEventListener("click", (e) => {
    if (!input.contains(e.target) && !results.contains(e.target)) closeDropdown();
  });

  // ⌘K / Ctrl+K focuses search from anywhere on the page
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}

// ---------------- wiring ----------------
function wire() {
  $$(".tab-btn").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  $("#search").addEventListener("input", (e) => { state.search = e.target.value; applyFilters(); });
  $("#score-filter").addEventListener("change", (e) => { state.scoreFilter = e.target.value; applyFilters(); });
  // Watchlist toggle — click toggles "show only watchlisted" mode
  const watchBtn = $("#watch-toggle");
  if (watchBtn) watchBtn.addEventListener("click", () => {
    state.watchOnly = !state.watchOnly;
    updateWatchCount();
    applyFilters();
  });
  updateWatchCount();
  $("#export-btn").addEventListener("click", exportToExcel);
  $("#drill-overlay").addEventListener("click", closeDrillDown);
  $("#help-btn")?.addEventListener("click", openHelpModal);
  $("#sources-btn")?.addEventListener("click", openSourcesModal);
  setupGlobalSearch();
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrillDown(); });
}

wire();
switchTab("fundamentals");
