#!/usr/bin/env node
// Macro scraper. Fetches the few daily-changing market values (crude oil,
// USD/INR, India VIX) from Yahoo Finance, computes a short trend window for
// each, then merges with the slow-changing inputs in screener-test/static/
// macro-context.json and writes public/data/macro.json. The dashboard's
// Macro tab reads that single file.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_PATH       = resolve(__dirname, "static/macro-context.json");
const OUT_PATH          = resolve(__dirname, "../public/data/macro.json");
const TECH_PATH         = resolve(__dirname, "../public/data/technicals.json");
const FII_HISTORY_PATH  = resolve(__dirname, "../public/data/fii-dii-history.json");

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
  const out = {};

  // 1) FII/DII: accumulator approach — NSE's /api/fiidiiTradeReact returns
  //    today's snapshot only. We append it to a committed history file and
  //    compute the rolling signal from that history.
  try {
    const todayRows = await fetchFIIDIITodayRows();
    const history = appendToFIIHistory(todayRows);
    const signal = computeFIISignal(history);
    if (signal) {
      Object.assign(out, signal);
      console.log(`  FII flow: ${signal.fii_net_positive_last_20d} (${signal.fii_positive_days}/${signal.fii_total_days} days) — history file has ${history.length} entries`);
    } else {
      console.log("  FII flow: not enough history yet to compute signal (history size", history.length + ")");
    }
  } catch (err) {
    console.log("  FII fetch error:", err.message);
  }

  // 2) Market breadth: read from the just-committed technicals.json. Our own
  //    Nifty 500 universe — no NSE breadth API needed.
  try {
    const tech = JSON.parse(readFileSync(TECH_PATH, "utf8"));
    if (tech.market_breadth && tech.market_breadth.ad_ratio != null) {
      out.market_breadth_ad_ratio = tech.market_breadth.ad_ratio;
      out.market_breadth_note = `${tech.market_breadth.advances} advances vs ${tech.market_breadth.declines} declines across ${tech.market_breadth.universe} Nifty 500 stocks (computed from Yahoo OHLCV).`;
      console.log(`  A/D ratio: ${tech.market_breadth.ad_ratio} (${tech.market_breadth.advances}adv / ${tech.market_breadth.declines}dec)`);
    } else {
      console.log("  A/D ratio: technicals.json has no market_breadth block yet — rerun Technicals scrape.");
    }
  } catch (err) {
    console.log("  A/D fetch error: couldn't read technicals.json —", err.message);
  }

  // 3) PCR: try Yahoo Finance options first (no cookies needed). Fall back
  //    to a MoneyControl HTML scrape if Yahoo doesn't return Indian index
  //    option chain data.
  try {
    const pcr = await fetchPCR();
    out._pcr_debug = pcr.diag;
    if (pcr && pcr.value != null) {
      out.put_call_ratio = pcr.value;
      out.put_call_ratio_note = pcr.note;
      console.log(`  PCR: ${pcr.value} (source: ${pcr.source})`);
    } else {
      console.log("  PCR: no source returned a usable value — rule stays N/A.");
    }
  } catch (err) {
    console.log("  PCR fetch error:", err.message);
  }

  return out;
}

async function fetchPCR() {
  const diag = { fo_bhavcopy: null };
  try {
    const result = await fetchPCRFromFOBhavcopy();
    diag.fo_bhavcopy = result.diag;
    if (result.value != null) return { value: result.value, source: "NSE F&O bhavcopy", note: `NIFTY total PE OI / CE OI = ${result.value} (live from NSE F&O bhavcopy, ${result.diag.date_used}).`, diag };
  } catch (err) {
    diag.fo_bhavcopy = { error: err.message };
    console.log("  PCR (FO bhavcopy): " + err.message);
  }
  return { value: null, diag };
}

async function fetchPCRFromFOBhavcopy() {
  // NSE's F&O bhavcopy URL has been through several formats. Try the known
  // ones; whichever returns 200 wins. Public domain (nsearchives), no
  // cookies. Walk backward through business days if today's file isn't
  // posted yet.
  const diag = { attempts: [] };
  const ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
  const headers = { "User-Agent": ua };

  const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const today = new Date();
  for (let d = 0; d < 7; d++) {
    const date = new Date(today.getTime() - d * 86400000);
    const dow = date.getUTCDay();
    if (dow === 0 || dow === 6) continue;

    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const yyyymmdd = `${yyyy}${mm}${dd}`;
    const ddmmm = `${dd}${monthNames[date.getUTCMonth()]}${yyyy}`;     // 25MAY2026
    const ddmmmYY = `${dd}${monthNames[date.getUTCMonth()]}${yyyy}`;

    const candidates = [
      // New CSV format (post-2024)
      `https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_${yyyymmdd}_F_0000.csv`,
      `https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_${yyyymmdd}_F_0000.csv.zip`,
      // Legacy zipped format
      `https://nsearchives.nseindia.com/content/historical/DERIVATIVES/${yyyy}/${monthNames[date.getUTCMonth()]}/fo${ddmmm}bhav.csv.zip`,
      `https://archives.nseindia.com/content/historical/DERIVATIVES/${yyyy}/${monthNames[date.getUTCMonth()]}/fo${ddmmm}bhav.csv.zip`,
    ];

    for (const url of candidates) {
      const attempt = { url };
      try {
        const r = await fetch(url, { headers });
        attempt.http_status = r.status;
        if (r.status !== 200) { diag.attempts.push(attempt); continue; }
        // Read body — text for .csv, arrayBuffer for .csv.zip
        let csv;
        if (url.endsWith(".zip")) {
          const buf = Buffer.from(await r.arrayBuffer());
          attempt.zip_size = buf.length;
          csv = unzipFirstCsv(buf);
          if (!csv) { attempt.zip_error = "unzip returned no csv"; diag.attempts.push(attempt); continue; }
          attempt.csv_size = csv.length;
        } else {
          csv = await r.text();
          attempt.csv_size = csv.length;
        }
        const result = parsePCRCsv(csv);
        attempt.parsed = result.summary;
        diag.attempts.push(attempt);
        if (result.pcr != null) {
          diag.date_used = ddmmm;
          diag.url_used = url;
          return { value: result.pcr, diag };
        }
      } catch (err) {
        attempt.error = err.message;
        diag.attempts.push(attempt);
      }
    }
  }
  return { value: null, diag };
}

function unzipFirstCsv(zipBuffer) {
  // Use system `unzip` (available on Ubuntu runners) to avoid adding an
  // npm dependency. Write the buffer to a temp file, then list + extract
  // the first .csv inside.
  const tmp = `${tmpdir()}/fo-${Date.now()}.zip`;
  writeFileSync(tmp, zipBuffer);
  try {
    const listing = spawnSync("unzip", ["-l", tmp], { encoding: "utf8" });
    if (listing.status !== 0) return null;
    const csvLine = listing.stdout.split("\n").find((l) => /\.csv\b/i.test(l));
    if (!csvLine) return null;
    const csvName = csvLine.trim().split(/\s+/).pop();
    if (!csvName) return null;
    const out = spawnSync("unzip", ["-p", tmp, csvName], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
    if (out.status !== 0) return null;
    return out.stdout;
  } catch { return null; }
}

function parsePCRCsv(csv) {
  const lines = csv.split(/\r?\n/);
  if (lines.length < 2) return { pcr: null, summary: { lines: lines.length } };
  const headers = lines[0].split(",").map((h) => h.trim().toUpperCase());
  // Find column indices defensively — NSE has variants of the same data.
  const idx = (...names) => {
    for (const n of names) {
      const i = headers.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iSym = idx("TCKRSYMB", "SYMBOL");
  const iType = idx("FININSTRMTP", "INSTRUMENT");
  const iOpt = idx("OPTNTP", "OPTION_TYP", "OPTIONTYPE");
  const iOI = idx("OPNINTRST", "OPEN_INT", "OPEN_INTEREST");
  if (iSym < 0 || iType < 0 || iOpt < 0 || iOI < 0) {
    return { pcr: null, summary: { header_keys: headers.slice(0, 15).join(",") } };
  }
  let ceOI = 0, peOI = 0, rowsMatched = 0;
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    if (c.length <= iOI) continue;
    const sym = c[iSym]?.trim().toUpperCase();
    const fininst = c[iType]?.trim().toUpperCase();
    const opt = c[iOpt]?.trim().toUpperCase();
    if (sym !== "NIFTY") continue;
    if (!/IDX|INDEX|OPTIDX/.test(fininst)) continue;
    const oi = Number(c[iOI]) || 0;
    if (opt === "CE") ceOI += oi;
    else if (opt === "PE") peOI += oi;
    else continue;
    rowsMatched++;
  }
  if (ceOI === 0) return { pcr: null, summary: { rows_matched: rowsMatched, ce_oi: ceOI, pe_oi: peOI } };
  return {
    pcr: Math.round((peOI / ceOI) * 100) / 100,
    summary: { rows_matched: rowsMatched, ce_oi: ceOI, pe_oi: peOI },
  };
}

async function fetchFIIDIITodayRows() {
  const data = await fetchNSEJson("https://www.nseindia.com/api/fiidiiTradeReact");
  if (!Array.isArray(data) || !data.length) throw new Error("empty response");
  return data;
}

function appendToFIIHistory(todayRows) {
  let history = [];
  try {
    history = JSON.parse(readFileSync(FII_HISTORY_PATH, "utf8"));
    if (!Array.isArray(history)) history = [];
  } catch { /* file doesn't exist yet — start fresh */ }

  // Append today's rows if not already in history (key by date+category)
  const seen = new Set(history.map((r) => `${r.date}::${r.category}`));
  for (const r of todayRows) {
    const key = `${r.date}::${r.category}`;
    if (!seen.has(key)) {
      history.push(r);
      seen.add(key);
    }
  }
  // Sort newest-first by date and trim to ~60 days to keep the file bounded
  history.sort((a, b) => new Date(b.date) - new Date(a.date));
  history = history.slice(0, 120);   // up to ~60 days × 2 (FII + DII)

  writeFileSync(FII_HISTORY_PATH, JSON.stringify(history, null, 2) + "\n");
  return history;
}

function computeFIISignal(history) {
  const fiiRows = history.filter((r) => {
    const cat = String(r.category || "").toLowerCase();
    return cat.includes("fii") || cat.includes("fpi") || cat.includes("foreign");
  });
  // Group by date (one row per day) and aggregate netValue
  const byDate = new Map();
  for (const r of fiiRows) {
    const d = r.date;
    const v = Number(r.netValue ?? r.net ?? 0);
    byDate.set(d, (byDate.get(d) || 0) + v);
  }
  // Take latest up to 20 days
  const dates = [...byDate.keys()].sort((a, b) => new Date(b) - new Date(a)).slice(0, 20);
  const days = dates.length;
  if (days < 5) return null;
  const positive = dates.filter((d) => byDate.get(d) > 0).length;
  const pct = positive / days;
  let signal;
  if (pct >= 0.5) signal = "yes";
  else if (pct >= 0.3) signal = "mixed";
  else signal = "no";
  return {
    fii_net_positive_last_20d: signal,
    fii_positive_days: positive,
    fii_total_days: days,
    fii_signal_note: `FII net positive in ${positive} of last ${days} reported trading days (auto-computed from rolling daily snapshots).`,
  };
}

