#!/usr/bin/env node
// Independent verification of the technicals math.
// Picks N random tickers from public/data/technicals.json, refetches their
// daily OHLCV from Yahoo, recomputes the same indicators using the well-
// tested `technicalindicators` npm package, and compares to the values our
// scrape-technicals.mjs produced. Fails the workflow if any indicator
// disagrees with the library by more than the tolerance.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// technicalindicators is CommonJS — use default import then destructure.
import indicators from "technicalindicators";
const { EMA, SMA, RSI, MACD, ADX, ATR } = indicators;
console.log("Loaded technicalindicators:", Object.keys({ EMA, SMA, RSI, MACD, ADX, ATR }).map((k) => `${k}=${typeof ({ EMA, SMA, RSI, MACD, ADX, ATR })[k]}`).join(", "));

const __dirname = dirname(fileURLToPath(import.meta.url));
const TECH_PATH = resolve(__dirname, "../public/data/technicals.json");

const SAMPLE_SIZE = parseInt(process.env.SAMPLE_SIZE || "8", 10);
const TOLERANCE_PCT = parseFloat(process.env.TOLERANCE_PCT || "0.5"); // %

run().catch((err) => { console.error("Fatal:", err.stack || err.message); process.exit(1); });

async function run() {
  console.log("Reading technicals.json from:", TECH_PATH);
  const data = JSON.parse(readFileSync(TECH_PATH, "utf8"));
  console.log("Loaded", (data.companies || []).length, "company records");
  const candidates = (data.companies || []).filter((c) => !c.error && c.bars_count >= 200);
  console.log("Eligible candidates (no error, ≥200 bars):", candidates.length);
  if (candidates.length < SAMPLE_SIZE) {
    console.error(`Only ${candidates.length} eligible companies — need at least ${SAMPLE_SIZE}.`);
    process.exit(1);
  }

  // Deterministic random sample seeded by date so consecutive runs spread coverage
  const seed = new Date().toISOString().slice(0, 10);
  const shuffled = [...candidates].sort((a, b) => hash(seed + a.ticker) - hash(seed + b.ticker));
  const sample = shuffled.slice(0, SAMPLE_SIZE);

  console.log(`Verifying ${sample.length} tickers against technicalindicators library`);
  console.log(`Tolerance: ${TOLERANCE_PCT}%\n`);

  const results = [];
  for (const c of sample) {
    process.stdout.write(`[${c.ticker.padEnd(14)}] fetching... `);
    let bars;
    try {
      bars = await fetchBars(`${c.ticker}.NS`, 400);
      if (bars.length < 250) { console.log(`only ${bars.length} bars, skip`); continue; }
    } catch (err) {
      console.log(`FETCH FAIL: ${err.message}`);
      continue;
    }
    const closes = bars.map((b) => b.close);
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);

    const checks = [];
    checks.push(compare("EMA(50)",  c.ema50, EMA.calculate({ period: 50,  values: closes }).at(-1)));
    checks.push(compare("SMA(50)",  c.sma50, SMA.calculate({ period: 50,  values: closes }).at(-1)));
    checks.push(compare("SMA(200)", c.sma200, SMA.calculate({ period: 200, values: closes }).at(-1)));
    checks.push(compare("RSI(14)",  c.rsi14, RSI.calculate({ period: 14, values: closes }).at(-1)));
    const macdLib = MACD.calculate({ fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, values: closes, SimpleMAOscillator: false, SimpleMASignal: false }).at(-1);
    checks.push(compare("MACD line",   c.macd?.line,   macdLib?.MACD));
    checks.push(compare("MACD signal", c.macd?.signal, macdLib?.signal));
    checks.push(compare("ADX(14)", c.adx14, ADX.calculate({ period: 14, high: highs, low: lows, close: closes }).at(-1)?.adx));
    const atrLib = ATR.calculate({ period: 14, high: highs, low: lows, close: closes }).at(-1);
    const atrPctLib = atrLib != null ? (atrLib / closes.at(-1)) * 100 : null;
    checks.push(compare("ATR(14) %", c.atr14_pct, atrPctLib));

    const failed = checks.filter((x) => x && !x.pass);
    console.log(`${checks.filter((c) => c).length} checks, ${failed.length} failed`);
    results.push({ ticker: c.ticker, name: c.name, checks });
  }

  console.log("\n=== Detailed report ===\n");
  for (const r of results) {
    console.log(`${r.ticker} · ${r.name}`);
    for (const ch of r.checks) {
      if (!ch) continue;
      const mark = ch.pass ? "✓" : "✗";
      console.log(`  ${mark} ${ch.label.padEnd(14)} our: ${fmt(ch.ours).padStart(10)}  lib: ${fmt(ch.lib).padStart(10)}  diff: ${ch.diffPct?.toFixed(3)}%`);
    }
    console.log();
  }

  const totalChecks = results.flatMap((r) => r.checks).filter((c) => c).length;
  const totalFail   = results.flatMap((r) => r.checks).filter((c) => c && !c.pass).length;
  console.log(`=== Summary: ${totalChecks - totalFail}/${totalChecks} checks passed (tolerance ±${TOLERANCE_PCT}%) ===`);
  if (totalFail > 0) {
    console.error(`\nFAIL — ${totalFail} indicator(s) differ from technicalindicators library by more than ${TOLERANCE_PCT}%.`);
    process.exit(1);
  } else {
    console.log("\nAll indicators agree with technicalindicators reference implementation. Math verified.");
  }
}

function compare(label, ours, lib) {
  if (ours == null || lib == null || !Number.isFinite(ours) || !Number.isFinite(lib)) return null;
  const diff = Math.abs(ours - lib);
  const base = Math.max(Math.abs(ours), Math.abs(lib), 1e-9);
  const diffPct = (diff / base) * 100;
  return { label, ours, lib, diffPct, pass: diffPct <= TOLERANCE_PCT };
}

function fmt(n) { return n == null ? "—" : Number(n).toFixed(2); }

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

async function fetchBars(symbol, days) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - days * 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${start}&period2=${end}&interval=1d&events=history`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; KLPVerifyBot/1.0)" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const result = j?.chart?.result?.[0];
  if (!result?.timestamp) throw new Error("no chart data");
  const ts = result.timestamp;
  const q = result.indicators?.quote?.[0] || {};
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const close = q.close?.[i];
    if (close == null) continue;
    out.push({ close, high: q.high?.[i] ?? close, low: q.low?.[i] ?? close });
  }
  return out;
}
