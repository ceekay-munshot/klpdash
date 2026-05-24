import * as fund from "./scoring.js";
import * as tech from "./tech-scoring.js";

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
      rules: "17 / 19",   rulesNote: "Active rules",
      maxScore: "25 pts", maxNote: "After deferred: 29 pts",
    },
    drillHeaderStats: (c) => [
      { label: "Market Cap", main: c["Market Cap"] || "—", sub: `CMP ${c["Current Price"] || "—"}` },
      { label: "P/E · D/E",  main: `${c["Stock P/E"] || "—"} · ${c["Debt to equity"] || "—"}`, sub: `ROCE ${c["ROCE"] || "—"}` },
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
      rules: "13 / 16",   rulesNote: "Active rules",
      maxScore: "20 pts", maxNote: "After deferred: 24 pts",
    },
    drillHeaderStats: (c) => [
      { label: "CMP · 52W High", main: c.cmp ? "₹" + Math.round(c.cmp).toLocaleString("en-IN") : "—",
        sub: c.high_52w ? `52W ₹${Math.round(c.high_52w).toLocaleString("en-IN")}` : "" },
      { label: "RSI · ADX · Beta", main: `${c.rsi14 ?? "—"} · ${c.adx14 ?? "—"} · ${c.beta_1y ?? "—"}`,
        sub: c.relative_strength_6m == null ? "" : `RS 6M ${(c.relative_strength_6m * 100).toFixed(1)}%` },
    ],
  },
};

// ---------------- State ----------------
const state = {
  activeTab: "fundamentals",
  cache: {},                  // tab → { scored, raw, meta, filtered }
  search: "",
  scoreFilter: "all",
  sortBy: "score",
  sortDir: "desc",
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
function cfg() { return CONFIGS[state.activeTab]; }
function tabState() { return state.cache[state.activeTab]; }

// ---------------- load / switch tab ----------------
async function switchTab(tabId) {
  if (!CONFIGS[tabId]) return;
  // toggle nav
  $$(".tab-btn").forEach((b) => {
    const active = b.dataset.tab === tabId;
    b.classList.toggle("text-indigo-600", active);
    b.classList.toggle("border-indigo-600", active);
    b.classList.toggle("text-slate-500", !active);
    b.classList.toggle("hover:text-slate-700", !active);
  });
  state.activeTab = tabId;
  state.search = "";
  state.scoreFilter = "all";
  state.sortBy = "score";
  state.sortDir = "desc";
  $("#search").value = "";
  $("#score-filter").value = "all";

  if (!state.cache[tabId]) await loadTab(tabId);
  renderAll();
}

async function loadTab(tabId) {
  const c = CONFIGS[tabId];
  const [rawData, rawMeta] = await Promise.all([
    fetch(c.dataUrl).then((r) => r.json()),
    c.metaUrl ? fetch(c.metaUrl).then((r) => r.json()) : Promise.resolve(null),
  ]);
  const parsed = c.parseData(rawData);
  const rows = parsed.rows || parsed;
  const meta = parsed.meta || rawMeta || rawData;

  // Fundamentals tab: merge insider-trades.json onto each row by NSE ticker
  // (extracted from Screener URL slug). If insider data is missing or empty,
  // ruleInsiderBuying degrades to a clear N/A explanation.
  if (tabId === "fundamentals") {
    try {
      const insider = await fetch("data/insider-trades.json").then((r) => r.json());
      const byTicker = insider?.companies || {};
      const insiderLoaded = Object.keys(byTicker).length > 0;
      for (const row of rows) {
        const m = String(row["Screener URL"] || "").match(/\/company\/([^/]+)/);
        const ticker = m ? m[1].toUpperCase() : null;
        const data = ticker ? byTicker[ticker] : null;
        row.insider_loaded = insiderLoaded;
        if (data) {
          row.insider_net_shares  = data.net_shares;
          row.insider_net_value   = data.net_value;
          row.insider_buy_shares  = data.buy_shares;
          row.insider_sell_shares = data.sell_shares;
          row.insider_transactions = data.transactions;
          row.insider_last_date   = data.last_date;
        } else {
          row.insider_transactions = 0;
        }
      }
    } catch { /* insider file missing — rule shows N/A with explanation */ }
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
  $("#meta-source").textContent = m?.source || (c.label + " · Yahoo Finance EOD");
}

function renderStats() {
  const c = cfg();
  $("#stat-rules").textContent = c.stats.rules;
  $("#stat-rules-note").textContent = c.stats.rulesNote;
  $("#stat-max").textContent = c.stats.maxScore;
  $("#stat-max-note").textContent = c.stats.maxNote;
  $("#deferred-count").textContent = c.deferred.length;
  $("#deferred-summary").textContent = `${c.deferred.length} parameter${c.deferred.length>1?"s":""} pending data source`;
  $("#top-cards-title").textContent = `Top 10 by ${c.label} Score`;
}

function renderDeferredList() {
  const c = cfg();
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

// ---------------- filtering / sorting ----------------
function applyFilters() {
  const c = cfg(); const st = tabState();
  const q = state.search.trim().toLowerCase();
  let rows = st.scored.filter((s) => {
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
    return `
      <tr data-idx="${i}" class="row-clickable border-b border-slate-100 cursor-pointer transition-colors ${flagged ? "bg-rose-50/40 hover:bg-rose-50" : "hover:bg-slate-50"}" ${flagged ? `style="box-shadow: inset 3px 0 0 #f43f5e"` : ""}>
        <td class="px-4 py-3 text-sm text-slate-500 font-medium">${rank}</td>
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
            <span class="inline-flex items-center px-2.5 py-1 rounded-lg text-sm font-bold ${scoreBadgeClass(s.scorePct)}">${s.totalPoints}/${s.totalMax}</span>
            ${flagged ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-rose-100 text-rose-700 ring-1 ring-rose-200" title="${escapeHtml(s.hardFails.join(", "))}">⚠ Red Flag</span>` : ""}
            ${s.tickerError ? `<span class="text-[10px] text-slate-400 italic" title="${escapeHtml(s.tickerError)}">no data</span>` : ""}
          </div>
        </td>
        <td class="px-4 py-3"><div class="flex items-center gap-1">${breakdownIcons}</div></td>
        ${c.columns.map((col) => `<td class="px-4 py-3 text-sm text-slate-700">${escapeHtml(col.get(s.company))}</td>`).join("")}
        <td class="px-4 py-3 text-right">
          <a href="${escapeHtml(c.screenerUrl(s.company) || "")}" target="_blank" rel="noopener" class="text-indigo-600 hover:text-indigo-800 text-sm font-medium" onclick="event.stopPropagation()">↗</a>
        </td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="${4 + c.columns.length + 2}" class="px-4 py-12 text-center text-slate-400">No companies match your filters.</td></tr>`;
  $$("#table-body .row-clickable").forEach((el) => el.addEventListener("click", () => openDrillDown(st.filtered[Number(el.dataset.idx)])));
}

// ---------------- drill-down ----------------
function openDrillDown(s) {
  if (!s) return;
  const c = cfg();
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
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `).join("");

  const deferredHtml = `
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
  `;

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
            <div class="text-base font-bold text-slate-900 truncate">${escapeHtml(hs.main)}</div>
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
function closeDrillDown() {
  $("#drill-panel").classList.add("translate-x-full");
  $("#drill-overlay").classList.add("hidden");
}

// ---------------- Excel export (active tab) ----------------
function exportToExcel() {
  const c = cfg(); const st = tabState();
  const wb = XLSX.utils.book_new();
  const rows = st.scored.map((s, i) => {
    const row = {
      Rank: i + 1,
      Company: c.name(s.company),
      "Screener URL": c.screenerUrl(s.company),
      "Score": s.totalPoints,
      "Max": s.totalMax,
      "Score %": s.scorePct,
      "Hard Fails": s.hardFails.join("; "),
      "N/A Count": s.naCount,
    };
    c.rules.forEach((r) => {
      const b = s.breakdown.find((x) => x.key === r.key);
      row[r.label] = !b || b.status === "na" ? "" : `${b.points}/${b.max} ${b.status}`;
    });
    return row;
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Scored");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(st.rows), "Raw Data");
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `klp-${state.activeTab}-${today}.xlsx`);
}

// ---------------- wiring ----------------
function wire() {
  $$(".tab-btn").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  $("#search").addEventListener("input", (e) => { state.search = e.target.value; applyFilters(); });
  $("#score-filter").addEventListener("change", (e) => { state.scoreFilter = e.target.value; applyFilters(); });
  $("#export-btn").addEventListener("click", exportToExcel);
  $("#drill-overlay").addEventListener("click", closeDrillDown);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrillDown(); });
}

wire();
switchTab("fundamentals");
