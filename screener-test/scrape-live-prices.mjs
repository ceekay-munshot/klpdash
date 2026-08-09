#!/usr/bin/env node
// Live intraday price feed for the manual (client) basket. Calls the
// Munshot quote API for each basket ticker and writes a compact
// public/data/live-prices.json the dashboard reads to:
//   - show the current (intraday) price instead of yesterday's close, and
//   - detect target / stop-loss TOUCHES using the day's high / low
//     (the client marks a target "hit" the moment price touches it
//     intraday, not only when it closes above — e.g. Paytm touched 1359
//     over Target 2 1350 but closed 1341.8).
//
// Munshot also covers the out-of-coverage names (BALRAMCHIN, JAMNAAUTO)
// that sit below our screener universe, so those get real live prices
// instead of the synthetic series we used before.
//
// Reads:  public/data/lkp-manual-picks.json  (basket tickers)
// Writes: public/data/live-prices.json
//
// Usage: node screener-test/scrape-live-prices.mjs [EXTRA,TICKERS]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = resolve(__dirname, "../public/data");
const PICKS     = resolve(DATA_DIR, "lkp-manual-picks.json");
const SNAP_DIR  = resolve(DATA_DIR, "snapshots");
const OUT_PATH  = resolve(DATA_DIR, "live-prices.json");
const API       = "https://fastapi.muns.io/stock-data";

run().catch((e) => { console.error("Fatal:", e.stack || e.message); process.exit(1); });

async function run() {
  // Basket tickers across every month + any explicitly-listed extras.
  const picks = JSON.parse(readFileSync(PICKS, "utf8"));
  const tickers = new Set();
  for (const monthPicks of Object.values(picks.picksByMonth || {})) {
    for (const p of monthPicks) {
      const t = (p.ticker || p.selection || "").trim().toUpperCase();
      if (t) tickers.add(t);
    }
  }
  const manualCount = tickers.size;

  // AI top-7 too, so BOTH baskets ride the same live feed (client ask: the AI
  // basket should show live prices exactly like the manual one). We add the
  // frozen top-7 from each tracked month's anchor snapshot — the same set the
  // dashboard's passive AI basket locks — plus today's top-7 as a hedge so the
  // current cohort is covered even before its own anchor snapshot lands.
  const aiTickers = collectAiTickers(picks);
  for (const t of aiTickers) tickers.add(t);

  for (const t of (process.argv[2] || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)) {
    tickers.add(t);
  }

  const list = [...tickers];
  console.log(`Fetching live quotes for ${list.length} tickers (${manualCount} manual + ${aiTickers.size} AI top-7, union): ${list.join(", ")}`);

  const prices = {};
  let ok = 0, fail = 0;
  for (const ticker of list) {
    const q = await fetchQuote(ticker);
    if (q) { prices[ticker] = q; ok++; process.stdout.write("."); }
    else   { fail++; process.stdout.write("x"); }
    await new Promise((r) => setTimeout(r, 200));
  }

  const payload = {
    generated_at: new Date().toISOString(),
    source: "Munshot quote API (fastapi.muns.io/stock-data)",
    note: "Live intraday snapshot per basket ticker. dayHigh/dayLow drive intraday target/SL touch detection; current is the latest traded price.",
    ticker_count: Object.keys(prices).length,
    prices,
  };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + "\n");
  console.log(`\nWrote ${OUT_PATH} — ${ok} ok, ${fail} failed.`);
}

// Top-7 tickers by composite from a day's snapshot — the exact selection the
// dashboard's AI basket uses (dataComplete, not hard-failed). [] if the file
// is missing / unreadable so a gap never aborts the run.
function top7FromSnapshot(dateStr) {
  const p = resolve(SNAP_DIR, `${dateStr}.json`);
  if (!existsSync(p)) return [];
  let snap;
  try { snap = JSON.parse(readFileSync(p, "utf8")); } catch { return []; }
  return (snap.stocks || [])
    .filter((s) => s.ticker && typeof s.composite === "number" && s.dataComplete && !s.hardFailed)
    .sort((a, b) => b.composite - a.composite)
    .slice(0, 7)
    .map((s) => String(s.ticker).trim().toUpperCase());
}

// Union of the AI top-7 the dashboard tracks: the frozen top-7 at each month's
// anchor snapshot (the passive basket's locked roster) + today's top-7 (latest
// snapshot) as a forward hedge for a cohort whose anchor snapshot hasn't landed
// yet. Over-fetching a couple of extra names is harmless — they simply appear
// in live-prices.json and get used only if the dashboard references them.
function collectAiTickers(picks) {
  const out = new Set();
  for (const anchor of Object.values(picks.anchorByMonth || {})) {
    if (!anchor) continue;
    for (const t of top7FromSnapshot(anchor)) out.add(t);
  }
  try {
    const idx = JSON.parse(readFileSync(resolve(SNAP_DIR, "index.json"), "utf8"));
    // Last WEEKDAY snapshot — the dashboard shows trading days only (it drops
    // weekend re-captures), so match that here for the "today's top-7" hedge.
    const isWeekday = (d) => { const g = new Date(d + "T00:00:00Z").getUTCDay(); return g >= 1 && g <= 5; };
    const latest = (idx.dates || []).filter(isWeekday).slice(-1)[0];
    if (latest) for (const t of top7FromSnapshot(latest)) out.add(t);
  } catch { /* no manifest — anchors alone still cover the tracked baskets */ }
  return out;
}

// One quote → { current, open, prevClose, dayHigh, dayLow, week52High,
// week52Low, ma50, ma200, vol10d, marketCap, yearlyChangePct }. Returns
// null on any error so a single bad ticker never aborts the run.
async function fetchQuote(ticker) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker_symbol: ticker, type: "stockquote", country: "india" }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = await r.json();               // API returns a quoted CSV string
      if (typeof body !== "string") throw new Error("unexpected shape");
      return parseQuote(body);
    } catch (e) {
      if (attempt === 2) return null;
      await new Promise((res) => setTimeout(res, 600 * (attempt + 1)));
    }
  }
  return null;
}

// "Current Price=1341.8,...,Day Range=1268.9 - 1359.0,..." → structured.
function parseQuote(str) {
  const kv = {};
  for (const part of str.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    kv[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  const num = (v) => { const n = Number(String(v).replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : null; };
  const range = (v) => {
    const m = String(v || "").split("-").map((s) => num(s));
    return m.length === 2 && m[0] != null && m[1] != null ? { lo: Math.min(m[0], m[1]), hi: Math.max(m[0], m[1]) } : null;
  };
  const day = range(kv["Day Range"]);
  const wk  = range(kv["52-Week Range"]);
  const current = num(kv["Current Price"]);
  if (current == null) return null;
  return {
    current,
    open: num(kv["Opening Price"]),
    prevClose: num(kv["Previous Close"]),
    dayHigh: day?.hi ?? null,
    dayLow: day?.lo ?? null,
    week52High: wk?.hi ?? null,
    week52Low: wk?.lo ?? null,
    ma50: num(kv["50-Day Moving Average"]),
    ma200: num(kv["200-Day Moving Average"]),
    vol10d: num(kv["10-Day Average Volume"]),
    marketCap: num(kv["Market Cap"]),
    yearlyChangePct: num(kv["Yearly Change (%)"]),
  };
}
