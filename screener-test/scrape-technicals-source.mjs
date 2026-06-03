#!/usr/bin/env node
// Scrape per-company technical indicators from TradingView so our values
// match what an analyst sees on their screen. Falls back to the existing
// OHLCV-derived calculations (scrape-technicals.mjs) for any company we
// can't scrape or any indicator the source page doesn't show.
//
// Why TradingView: simplest URL pattern of the five sources reviewed —
// `https://in.tradingview.com/symbols/NSE-{TICKER}/technicals/` works
// for every NSE-listed Nifty 500 company by ticker alone (no per-company
// numeric IDs to maintain like Trendlyne).
//
// Initial deployment: scrapes TECHNICALS_SOURCE_BATCH (default 25) top-
// of-SPIP companies per run. Expand later if Firecrawl handles the load.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENER_PATH = resolve(__dirname, "../public/data/screener-companies.json");
const TODO_PATH     = resolve(__dirname, "../public/data/revenue-mix-todo.csv");  // reuse SPIP-priority list
const OUT_PATH      = resolve(__dirname, "../public/data/technicals-source.json");

const API_KEY = process.env.FIRECRAWL_API_KEY;
const BATCH_SIZE = Number(process.env.TECHNICALS_SOURCE_BATCH || 25);
const THROTTLE_MS = Number(process.env.TECHNICALS_SOURCE_THROTTLE || 1500);

if (!API_KEY) {
  console.error("FIRECRAWL_API_KEY env not set — aborting.");
  process.exit(1);
}

// JSON-extract schema. TradingView's /technicals/ page shows two tables
// (Oscillators + Moving Averages) plus a Summary verdict.
const SCHEMA = {
  type: "object",
  properties: {
    summary: {
      type: "object",
      description: "Top summary verdict shown above the indicator tables.",
      properties: {
        verdict:       { type: "string", description: "'Strong Buy' | 'Buy' | 'Neutral' | 'Sell' | 'Strong Sell'" },
        buy_count:     { type: "number", description: "Number of 'Buy' votes across all indicators" },
        sell_count:    { type: "number" },
        neutral_count: { type: "number" },
      },
    },
    oscillators: {
      type: "object",
      description: "Oscillators table values (numeric values, exclude N/A).",
      properties: {
        rsi_14:        { type: "number", description: "Relative Strength Index (14)" },
        macd_level:    { type: "number", description: "MACD Level (12,26) — the MACD line value" },
        stoch_k:       { type: "number" },
        cci_20:        { type: "number", description: "Commodity Channel Index (20)" },
        adx_14:        { type: "number", description: "Average Directional Index (14)" },
        awesome_osc:   { type: "number" },
        momentum_10:   { type: "number" },
        williams_r:    { type: "number" },
        ultimate_osc:  { type: "number" },
      },
    },
    moving_averages: {
      type: "object",
      description: "Moving Averages table — extract numeric values for each row.",
      properties: {
        ema_10:        { type: "number" },
        sma_10:        { type: "number" },
        ema_20:        { type: "number" },
        sma_20:        { type: "number" },
        ema_30:        { type: "number" },
        sma_30:        { type: "number" },
        ema_50:        { type: "number" },
        sma_50:        { type: "number" },
        ema_100:       { type: "number" },
        sma_100:       { type: "number" },
        ema_200:       { type: "number" },
        sma_200:       { type: "number" },
        ichimoku_base: { type: "number" },
        vwma_20:       { type: "number" },
        hull_9:        { type: "number" },
      },
    },
  },
};

// ---------- Load universe + SPIP-priority list ----------
const screener = JSON.parse(readFileSync(SCREENER_PATH, "utf8"));

// Map slug → company entry for quick lookups
const screenerBySlug = new Map();
for (const c of screener) {
  const slug = String(c["Screener URL"] || "").match(/\/company\/([^/]+)/)?.[1]?.toUpperCase();
  if (slug && !/^\d+$/.test(slug)) screenerBySlug.set(slug, c);
}

// Pull priority order from the revenue-mix TODO CSV (it's already
// SPIP-sorted). Top BATCH_SIZE rows. Skip rows whose slug isn't NSE-listed.
let ordered = [];
if (existsSync(TODO_PATH)) {
  const lines = readFileSync(TODO_PATH, "utf8").split("\n");
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(",");
    if (parts.length < 2) continue;
    const name = parts[0].trim();
    // Find the company in screener by name
    for (const c of screener) {
      if (String(c.Company).trim().replace(/,/g, ";").startsWith(name.slice(0, 30))) {
        const slug = String(c["Screener URL"] || "").match(/\/company\/([^/]+)/)?.[1]?.toUpperCase();
        if (slug && !/^\d+$/.test(slug)) {
          ordered.push(slug);
          break;
        }
      }
    }
    if (ordered.length >= BATCH_SIZE) break;
  }
}

// Fallback: alphabetical first N if TODO doesn't exist
if (ordered.length === 0) ordered = [...screenerBySlug.keys()].sort().slice(0, BATCH_SIZE);

console.log(`Will scrape ${ordered.length} companies (batch=${BATCH_SIZE})`);
console.log(`First 5: ${ordered.slice(0, 5).join(", ")}`);

// ---------- Load existing output (resume on re-run within same day) ----------
let out = { generated_at: null, source: "TradingView technical-analysis pages (via Firecrawl)", companies: {} };
if (existsSync(OUT_PATH)) {
  try { out = JSON.parse(readFileSync(OUT_PATH, "utf8")); } catch {}
}
if (!out.companies) out.companies = {};

// ---------- Scrape loop ----------
const FIRECRAWL_URL = "https://api.firecrawl.dev/v1/scrape";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ok = 0, fail = 0, skipped = 0;
for (const slug of ordered) {
  const url = `https://in.tradingview.com/symbols/NSE-${slug}/technicals/`;
  process.stdout.write(`[${ok + fail + skipped + 1}/${ordered.length}] ${slug.padEnd(14)} `);

  try {
    const r = await fetch(FIRECRAWL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["json"],
        jsonOptions: { schema: SCHEMA },
        onlyMainContent: false,
      }),
    });
    if (!r.ok) {
      console.log(`HTTP ${r.status} — skip`);
      fail++;
      continue;
    }
    const data = await r.json();
    const extracted = data?.data?.json || data?.data?.extract || {};
    const indicatorCount =
      Object.keys(extracted.oscillators || {}).length +
      Object.keys(extracted.moving_averages || {}).length;

    if (indicatorCount < 3) {
      console.log(`extraction empty (${indicatorCount} fields) — skip`);
      skipped++;
      continue;
    }

    out.companies[slug] = {
      ...extracted,
      url,
      scraped_at: new Date().toISOString(),
    };
    console.log(`OK · ${indicatorCount} indicators · summary=${extracted?.summary?.verdict || "—"}`);
    ok++;
  } catch (err) {
    console.log(`ERR: ${err.message.slice(0, 80)}`);
    fail++;
  }

  // Throttle to be polite + avoid Firecrawl rate limits
  if (THROTTLE_MS > 0) await sleep(THROTTLE_MS);
}

out.generated_at = new Date().toISOString();
out.last_batch_ok = ok;
out.last_batch_fail = fail;
out.last_batch_skipped_empty = skipped;
out.total_companies_covered = Object.keys(out.companies).length;

writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");

console.log(`\nDone. ok=${ok}  fail=${fail}  skipped=${skipped}`);
console.log(`Total companies covered in source file: ${out.total_companies_covered}`);
console.log(`Wrote ${OUT_PATH}`);
