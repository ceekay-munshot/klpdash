import { scoreCompany, ACTIVE_RULES, DEFERRED } from "./scoring.js";

const state = {
  rows: [],
  scored: [],
  filtered: [],
  search: "",
  scoreFilter: "all", // all | excellent | good | average | weak | hardfail
  sortBy: "score",
  sortDir: "desc",
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ----- color + initial helpers -----
const PALETTE = [
  "from-purple-500 to-indigo-500", "from-pink-500 to-rose-500", "from-amber-500 to-orange-500",
  "from-emerald-500 to-teal-500", "from-blue-500 to-cyan-500", "from-fuchsia-500 to-pink-500",
  "from-violet-500 to-purple-500", "from-lime-500 to-emerald-500", "from-sky-500 to-indigo-500",
  "from-red-500 to-pink-500", "from-yellow-500 to-amber-500", "from-teal-500 to-cyan-500",
];
function avatarFor(name) {
  let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const color = PALETTE[h % PALETTE.length];
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase().slice(0, 2);
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
function tierLabel(tier) {
  return ({ excellent: "Excellent", good: "Good", average: "Average", weak: "Weak", hardfail: "Hard Fail" })[tier];
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

// ----- load data -----
async function load() {
  const [rows, meta] = await Promise.all([
    fetch("data/screener-companies.json").then((r) => r.json()),
    fetch("data/metadata.json").then((r) => r.json()),
  ]);
  state.rows = rows;
  state.scored = rows.map(scoreCompany).sort((a, b) => b.totalPoints - a.totalPoints);
  state.filtered = state.scored;

  $("#meta-updated").textContent = new Date(meta.generated_at).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
  });
  $("#meta-count").textContent = `${rows.length} companies`;
  $("#meta-source").textContent = meta.source;
  $("#deferred-count").textContent = DEFERRED.length;

  renderDeferredList();
  renderTopCards();
  applyFilters();
}

// ----- top 10 cards -----
function renderTopCards() {
  const top = state.scored.slice(0, 10);
  const html = top.map((s, i) => {
    const { color, initials } = avatarFor(s.company.Company);
    const tier = s.hardFails.length ? "hardfail" : scoreTier(s.scorePct);
    const tierColor = ({
      excellent: "text-emerald-600", good: "text-blue-600",
      average: "text-amber-600", weak: "text-rose-600", hardfail: "text-rose-700",
    })[tier];
    return `
      <button data-idx="${i}" class="top-card group text-left bg-white hover:shadow-xl hover:-translate-y-1 transition-all duration-200 rounded-2xl p-4 shadow-sm ring-1 ring-slate-100 relative overflow-hidden">
        <div class="absolute top-3 right-3 text-xs font-bold text-slate-400">#${i + 1}</div>
        <div class="flex items-center gap-3 mb-3">
          <div class="w-11 h-11 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white font-bold text-sm shadow-md">
            ${initials}
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-semibold text-slate-900 truncate text-sm">${escapeHtml(s.company.Company)}</div>
            <div class="text-xs text-slate-500">${escapeHtml(s.company["Market Cap"] || "")}</div>
          </div>
        </div>
        <div class="flex items-end justify-between">
          <div>
            <div class="text-3xl font-bold ${tierColor}">${s.totalPoints}<span class="text-base text-slate-400">/${s.totalMax}</span></div>
            <div class="text-xs text-slate-500 mt-0.5">${tierLabel(tier)}</div>
          </div>
          ${s.hardFails.length ? `<div class="text-rose-500 text-xl" title="Hard fail flag">⚠</div>` : ""}
        </div>
      </button>
    `;
  }).join("");
  $("#top-cards").innerHTML = html;
  $$("#top-cards .top-card").forEach((el) => el.addEventListener("click", () => openDrillDown(top[Number(el.dataset.idx)])));
}

// ----- deferred (missing) panel -----
function renderDeferredList() {
  const html = DEFERRED.map((d) => `
    <div class="flex items-start gap-3 p-3 rounded-lg bg-amber-50 ring-1 ring-amber-100">
      <div class="text-amber-500 text-lg leading-none">⚠</div>
      <div class="flex-1">
        <div class="font-semibold text-slate-900 text-sm">${d.label} <span class="text-xs font-normal text-slate-500">· ${d.category} · max ${d.max} pts</span></div>
        <div class="text-xs text-slate-600 mt-0.5">${d.reason}</div>
      </div>
    </div>
  `).join("");
  $("#deferred-list").innerHTML = html;
}

// ----- main table -----
function applyFilters() {
  const q = state.search.trim().toLowerCase();
  let rows = state.scored.filter((s) => {
    if (q && !s.company.Company.toLowerCase().includes(q)) return false;
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
    else if (state.sortBy === "name") { av = a.company.Company.toLowerCase(); bv = b.company.Company.toLowerCase(); }
    else if (state.sortBy === "mcap") { av = parseFloat(String(a.company["Market Cap"]).replace(/[^\d.]/g, "")) || 0; bv = parseFloat(String(b.company["Market Cap"]).replace(/[^\d.]/g, "")) || 0; }
    if (av < bv) return -1 * dir; if (av > bv) return 1 * dir; return 0;
  });
  state.filtered = rows;
  renderTable();
}

function renderTable() {
  const rows = state.filtered;
  $("#row-count").textContent = `${rows.length} of ${state.scored.length}`;
  const html = rows.map((s, i) => {
    const { color, initials } = avatarFor(s.company.Company);
    const tier = s.hardFails.length ? "hardfail" : scoreTier(s.scorePct);
    const rank = state.scored.indexOf(s) + 1;
    const breakdownIcons = s.breakdown.slice(0, 8).map((b) => {
      const dot = ({
        pass: "bg-emerald-500", partial: "bg-amber-400", fail: "bg-rose-400",
        hard_fail: "bg-rose-600", na: "bg-slate-300",
      })[b.status];
      return `<span class="w-1.5 h-1.5 rounded-full ${dot}" title="${escapeHtml(b.label)}: ${b.status}"></span>`;
    }).join("");
    return `
      <tr data-idx="${i}" class="row-clickable border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors">
        <td class="px-4 py-3 text-sm text-slate-500 font-medium">${rank}</td>
        <td class="px-4 py-3">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-gradient-to-br ${color} flex items-center justify-center text-white text-xs font-bold shadow-sm flex-shrink-0">${initials}</div>
            <div class="min-w-0">
              <div class="font-semibold text-slate-900 truncate">${escapeHtml(s.company.Company)}</div>
              <div class="text-xs text-slate-500 truncate">${escapeHtml(s.company["Market Cap"] || "")}</div>
            </div>
          </div>
        </td>
        <td class="px-4 py-3">
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center px-2.5 py-1 rounded-lg text-sm font-bold ${scoreBadgeClass(s.scorePct)}">${s.totalPoints}/${s.totalMax}</span>
            ${s.hardFails.length ? `<span class="text-rose-500 text-base" title="Hard fail: ${escapeHtml(s.hardFails.join(", "))}">⚠</span>` : ""}
            ${s.naCount ? `<span class="text-amber-500 text-sm" title="${s.naCount} parameter(s) had no data">⊘</span>` : ""}
          </div>
        </td>
        <td class="px-4 py-3"><div class="flex items-center gap-1">${breakdownIcons}</div></td>
        <td class="px-4 py-3 text-sm text-slate-700 font-medium">${escapeHtml(s.company.ROE || "—")}</td>
        <td class="px-4 py-3 text-sm text-slate-700 font-medium">${escapeHtml(s.company.ROCE || "—")}</td>
        <td class="px-4 py-3 text-sm text-slate-700">${escapeHtml(s.company["Sales growth 3Years"] || "—")}</td>
        <td class="px-4 py-3 text-sm text-slate-700">${escapeHtml(s.company["Profit Var 3Yrs"] || "—")}</td>
        <td class="px-4 py-3 text-sm text-slate-700">${escapeHtml(s.company["Debt to equity"] || "—")}</td>
        <td class="px-4 py-3 text-sm text-slate-700">${escapeHtml(s.company["Stock P/E"] || "—")}</td>
        <td class="px-4 py-3 text-right">
          <a href="${escapeHtml(s.company["Screener URL"])}" target="_blank" rel="noopener" class="text-indigo-600 hover:text-indigo-800 text-sm font-medium" onclick="event.stopPropagation()">↗</a>
        </td>
      </tr>
    `;
  }).join("");
  $("#table-body").innerHTML = html || `<tr><td colspan="11" class="px-4 py-12 text-center text-slate-400">No companies match your filters.</td></tr>`;
  $$("#table-body .row-clickable").forEach((el) => el.addEventListener("click", () => openDrillDown(state.filtered[Number(el.dataset.idx)])));
}

// ----- drill-down panel -----
function openDrillDown(s) {
  if (!s) return;
  const { color, initials } = avatarFor(s.company.Company);
  const c = s.company;
  const grouped = ACTIVE_RULES.reduce((acc, r) => { (acc[r.category] ||= []).push(r); return acc; }, {});
  const byKey = Object.fromEntries(s.breakdown.map((b) => [b.key, b]));

  const breakdownHtml = Object.entries(grouped).map(([cat, rules]) => `
    <div class="mb-5">
      <div class="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">${cat}</div>
      <div class="space-y-2">
        ${rules.map((r) => {
          const b = byKey[r.key];
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
        ${DEFERRED.map((d) => `
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
  const tierColor = ({ excellent: "text-emerald-600", good: "text-blue-600", average: "text-amber-600", weak: "text-rose-600", hardfail: "text-rose-700" })[tier];

  $("#drill-content").innerHTML = `
    <div class="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-slate-100 p-5 z-10">
      <button id="drill-close" class="absolute top-4 right-4 text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
      <div class="flex items-center gap-4 pr-8">
        <div class="w-14 h-14 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center text-white font-bold text-lg shadow-md">${initials}</div>
        <div class="flex-1 min-w-0">
          <div class="font-bold text-xl text-slate-900 truncate">${escapeHtml(c.Company)}</div>
          <a href="${escapeHtml(c["Screener URL"])}" target="_blank" rel="noopener" class="text-xs text-indigo-600 hover:text-indigo-800">View on Screener.in ↗</a>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-3 mt-4">
        <div class="bg-slate-50 rounded-lg p-3">
          <div class="text-xs text-slate-500 font-medium">Score</div>
          <div class="text-2xl font-bold ${tierColor}">${s.totalPoints}<span class="text-sm text-slate-400">/${s.totalMax}</span></div>
          <div class="text-xs text-slate-500">${tierLabel(tier)}</div>
        </div>
        <div class="bg-slate-50 rounded-lg p-3">
          <div class="text-xs text-slate-500 font-medium">Market Cap</div>
          <div class="text-base font-bold text-slate-900 truncate">${escapeHtml(c["Market Cap"] || "—")}</div>
          <div class="text-xs text-slate-500">CMP ${escapeHtml(c["Current Price"] || "—")}</div>
        </div>
        <div class="bg-slate-50 rounded-lg p-3">
          <div class="text-xs text-slate-500 font-medium">P/E · D/E</div>
          <div class="text-base font-bold text-slate-900">${escapeHtml(c["Stock P/E"] || "—")} · ${escapeHtml(c["Debt to equity"] || "—")}</div>
          <div class="text-xs text-slate-500">ROCE ${escapeHtml(c["ROCE"] || "—")}</div>
        </div>
      </div>
      ${s.hardFails.length ? `
        <div class="mt-3 p-3 bg-rose-50 rounded-lg ring-1 ring-rose-100">
          <div class="flex items-start gap-2">
            <div class="text-rose-500 text-lg leading-none">⚠</div>
            <div>
              <div class="font-semibold text-rose-800 text-sm">Hard fail flags</div>
              <div class="text-xs text-rose-700 mt-0.5">${escapeHtml(s.hardFails.join(", "))}</div>
            </div>
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

// ----- export to Excel -----
function exportToExcel() {
  const wb = XLSX.utils.book_new();
  // sheet 1: scored summary
  const rows = state.scored.map((s, i) => {
    const row = {
      Rank: i + 1,
      Company: s.company.Company,
      "Screener URL": s.company["Screener URL"],
      "Score": s.totalPoints,
      "Max": s.totalMax,
      "Score %": s.scorePct,
      "Hard Fails": s.hardFails.join("; "),
      "N/A Count": s.naCount,
    };
    ACTIVE_RULES.forEach((r) => {
      const b = s.breakdown.find((x) => x.key === r.key);
      row[r.label] = b.status === "na" ? "" : `${b.points}/${b.max} ${b.status}`;
    });
    return row;
  });
  const ws1 = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws1, "Scored");
  // sheet 2: raw
  const ws2 = XLSX.utils.json_to_sheet(state.rows);
  XLSX.utils.book_append_sheet(wb, ws2, "Raw Data");
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `klp-stock-screener-${today}.xlsx`);
}

// ----- utils -----
function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

// ----- wire events -----
function wire() {
  $("#search").addEventListener("input", (e) => { state.search = e.target.value; applyFilters(); });
  $("#score-filter").addEventListener("change", (e) => { state.scoreFilter = e.target.value; applyFilters(); });
  $("#export-btn").addEventListener("click", exportToExcel);
  $("#drill-overlay").addEventListener("click", closeDrillDown);
  $$("#table thead th[data-sort]").forEach((th) => th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (state.sortBy === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    else { state.sortBy = key; state.sortDir = "desc"; }
    applyFilters();
  }));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrillDown(); });
}

wire();
load();
