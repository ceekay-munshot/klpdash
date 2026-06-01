#!/usr/bin/env node
// NSE PIT (Prohibition of Insider Trading) scraper. Pulls insider-trade
// disclosures filed in the last ~180 calendar days, aggregates per ticker
// (buy shares, sell shares, buy value, sell value, transaction count, last
// trade date), and writes public/data/insider-trades.json which the
// Fundamentals scoring rule reads.

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "../public/data/insider-trades.json");

const LOOKBACK_DAYS = 180;
const CHUNK_DAYS = 60;      // NSE PIT endpoint accepts windows up to ~90 days

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- main ----------
async function run() {
  console.log("Initialising NSE session...");
  await initNSESession();

  const today = new Date();
  const trades = [];
  let chunks = 0, chunkOk = 0;
  for (let offset = 0; offset < LOOKBACK_DAYS; offset += CHUNK_DAYS) {
    const toD   = new Date(today.getTime() - offset * 86400000);
    const fromD = new Date(toD.getTime() - CHUNK_DAYS * 86400000);
    chunks++;
    process.stdout.write(`Chunk ${chunks} (${fmtDate(fromD)} → ${fmtDate(toD)})... `);
    try {
      const data = await fetchPIT(fmtDate(fromD), fmtDate(toD));
      const rows = data?.data || [];
      trades.push(...rows);
      chunkOk++;
      console.log(`${rows.length} trades`);
    } catch (err) {
      console.log(`FAIL: ${err.message}`);
    }
    await sleep(800);
  }

  if (chunkOk === 0) {
    console.log("\nNo PIT chunks succeeded — writing empty payload.");
    writeFallback("NSE PIT API unreachable (likely IP-blocked or schema changed). Will retry on next refresh.");
    return;
  }

  console.log(`\nGot ${trades.length} raw trade entries from ${chunkOk}/${chunks} chunks`);
  // Show first row schema so we can debug if NSE changes field names later.
  if (trades[0]) {
    console.log("Sample raw entry keys:", Object.keys(trades[0]).join(", "));
  }

  const perTicker = aggregate(trades);
  const tickerCount = Object.keys(perTicker).length;
  console.log(`Aggregated into ${tickerCount} tickers.`);

  const payload = {
    generated_at: new Date().toISOString(),
    source: "NSE corporates-pit API",
    lookback_days: LOOKBACK_DAYS,
    total_trades: trades.length,
    chunks_ok: chunkOk,
    chunks_total: chunks,
    companies: perTicker,
  };
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(payload) + "\n");
  console.log(`\nWrote: ${OUT_PATH}`);
}

function writeFallback(reason) {
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "NSE corporates-pit API",
    lookback_days: LOOKBACK_DAYS,
    total_trades: 0,
    chunks_ok: 0,
    error: reason,
    companies: {},
  }) + "\n");
  console.log(`Wrote empty payload: ${OUT_PATH}`);
}

// ---------- NSE session + fetch ----------
const NSE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.nseindia.com/companies-listing/corporate-filings-insider-trading",
  "Connection": "keep-alive",
};

let cookieJar = "";

function saveCookies(response) {
  const setCookies = response.headers.getSetCookie?.() || [];
  for (const sc of setCookies) {
    const [kv] = sc.split(";");
    const eq = kv.indexOf("=");
    if (eq < 0) continue;
    const k = kv.slice(0, eq).trim();
    const v = kv.slice(eq + 1).trim();
    const existing = new RegExp(`(^|; )${k}=[^;]*`);
    if (existing.test(cookieJar)) cookieJar = cookieJar.replace(existing, (m, p) => `${p}${k}=${v}`);
    else cookieJar += (cookieJar ? "; " : "") + `${k}=${v}`;
  }
}

async function initNSESession() {
  cookieJar = "";
  const warmupUrls = [
    "https://www.nseindia.com/",
    "https://www.nseindia.com/companies-listing/corporate-filings-insider-trading",
  ];
  for (const url of warmupUrls) {
    const r = await fetch(url, { headers: NSE_HEADERS });
    saveCookies(r);
    await sleep(600);
  }
}

async function fetchPIT(fromDate, toDate) {
  const url = `https://www.nseindia.com/api/corporates-pit?index=equities&from_date=${fromDate}&to_date=${toDate}`;
  let attempt = 0;
  while (attempt < 3) {
    try {
      const r = await fetch(url, {
        headers: { ...NSE_HEADERS, Cookie: cookieJar, Accept: "application/json" },
      });
      if (r.status === 401 || r.status === 403) {
        // Re-initialise session and retry
        await initNSESession();
        attempt++;
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      saveCookies(r);
      return await r.json();
    } catch (err) {
      attempt++;
      if (attempt >= 3) throw err;
      await sleep(1500 * attempt);
    }
  }
}

function fmtDate(d) {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
}

// ---------- aggregation ----------
function num(v) { const n = Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; }

function aggregate(trades) {
  const out = {};
  let pledgeSkipped = 0;
  for (const t of trades) {
    const sym = String(t.symbol || "").trim().toUpperCase();
    if (!sym) continue;

    // Actual NSE PIT values (probed via PR #15):
    //   buyValue / sellValue / buyQuantity / sellquantity are always "0"
    //   placeholders. Real values live in:
    //     secAcq             – share count (regardless of direction)
    //     secVal             – transaction value in ₹
    //     tdpTransactionType – "Buy" | "Sell" | "Pledge" | "Pledge Release"
    //     acqMode            – "Market Purchase" | "Market Sale" | "ESOP" | ...
    //     personCategory     – "Promoters" | "Director" | "Promoter Group" | ...
    const shares = num(t.secAcq);
    const value  = num(t.secVal);
    const type   = String(t.tdpTransactionType || "").trim();

    if (!out[sym]) out[sym] = {
      buy_shares: 0, sell_shares: 0, buy_value: 0, sell_value: 0,
      transactions: 0, pledges_excluded: 0, last_date: null,
    };

    if (type === "Buy") {
      out[sym].buy_shares += shares;
      out[sym].buy_value  += value;
    } else if (type === "Sell") {
      out[sym].sell_shares += shares;
      out[sym].sell_value  += value;
    } else {
      // Pledge / Pledge Release / Invocation — not a buy or sell of beneficial
      // ownership. Skip from the scoring count (the client rule is about
      // net BUYING vs SELLING, not collateral pledges). We still TRACK these
      // per-ticker so the rule cell can transparently say "X trades + Y
      // pledges excluded" — otherwise a user comparing our number to the
      // NSE PIT page (which lists everything) will be confused.
      pledgeSkipped++;
      out[sym].pledges_excluded = (out[sym].pledges_excluded || 0) + 1;
      continue;
    }
    out[sym].transactions++;

    const date = t.date || t.intimDt || t.acqtoDt;
    if (date && (!out[sym].last_date || dateGt(date, out[sym].last_date))) {
      out[sym].last_date = date;
    }
  }
  console.log(`  Skipped ${pledgeSkipped} pledge/non-buy-sell disclosures.`);
  // Derive net + round
  for (const sym in out) {
    const o = out[sym];
    o.net_shares = o.buy_shares - o.sell_shares;
    o.net_value  = Math.round((o.buy_value - o.sell_value) * 100) / 100;
    o.buy_value  = Math.round(o.buy_value  * 100) / 100;
    o.sell_value = Math.round(o.sell_value * 100) / 100;
  }
  return out;
}

function dateGt(a, b) {
  // Both NSE strings (e.g. "15-Jan-2026"); naive string compare is enough.
  return new Date(a) > new Date(b);
}

// ---------- entry ----------
// Invoked at the bottom so module-level let/const (cookieJar, NSE_HEADERS)
// reach their declarations before initNSESession() touches them.
run().catch((err) => {
  console.error("Fatal:", err.stack || err.message);
  writeFallback(err.message);
  process.exit(0);
});
