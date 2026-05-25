#!/usr/bin/env node
// Macro scraper. Fetches the few daily-changing market values (crude oil,
// USD/INR, India VIX) from Yahoo Finance, computes a short trend window for
// each, then merges with the slow-changing inputs in screener-test/static/
// macro-context.json and writes public/data/macro.json. The dashboard's
// Macro tab reads that single file.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_PATH = resolve(__dirname, "static/macro-context.json");
const OUT_PATH    = resolve(__dirname, "../public/data/macro.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

run().catch((err) => {
  console.error("Fatal:", err.stack || err.message);
  // Write a best-effort payload using just the static data so the
  // dashboard still has something to score with.
  writeStaticOnly(err.message);
  process.exit(0);
});

async function run() {
  console.log("Loading static macro context...");
  const stat = JSON.parse(readFileSync(STATIC_PATH, "utf8"));

  console.log("Fetching daily market values from Yahoo Finance...");
  const [crude, inrusd, vix] = await Promise.all([
    fetchYahoo("BZ=F", 35),         // Brent crude
    fetchYahoo("USDINR=X", 35),     // USD/INR
    fetchYahoo("^INDIAVIX", 35),    // India VIX (used by Sentiment tab)
  ]);

  const live = {
    crude_brent: trendSummary(crude, "$/bbl"),
    usdinr:      trendSummary(inrusd, "₹/$"),
    india_vix:   trendSummary(vix, ""),
  };
  console.log("  Crude Brent:", live.crude_brent.latest, "(30d change:", live.crude_brent.pct_change_30d + "%)");
  console.log("  USD/INR:    ", live.usdinr.latest, "(30d change:", live.usdinr.pct_change_30d + "%)");
  console.log("  India VIX:  ", live.india_vix.latest);

  // Live NSE sentiment fetches — FII/DII flow, PCR, A/D ratio. Each is
  // best-effort: if NSE blocks our IP we fall back to the static value
  // (or null) and the Sentiment tab rule shows the right N/A note.
  console.log("\nInitialising NSE session for sentiment fetches...");
  let liveSentiment = {};
  try {
    await initNSESession();
    liveSentiment = await fetchNSESentimentAll();
    console.log("  FII flow signal:", liveSentiment.fii_net_positive_last_20d, `(${liveSentiment.fii_positive_days}/${liveSentiment.fii_total_days} days)`);
    console.log("  Put/Call Ratio:", liveSentiment.put_call_ratio);
    console.log("  A/D ratio:     ", liveSentiment.market_breadth_ad_ratio, "(", liveSentiment.market_breadth_note, ")");
  } catch (err) {
    console.log("  NSE sentiment fetch failed:", err.message, "— falling back to static values.");
  }

  // Merge: prefer live values where present, fall back to static
  const sentiment = { ...(stat.sentiment || {}), ...liveSentiment };

  const payload = {
    generated_at: new Date().toISOString(),
    source: "Yahoo Finance (live) + NSE (live sentiment) + macro-context.json (slow-changing)",
    live,
    economic: stat.economic,
    regime: stat.regime,
    sentiment,
    sector_themes: stat.sector_themes,
    pli_companies: stat.pli_companies,
    renewable_companies: stat.renewable_companies,
    static_last_updated: stat._last_manual_update || null,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + "\n");
  console.log(`\nWrote: ${OUT_PATH}`);
  console.log(`PLI companies: ${stat.pli_companies.length}, Renewable: ${stat.renewable_companies.length}`);
}

function writeStaticOnly(reason) {
  try {
    const stat = JSON.parse(readFileSync(STATIC_PATH, "utf8"));
    const payload = {
      generated_at: new Date().toISOString(),
      source: "macro-context.json (live fetch failed)",
      live: null,
      live_error: reason,
      economic: stat.economic,
      regime: stat.regime,
      sentiment: stat.sentiment || null,
      sector_themes: stat.sector_themes,
      pli_companies: stat.pli_companies,
      renewable_companies: stat.renewable_companies,
      static_last_updated: stat._last_manual_update || null,
    };
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + "\n");
    console.log(`Wrote static-only payload: ${OUT_PATH}`);
  } catch (e) {
    console.error("Couldn't even write static-only:", e.message);
  }
}

async function fetchYahoo(symbol, days) {
  const end = Math.floor(Date.now() / 1000);
  const start = end - days * 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${start}&period2=${end}&interval=1d&events=history`;
  const headers = { "User-Agent": "Mozilla/5.0 (compatible; KLPDashboardBot/1.0)" };
  let attempt = 0, lastErr;
  while (attempt < 3) {
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) throw new Error(`${symbol} HTTP ${r.status}`);
      const j = await r.json();
      const result = j?.chart?.result?.[0];
      if (!result?.timestamp) throw new Error(`${symbol} no data`);
      const closes = result.indicators?.quote?.[0]?.close || [];
      return closes.filter((x) => x != null);
    } catch (err) {
      lastErr = err;
      attempt++;
      if (attempt < 3) await sleep(800 * attempt);
    }
  }
  throw lastErr;
}

function trendSummary(closes, unit) {
  if (!closes.length) return { latest: null };
  const latest = round(closes.at(-1), 2);
  const back30 = closes.length >= 22 ? closes.at(-22) : closes[0];   // ~30 calendar days ≈ 22 trading days
  const pct = back30 ? round(((closes.at(-1) - back30) / back30) * 100, 2) : 0;
  let trend;
  if (pct > 2) trend = "rising";
  else if (pct < -2) trend = "falling";
  else trend = "stable";
  return { latest, latest_unit: unit, pct_change_30d: pct, trend, history_bars: closes.length };
}

function round(n, d = 2) {
  if (n == null || !Number.isFinite(n)) return null;
  const m = Math.pow(10, d);
  return Math.round(n * m) / m;
}

// ---------- NSE session + sentiment fetches ----------

const NSE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.nseindia.com/",
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
  for (const url of ["https://www.nseindia.com/", "https://www.nseindia.com/market-data/live-equity-market"]) {
    const r = await fetch(url, { headers: NSE_HEADERS });
    saveCookies(r);
    await sleep(600);
  }
}

async function fetchNSEJson(url, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, { headers: { ...NSE_HEADERS, Cookie: cookieJar } });
      if (r.status === 401 || r.status === 403) {
        await initNSESession();
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      saveCookies(r);
      return await r.json();
    } catch (err) {
      lastErr = err;
      await sleep(800 * (i + 1));
    }
  }
  throw lastErr;
}

async function fetchNSESentimentAll() {
  const [fii, pcr, breadth] = await Promise.allSettled([
    fetchFIIDIIFlow(),
    fetchPutCallRatio(),
    fetchMarketBreadth(),
  ]);
  const out = {};
  if (fii.status === "fulfilled" && fii.value) {
    Object.assign(out, fii.value);
  } else {
    console.log("  FII/DII fetch error:", fii.status === "rejected" ? (fii.reason?.message || String(fii.reason)) : "no data returned");
  }
  if (pcr.status === "fulfilled" && pcr.value != null) {
    out.put_call_ratio = pcr.value;
    out.put_call_ratio_note = `NIFTY total PE OI / CE OI = ${pcr.value} (live from NSE option chain).`;
  } else {
    console.log("  PCR fetch error:    ", pcr.status === "rejected" ? (pcr.reason?.message || String(pcr.reason)) : "no data returned");
  }
  if (breadth.status === "fulfilled" && breadth.value) {
    out.market_breadth_ad_ratio = breadth.value.ad_ratio;
    out.market_breadth_note = `${breadth.value.adv} advances vs ${breadth.value.dec} declines across Nifty 500 (live).`;
  } else {
    console.log("  A/D fetch error:    ", breadth.status === "rejected" ? (breadth.reason?.message || String(breadth.reason)) : "no data returned");
  }
  return out;
}

async function fetchFIIDIIFlow() {
  const data = await fetchNSEJson("https://www.nseindia.com/api/fiidiiTradeReact");
  if (!Array.isArray(data) || !data.length) {
    console.log("  FII raw response shape:", typeof data, Array.isArray(data) ? `array(${data.length})` : Object.keys(data || {}).join(","));
    return null;
  }
  console.log("  FII first row keys:", Object.keys(data[0]).join(", "));
  console.log("  FII first row:", JSON.stringify(data[0]).slice(0, 200));
  // Lenient match: any row whose category mentions FII / FPI / Foreign.
  const fiiRows = data.filter((r) => {
    const cat = String(r.category || r.Category || "").toLowerCase();
    return cat.includes("fii") || cat.includes("fpi") || cat.includes("foreign");
  });
  if (!fiiRows.length) {
    console.log("  FII filter matched 0 rows. Categories seen:", [...new Set(data.map((r) => r.category || r.Category))].join(" | "));
    return null;
  }
  const days = fiiRows.length;
  const positive = fiiRows.filter((r) => Number(r.netValue ?? r.net ?? r.netBuy ?? 0) > 0).length;
  let signal;
  if (days >= 5) {
    const pctPositive = positive / days;
    if (pctPositive >= 0.5) signal = "yes";
    else if (pctPositive >= 0.3) signal = "mixed";
    else signal = "no";
  } else {
    return null;
  }
  return {
    fii_net_positive_last_20d: signal,
    fii_positive_days: positive,
    fii_total_days: days,
    fii_signal_note: `FII net positive in ${positive} of last ${days} reported trading days (live from NSE daily activity).`,
  };
}

async function fetchPutCallRatio() {
  // The legacy /api/option-chain-indices endpoint 404s. Try v3 instead.
  const url = "https://www.nseindia.com/api/option-chain-v3?type=Indices&symbol=NIFTY";
  const data = await fetchNSEJson(url);
  if (!data) throw new Error("v3 option chain returned no data");
  const records = data?.records?.data || data?.data || [];
  if (!records.length) {
    console.log("  PCR v3 response keys:", Object.keys(data).join(","));
    return null;
  }
  let ceOI = 0, peOI = 0;
  for (const r of records) {
    ceOI += Number(r.CE?.openInterest || 0);
    peOI += Number(r.PE?.openInterest || 0);
  }
  if (ceOI === 0) return null;
  return Math.round((peOI / ceOI) * 100) / 100;
}

async function fetchMarketBreadth() {
  // The /api/equity-stockIndices?index=NIFTY%20500 endpoint 404s. Use the
  // pre-open snapshot which returns per-stock advances/declines across the
  // full universe. Falls back to allIndices if that also fails.
  const candidates = [
    "https://www.nseindia.com/api/snapshot-capital-market-pre-open?key=NIFTY",
    "https://www.nseindia.com/api/equity-stockIndices?index=NIFTY+500",
    "https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%2050",
  ];
  let data = null, urlUsed = null;
  for (const url of candidates) {
    try {
      data = await fetchNSEJson(url);
      urlUsed = url;
      break;
    } catch (e) { /* try next */ }
  }
  if (!data) throw new Error("all breadth endpoints failed");
  console.log("  A/D endpoint that worked:", urlUsed);
  console.log("  A/D response top keys:  ", Object.keys(data).slice(0, 10).join(","));
  // pre-open shape: { advances, declines, unchanged, data: [...] }
  if (typeof data.advances === "number" && typeof data.declines === "number") {
    const adv = data.advances, dec = data.declines;
    return { adv, dec, ad_ratio: dec === 0 ? null : Math.round((adv / dec) * 100) / 100 };
  }
  // equity-stockIndices shape: { data: [...] } with pChange per row
  const rows = data?.data || [];
  if (rows.length) {
    const stocks = rows.filter((r) => r.priority !== 1 && r.symbol);
    const adv = stocks.filter((r) => Number(r.pChange) > 0).length;
    const dec = stocks.filter((r) => Number(r.pChange) < 0).length;
    return { adv, dec, ad_ratio: dec === 0 ? null : Math.round((adv / dec) * 100) / 100 };
  }
  return null;
}
