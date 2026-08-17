#!/usr/bin/env node
// First-15-minute-MIDPOINT entry capture for the AI top-7. The client's rule
// (from Aug 2026, applied to all baskets):
//   AI entry = MIDPOINT of the first 15-minute candle (09:15-09:30 IST) on the
//              basket's start day = (high + low) / 2.
// Manual (client) picks do NOT need a capture — their tracked entry is the
// report's given range high (entry_high), read straight from picksByMonth by
// the dashboard. So this script captures ONLY the AI top-7 (highest composite
// among dataComplete && !hardFailed from that morning's snapshot) and writes the
// midpoints into lkp-manual-picks.json under entryByMonth[month]; the dashboard
// anchors the AI basket on them (falling back to the start-day close if absent).
//
// Usage:
//   node scrape-first15-high.mjs                 # auto: any month whose anchor == today (IST), missing entries only
//   node scrape-first15-high.mjs --month 2026-08 # force a month
//   node scrape-first15-high.mjs --anchor 2026-08-07  # override the capture date (testing)
//   node scrape-first15-high.mjs --dry           # print, don't write

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PICKS_PATH = resolve(__dirname, "../public/data/lkp-manual-picks.json");
const SNAP_DIR = resolve(__dirname, "../public/data/snapshots");
const IST_OFFSET = 19800; // +5:30 in seconds

const args = process.argv.slice(2);
const getArg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry");
const forceMonth = getArg("--month");
const forceAnchor = getArg("--anchor");

// Today's date in IST (the scheduled run fires ~09:35 IST).
function istToday() {
  const nowMs = Number(getArg("--now")) || Date.now();
  return new Date(nowMs + IST_OFFSET * 1000).toISOString().slice(0, 10);
}

run().catch((e) => { console.error("Fatal:", e.stack || e.message); process.exit(1); });

async function run() {
  const picks = JSON.parse(readFileSync(PICKS_PATH, "utf8"));
  const anchorByMonth = picks.anchorByMonth || {};
  picks.entryByMonth = picks.entryByMonth || {};

  // Which month are we capturing? Explicit --month, else the month whose
  // anchor date is today (IST) and whose entry map still has gaps.
  const today = istToday();
  let month = forceMonth;
  const anchor = forceAnchor || (month ? anchorByMonth[month] : null) || null;
  if (!month) {
    month = Object.keys(anchorByMonth).find((m) => anchorByMonth[m] === today) || null;
  }
  if (!month) { console.log(`No basket starts today (${today}); nothing to capture.`); return; }
  const anchorDate = forceAnchor || anchorByMonth[month];
  if (!anchorDate) { console.log(`No anchor date for ${month}; skipping.`); return; }

  // AI top-7 from the anchor-day snapshot (same selection the passive basket
  // uses). Manual picks are NOT captured — they use the report's entry_high.
  const aiTickers = readAiTop7(anchorDate);

  const wanted = [...new Set(aiTickers)];
  const existing = picks.entryByMonth[month] || {};
  const todo = wanted.filter((t) => existing[t] == null);
  console.log(`Month ${month} · anchor ${anchorDate}`);
  console.log(`  AI top-7: ${aiTickers.join(", ") || "(snapshot not found yet)"}`);
  console.log(`  to capture (midpoints): ${todo.length}${todo.length ? "" : " (all present)"}`);
  if (!todo.length) return;

  const out = { ...existing };
  for (const t of todo) {
    process.stdout.write(`  ${t}... `);
    try {
      const mid = await first15Mid(`${t}.NS`, anchorDate);
      if (mid == null) { console.log("no bar yet"); continue; }
      out[t] = mid;
      console.log(mid);
    } catch (e) { console.log(`FAILED: ${e.message}`); }
  }

  picks.entryByMonth[month] = out;
  const captured = Object.keys(out).length;
  const complete = wanted.every((t) => out[t] != null);
  console.log(`\nCaptured ${captured}/${wanted.length}${complete ? " — complete" : " — partial (rerun to fill the rest)"}`);

  if (DRY) { console.log("[dry run — not writing]"); return; }
  writeFileSync(PICKS_PATH, JSON.stringify(picks, null, 2) + "\n");
  console.log(`Wrote ${PICKS_PATH}`);
}

// Top-7 tickers by composite from a day's snapshot (dataComplete, not hard-failed).
function readAiTop7(dateStr) {
  const p = resolve(SNAP_DIR, `${dateStr}.json`);
  if (!existsSync(p)) return [];
  const snap = JSON.parse(readFileSync(p, "utf8"));
  return (snap.stocks || [])
    .filter((s) => s.ticker && typeof s.composite === "number" && s.dataComplete && !s.hardFailed)
    .sort((a, b) => b.composite - a.composite)
    .slice(0, 7)
    .map((s) => s.ticker);
}

// Midpoint (high+low)/2 of the FIRST 15-min candle (09:15-09:30 IST) on dateStr.
async function first15Mid(symbol, dateStr) {
  const dayStartUTC = Math.floor(Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10)) / 1000) - IST_OFFSET;
  const period1 = dayStartUTC - 2 * 86400, period2 = dayStartUTC + 2 * 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=15m`;
  const headers = { "User-Agent": "Mozilla/5.0 (compatible; KLPDashboardBot/1.0)" };
  let attempt = 0, lastErr;
  while (attempt < 3) {
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      const ts = res?.timestamp || [], q = res?.indicators?.quote?.[0] || {};
      const highs = q.high || [], lows = q.low || [];
      // First bar whose IST date matches dateStr = the 09:15 candle.
      let best = null;
      for (let i = 0; i < ts.length; i++) {
        if (highs[i] == null || lows[i] == null) continue;
        const istDate = new Date((ts[i] + IST_OFFSET) * 1000).toISOString().slice(0, 10);
        if (istDate !== dateStr) continue;
        if (best == null || ts[i] < best.ts) best = { ts: ts[i], high: highs[i], low: lows[i] };
      }
      return best ? Number((((best.high + best.low) / 2)).toFixed(2)) : null;
    } catch (e) { lastErr = e; attempt++; await new Promise((r) => setTimeout(r, 800 * attempt)); }
  }
  throw lastErr || new Error("fetch failed");
}
