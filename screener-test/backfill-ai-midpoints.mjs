#!/usr/bin/env node
// One-off backfill: recompute the AI top-7 entry overrides under the client's
// (Aug 2026, applied to ALL baskets) rule:
//
//   AI entry = MIDPOINT of the first 15-minute candle (09:15-09:30 IST) on the
//              basket's start day = (first15High + first15Low) / 2.
//
// (Manual entries no longer live here — they default to the report's entry_high
// and are read straight from picksByMonth by the dashboard.)
//
// entryByMonth[month] is rewritten to hold ONLY the month's AI top-7 midpoints.
// Where the 15-min candle is no longer retrievable from Yahoo (~60-day intraday
// window — e.g. the June basket), we fall back to that day's DAILY high/low
// midpoint as a proxy and record the month under entryBasis.aiProxyMonths.
//
// Usage:
//   node backfill-ai-midpoints.mjs         # write
//   node backfill-ai-midpoints.mjs --dry   # print only

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PICKS_PATH = resolve(__dirname, "../public/data/lkp-manual-picks.json");
const SNAP_DIR = resolve(__dirname, "../public/data/snapshots");
const IST_OFFSET = 19800; // +5:30 in seconds
const DRY = process.argv.includes("--dry");

run().catch((e) => { console.error("Fatal:", e.stack || e.message); process.exit(1); });

async function run() {
  const picks = JSON.parse(readFileSync(PICKS_PATH, "utf8"));
  const anchorByMonth = picks.anchorByMonth || {};
  const entryByMonth = {};
  const proxyMonths = [];

  for (const month of Object.keys(anchorByMonth).sort()) {
    const anchor = anchorByMonth[month];
    const top7 = readAiTop7(anchor);
    console.log(`\n=== ${month} · anchor ${anchor} · AI top-7: ${top7.join(", ") || "(none)"} ===`);
    const map = {};
    let usedProxy = false;
    for (const ticker of top7) {
      process.stdout.write(`  ${ticker} ... `);
      try {
        let mid = await first15Mid(`${ticker}.NS`, anchor);
        if (mid == null) {
          const dm = await dailyMid(`${ticker}.NS`, anchor);
          if (dm == null) { console.log("NO DATA (skipped -> app falls back to close)"); continue; }
          mid = dm; usedProxy = true;
          console.log(`${mid}  [daily-midpoint proxy]`);
        } else {
          console.log(`${mid}`);
        }
        map[ticker] = mid;
      } catch (e) { console.log(`FAIL ${e.message}`); }
    }
    entryByMonth[month] = map;
    if (usedProxy) proxyMonths.push(month);
  }

  picks.entryByMonth = entryByMonth;
  picks.entryBasis = {
    manual: "Report entry_high (upper bound of the client's given buy range), always — even if price never traded up to it that day.",
    ai: "Midpoint of the first 15-minute candle (09:15-30 IST) on the basket start day = (high+low)/2.",
    aiProxyMonths: proxyMonths,
    aiProxyNote: "Months listed used that day's DAILY high/low midpoint because the 15-minute intraday candle is past Yahoo's ~60-day window.",
  };

  console.log(`\nentryByMonth rewritten (AI-only midpoints). Proxy months: ${proxyMonths.join(", ") || "none"}`);
  if (DRY) { console.log("[dry run — not writing]"); return; }
  writeFileSync(PICKS_PATH, JSON.stringify(picks, null, 2) + "\n");
  console.log(`Wrote ${PICKS_PATH}`);
}

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

async function fetchJson(url) {
  let attempt = 0, lastErr;
  while (attempt < 3) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; KLPDashboardBot/1.0)" } });
      if (r.status === 422) return null; // out of intraday window
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { lastErr = e; attempt++; await new Promise((r) => setTimeout(r, 800 * attempt)); }
  }
  throw lastErr || new Error("fetch failed");
}

// (high+low)/2 of the FIRST 15-min candle on dateStr, or null if unavailable.
async function first15Mid(symbol, dateStr) {
  const dayStartUTC = Math.floor(Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10)) / 1000) - IST_OFFSET;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${dayStartUTC - 2 * 86400}&period2=${dayStartUTC + 2 * 86400}&interval=15m`;
  const j = await fetchJson(url);
  const res = j?.chart?.result?.[0];
  if (!res) return null;
  const ts = res.timestamp || [], q = res.indicators?.quote?.[0] || {};
  const highs = q.high || [], lows = q.low || [];
  let best = null;
  for (let i = 0; i < ts.length; i++) {
    if (highs[i] == null || lows[i] == null) continue;
    const istDate = new Date((ts[i] + IST_OFFSET) * 1000).toISOString().slice(0, 10);
    if (istDate !== dateStr) continue;
    if (best == null || ts[i] < best.ts) best = { ts: ts[i], high: highs[i], low: lows[i] };
  }
  return best ? +(((best.high + best.low) / 2)).toFixed(2) : null;
}

// (high+low)/2 of the DAILY candle on dateStr — proxy when intraday is gone.
async function dailyMid(symbol, dateStr) {
  const dayStartUTC = Math.floor(Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10)) / 1000) - IST_OFFSET;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${dayStartUTC - 4 * 86400}&period2=${dayStartUTC + 4 * 86400}&interval=1d`;
  const j = await fetchJson(url);
  const res = j?.chart?.result?.[0];
  if (!res) return null;
  const ts = res.timestamp || [], q = res.indicators?.quote?.[0] || {};
  const highs = q.high || [], lows = q.low || [];
  for (let i = 0; i < ts.length; i++) {
    if (highs[i] == null || lows[i] == null) continue;
    const istDate = new Date((ts[i] + IST_OFFSET) * 1000).toISOString().slice(0, 10);
    if (istDate === dateStr) return +(((highs[i] + lows[i]) / 2)).toFixed(2);
  }
  return null;
}
