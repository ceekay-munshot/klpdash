#!/usr/bin/env node
// Scrape per-company technical indicators from TradingView using Playwright.
//
// Why Playwright (replacing Firecrawl): GitHub Actions runners are free,
// $0/month vs Firecrawl's ~$83/month at 504-daily-scrape volume. The
// downside is upkeep — TradingView UI changes can break our text-parse
// regexes — but the only cost when that happens is rewriting a regex,
// not a monthly bill.
//
// Approach: navigate to the TradingView technicals page with a realistic
// browser fingerprint, wait for the indicator tables to render, grab the
// page text, and parse per-indicator rows with regex. Text-based parsing
// is more resilient to DOM class-name changes than CSS/XPath selectors.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENER_PATH = resolve(__dirname, "../public/data/screener-companies.json");
const TODO_PATH     = resolve(__dirname, "../public/data/revenue-mix-todo.csv");
const OUT_PATH      = resolve(__dirname, "../public/data/technicals-source.json");

const BATCH_SIZE        = Number(process.env.TECHNICALS_SOURCE_BATCH    || 25);
const THROTTLE_MS       = Number(process.env.TECHNICALS_SOURCE_THROTTLE || 1500);
const NAV_TIMEOUT_MS    = Number(process.env.TECHNICALS_SOURCE_TIMEOUT  || 30_000);
const PAGE_WAIT_MS      = 3_000;   // give JS-rendered tables time to populate

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36";

// ---------- Indicator label → output field map ----------
// Patterns must match the visible text in TradingView's rendered tables.
// Each entry is [regex against label, target object, output field].
const INDICATOR_MAP = [
  // Oscillators
  [/^Relative Strength Index\s*\(14\)/i,                  "oscillators", "rsi_14"],
  [/^Stochastic %K\s*\(14,\s*3,\s*3\)/i,                  "oscillators", "stoch_k"],
  [/^Commodity Channel Index\s*\(20\)/i,                  "oscillators", "cci_20"],
  [/^Average Directional Index\s*\(14\)/i,                "oscillators", "adx_14"],
  [/^Awesome Oscillator/i,                                "oscillators", "awesome_osc"],
  [/^Momentum\s*\(10\)/i,                                 "oscillators", "momentum_10"],
  [/^MACD Level\s*\(12,\s*26\)/i,                         "oscillators", "macd_level"],
  [/^Stochastic RSI Fast\s*\(3,\s*3,\s*14,\s*14\)/i,      "oscillators", "stoch_rsi_fast"],
  [/^Williams Percent Range\s*\(14\)/i,                   "oscillators", "williams_r"],
  [/^Bull Bear Power/i,                                   "oscillators", "bull_bear_power"],
  [/^Ultimate Oscillator\s*\(7,\s*14,\s*28\)/i,           "oscillators", "ultimate_osc"],
  // Moving Averages
  [/^Exponential Moving Average\s*\(10\)/i,               "moving_averages", "ema_10"],
  [/^Simple Moving Average\s*\(10\)/i,                    "moving_averages", "sma_10"],
  [/^Exponential Moving Average\s*\(20\)/i,               "moving_averages", "ema_20"],
  [/^Simple Moving Average\s*\(20\)/i,                    "moving_averages", "sma_20"],
  [/^Exponential Moving Average\s*\(30\)/i,               "moving_averages", "ema_30"],
  [/^Simple Moving Average\s*\(30\)/i,                    "moving_averages", "sma_30"],
  [/^Exponential Moving Average\s*\(50\)/i,               "moving_averages", "ema_50"],
  [/^Simple Moving Average\s*\(50\)/i,                    "moving_averages", "sma_50"],
  [/^Exponential Moving Average\s*\(100\)/i,              "moving_averages", "ema_100"],
  [/^Simple Moving Average\s*\(100\)/i,                   "moving_averages", "sma_100"],
  [/^Exponential Moving Average\s*\(200\)/i,              "moving_averages", "ema_200"],
  [/^Simple Moving Average\s*\(200\)/i,                   "moving_averages", "sma_200"],
  [/^Ichimoku Base Line\s*\(9,\s*26,\s*52,\s*26\)/i,      "moving_averages", "ichimoku_base"],
  [/^Volume Weighted Moving Average\s*\(20\)/i,           "moving_averages", "vwma_20"],
  [/^Hull Moving Average\s*\(9\)/i,                       "moving_averages", "hull_9"],
];

// ---------- Universe + priority list ----------
const screener = JSON.parse(readFileSync(SCREENER_PATH, "utf8"));
const screenerBySlug = new Map();
for (const c of screener) {
  const slug = String(c["Screener URL"] || "").match(/\/company\/([^/]+)/)?.[1]?.toUpperCase();
  if (slug && !/^\d+$/.test(slug)) screenerBySlug.set(slug, c);
}

let ordered = [];
if (existsSync(TODO_PATH)) {
  const lines = readFileSync(TODO_PATH, "utf8").split("\n");
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const name = line.split(",")[0].trim();
    for (const c of screener) {
      if (String(c.Company).trim().replace(/,/g, ";").startsWith(name.slice(0, 30))) {
        const slug = String(c["Screener URL"] || "").match(/\/company\/([^/]+)/)?.[1]?.toUpperCase();
        if (slug && !/^\d+$/.test(slug)) { ordered.push(slug); break; }
      }
    }
    if (ordered.length >= BATCH_SIZE) break;
  }
}
if (ordered.length === 0) ordered = [...screenerBySlug.keys()].sort().slice(0, BATCH_SIZE);

console.log(`Will scrape ${ordered.length} companies (batch=${BATCH_SIZE})`);
console.log(`First 5: ${ordered.slice(0, 5).join(", ")}`);

// ---------- Load existing output (resume on same-day re-run) ----------
let out = { generated_at: null, source: "TradingView technical-analysis pages (via Playwright)", companies: {} };
if (existsSync(OUT_PATH)) {
  try { out = JSON.parse(readFileSync(OUT_PATH, "utf8")); } catch {}
}
if (!out.companies) out.companies = {};

// Persist current state to disk after every successful scrape. Critical
// for long runs (504 companies × ~10s each ≈ 80 min) — without this, a
// workflow timeout / runner crash wipes everything since the previous
// commit. Resume on next run picks up only the slugs still missing.
function checkpointSave() {
  out.generated_at = new Date().toISOString();
  out.total_companies_covered = Object.keys(out.companies).length;
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
}

// ---------- Parse a single page's text into structured indicators ----------
// TradingView's rendered text has each indicator on its own visual row;
// each row contains: name <whitespace> value <whitespace> action.
// We split by newlines and walk per line, matching label → value.
function parsePageText(text) {
  const result = { summary: {}, oscillators: {}, moving_averages: {} };
  const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);

  // Find the summary block — typically near the top, format like:
  //   "Strong Buy" / "Buy" / "Neutral" / "Sell" / "Strong Sell"
  //   "Buy: 8"   "Neutral: 1"   "Sell: 1"
  const verdictMatch = text.match(/(Strong Buy|Strong Sell|^Buy$|^Sell$|Neutral)/im);
  if (verdictMatch) result.summary.verdict = verdictMatch[1];
  const buyM = text.match(/Buy[:\s]+(\d+)/i);
  const sellM = text.match(/Sell[:\s]+(\d+)/i);
  const neutralM = text.match(/Neutral[:\s]+(\d+)/i);
  if (buyM)     result.summary.buy_count     = Number(buyM[1]);
  if (sellM)    result.summary.sell_count    = Number(sellM[1]);
  if (neutralM) result.summary.neutral_count = Number(neutralM[1]);

  // Per-indicator: name might be on one line, value on next (responsive
  // layout). Or "Name <tab> Value <tab> Action" inline. Handle both.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const [pattern, bucket, field] of INDICATOR_MAP) {
      if (!pattern.test(line)) continue;
      // Try to extract a number from THIS line first (inline format)
      let m = line.match(/-?\d+\.?\d*/);
      if (m) {
        result[bucket][field] = Number(m[0]);
        break;
      }
      // Otherwise look at the next line (stacked format)
      const next = lines[i + 1] || "";
      const nm = next.match(/^-?\d+\.?\d*$/);
      if (nm) {
        result[bucket][field] = Number(nm[0]);
        break;
      }
    }
  }
  return result;
}

// ---------- Scrape loop ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({
  userAgent: UA,
  viewport: { width: 1920, height: 1080 },
  locale: "en-IN",
  timezoneId: "Asia/Kolkata",
});
const page = await context.newPage();

// Resume mechanic: skip slugs that already have a scrape from THIS run's day.
// On a 504-company run that times out at company #200, the workflow's next
// fire (or a manual re-trigger) picks up at #201 without re-scraping.
const RESUME_FRESH_HOURS = Number(process.env.TECHNICALS_SOURCE_RESUME_HOURS || 18);

let ok = 0, fail = 0, skipped = 0, resumed = 0;
for (const slug of ordered) {
  const existing = out.companies[slug];
  if (existing?.scraped_at) {
    const ageHours = (Date.now() - new Date(existing.scraped_at).getTime()) / 3_600_000;
    if (ageHours < RESUME_FRESH_HOURS) {
      resumed++;
      continue;   // already scraped this run-window; skip silently
    }
  }
  const url = `https://in.tradingview.com/symbols/NSE-${slug}/technicals/`;
  process.stdout.write(`[${ok + fail + skipped + resumed + 1}/${ordered.length}] ${slug.padEnd(14)} `);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    // Wait for the page's JS-driven tables to populate. The signal:
    // "Moving Averages" or "Oscillators" headings show up in the rendered DOM.
    await page.waitForFunction(
      () => /Moving Averages|Oscillators|Relative Strength Index/i.test(document.body.innerText),
      null,
      { timeout: NAV_TIMEOUT_MS },
    ).catch(() => null);
    await sleep(PAGE_WAIT_MS);

    const bodyText = await page.evaluate(() => document.body.innerText);
    const parsed = parsePageText(bodyText);
    const indicatorCount =
      Object.keys(parsed.oscillators || {}).length +
      Object.keys(parsed.moving_averages || {}).length;
    if (indicatorCount < 3) {
      console.log(`extraction empty (${indicatorCount} fields) — skip`);
      skipped++;
      continue;
    }
    out.companies[slug] = { ...parsed, url, scraped_at: new Date().toISOString() };
    checkpointSave();   // persist after every success — survives timeouts/crashes
    console.log(`OK · ${indicatorCount} indicators · summary=${parsed.summary?.verdict || "—"}`);
    ok++;
  } catch (err) {
    console.log(`ERR: ${(err.message || "").slice(0, 80)}`);
    fail++;
  }
  if (THROTTLE_MS > 0) await sleep(THROTTLE_MS);
}

await browser.close();

out.last_batch_ok = ok;
out.last_batch_fail = fail;
out.last_batch_skipped_empty = skipped;
out.last_batch_resumed = resumed;
checkpointSave();

console.log(`\nDone. ok=${ok}  fail=${fail}  skipped=${skipped}  resumed=${resumed}`);
console.log(`Total companies covered: ${out.total_companies_covered}`);
console.log(`Wrote ${OUT_PATH}`);
