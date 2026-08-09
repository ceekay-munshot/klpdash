#!/usr/bin/env node
// First-15-minute-high entry capture. From August 2026 the client's rule is:
// a basket's entry price for each stock is the HIGH of its first 15-minute
// candle (09:15-09:30 IST) on the basket's start day — the SAME rule applied to
// the AI top-7 — so the two baskets compare like-to-like. This script captures
// those highs on the start morning and writes them into lkp-manual-picks.json
// under entryByMonth[month]; the dashboard then anchors both baskets on them
// (falling back to the start-day close when an override is absent).
//
// Which stocks: the month's in-coverage manual picks + the AI top-7 (highest
// composite among dataComplete && !hardFailed) from that day's snapshot.
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

  const monthPicks = (picks.picksByMonth?.[month] || []).filter((p) => p.ticker && p.in_universe !== false);
  const manualTickers = monthPicks.map((p) => p.ticker);

  // AI top-7 from the anchor-day snapshot (same selection the passive basket uses).
  const aiTickers = readAiTop7(anchorDate);

  const wanted = [...new Set([...manualTickers, ...aiTickers])];
  const existing = picks.entryByMonth[month] || {};
  const todo = wanted.filter((t) => existing[t] == null);
  console.log(`Month ${month} · anchor ${anchorDate}`);
  console.log(`  manual (${manualTickers.length}): ${manualTickers.join(", ")}`);
  console.log(`  AI top-7: ${aiTickers.join(", ") || "(snapshot not found yet)"}`);
  console.log(`  to capture: ${todo.length}${todo.length ? "" : " (all present)"}`);
  if (!todo.length) return;

  const out = { ...existing };
  for (const t of todo) {
    process.stdout.write(`  ${t}... `);
    try {
      const high = await first15High(`${t}.NS`, anchorDate);
      if (high == null) { console.log("no bar yet"); continue; }
      out[t] = high;
      console.log(high);
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

// High of the FIRST 15-min candle (09:15-09:30 IST) on dateStr, from Yahoo.
async function first15High(symbol, dateStr) {
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
      const ts = res?.timestamp || [], highs = res?.indicators?.quote?.[0]?.high || [];
      // First bar whose IST date matches dateStr = the 09:15 candle.
      let best = null;
      for (let i = 0; i < ts.length; i++) {
        if (highs[i] == null) continue;
        const istDate = new Date((ts[i] + IST_OFFSET) * 1000).toISOString().slice(0, 10);
        if (istDate !== dateStr) continue;
        if (best == null || ts[i] < best.ts) best = { ts: ts[i], high: highs[i] };
      }
      return best ? Number(best.high.toFixed(2)) : null;
    } catch (e) { lastErr = e; attempt++; await new Promise((r) => setTimeout(r, 800 * attempt)); }
  }
  throw lastErr || new Error("fetch failed");
}
