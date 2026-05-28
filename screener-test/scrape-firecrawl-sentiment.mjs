#!/usr/bin/env node
// Sentiment extras scraper via Firecrawl. NSE blocks GitHub Actions runner
// IPs directly, but Firecrawl's residential-proxy + headless-browser stack
// bypasses that. This file handles two NSE-blocked sentiment rules:
//
//   1. Put-Call Ratio  — fetched from NSE's NIFTY option-chain JSON API,
//      with a Trendlyne HTML fallback if NSE refuses.
//   2. Impact Cost     — probed against NSE's monthly archive CSVs
//      (URL pattern shifts month to month, we try ~8 variants × 4 months).
//
// Output: public/data/sentiment-extras.json
//   { pcr: { value, source, fetched_at },
//     impact_cost: { period, source, companies: { TICKER: pct } } }
//
// If Firecrawl returns nothing usable for either, we write the slot as null
// and the rules stay deferred. No regression vs the pre-Firecrawl state.

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "../public/data/sentiment-extras.json");

const API_KEY = process.env.FIRECRAWL_API_KEY;
if (!API_KEY) {
  console.error("FIRECRAWL_API_KEY env var not set. Writing empty payload.");
  writeStub("FIRECRAWL_API_KEY not set");
  process.exit(0);
}

const FIRECRAWL_URL = "https://api.firecrawl.dev/v1/scrape";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wraps the Firecrawl /v1/scrape call. Returns { markdown, html, json, status }
// or null on failure. `formats` is one of ["markdown", "html", "rawHtml"].
// On failure we log the response status + body sample so we can diagnose
// from the workflow log without re-running the API.
async function firecrawl(url, { formats = ["html"], timeoutMs = 45000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(FIRECRAWL_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: ctrl.signal,
      body: JSON.stringify({ url, formats, onlyMainContent: false }),
    });
    const bodyText = await r.text();
    if (!r.ok) {
      console.log(`  Firecrawl HTTP ${r.status} for ${url} — body: ${bodyText.slice(0, 200)}`);
      return null;
    }
    let j;
    try { j = JSON.parse(bodyText); }
    catch (e) {
      console.log(`  Firecrawl non-JSON response for ${url}: ${bodyText.slice(0, 200)}`);
      return null;
    }
    if (!j?.success) {
      console.log(`  Firecrawl success=false for ${url}: ${JSON.stringify(j).slice(0, 300)}`);
      return null;
    }
    const data = j.data || null;
    if (!data) {
      console.log(`  Firecrawl success but data is null for ${url}: ${JSON.stringify(j).slice(0, 300)}`);
    } else {
      const htmlLen = (data.html || "").length;
      const rawLen = (data.rawHtml || "").length;
      const mdLen = (data.markdown || "").length;
      const statusCode = data.metadata?.statusCode || data.metadata?.["sourceURL-status"] || "?";
      console.log(`  Firecrawl OK for ${url} — upstream status=${statusCode}, html=${htmlLen}B rawHtml=${rawLen}B md=${mdLen}B`);
    }
    return data;
  } catch (err) {
    console.log(`  Firecrawl error for ${url}: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 1. Put-Call Ratio ----------

async function fetchPCR() {
  // Path A: NSE's official option-chain JSON. Firecrawl can render the
  // response and return the raw HTML/text — for a JSON endpoint that's
  // the JSON wrapped in a <pre> tag.
  const nseUrl = "https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY";
  console.log("PCR path A: NSE option-chain API via Firecrawl...");
  const r1 = await firecrawl(nseUrl, { formats: ["rawHtml", "html"] });
  if (r1) {
    const raw = r1.rawHtml || r1.html || "";
    console.log(`  Response sample (first 300 chars): ${raw.slice(0, 300)}`);
    // The endpoint returns JSON. Firecrawl may wrap it in <html><body><pre>{...}</pre></body></html>.
    const jsonMatch = raw.match(/\{[\s\S]*"records"[\s\S]*"filtered"[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[0]);
        const rows = data?.filtered?.data || data?.records?.data || [];
        console.log(`  Parsed JSON — ${rows.length} option-chain rows`);
        let totalPE = 0, totalCE = 0;
        for (const row of rows) {
          totalPE += Number(row?.PE?.openInterest || 0);
          totalCE += Number(row?.CE?.openInterest || 0);
        }
        if (totalCE > 0) {
          const pcr = Math.round((totalPE / totalCE) * 100) / 100;
          return { value: pcr, source: "NSE option-chain API (via Firecrawl)", basis: `${totalPE.toLocaleString()} PE / ${totalCE.toLocaleString()} CE` };
        }
        console.log(`  PCR couldn't be computed — totalCE=${totalCE}, totalPE=${totalPE}`);
      } catch (e) {
        console.log("  Could not parse NSE JSON:", e.message);
      }
    } else {
      console.log("  NSE response didn't contain expected JSON structure.");
    }
  }

  // Path B: Trendlyne PCR widget. Simple HTML page that publishes a number.
  console.log("PCR path B: Trendlyne fallback...");
  const tlUrl = "https://trendlyne.com/macro-data/derivatives/pcr/nifty/";
  const r2 = await firecrawl(tlUrl, { formats: ["markdown", "html"] });
  if (r2) {
    const md = (r2.markdown || "");
    const html = (r2.html || "");
    console.log(`  Markdown sample (first 300 chars): ${md.slice(0, 300)}`);
    // Try multiple regex patterns — Trendlyne's page layout has changed
    // a few times in the past.
    const patterns = [
      /(?:Nifty\s*PCR|Put[-\s]Call\s*Ratio)[^0-9]{0,30}(\d+\.\d{1,3})/i,
      /(?:PCR|put.call.ratio)\D{0,20}(\d+\.\d{1,3})/i,
      /(\d+\.\d{1,3})\s*(?:PCR|Put.Call)/i,
    ];
    const text = md + "\n" + html;
    for (const pat of patterns) {
      const m = text.match(pat);
      if (m) {
        const pcr = Number(m[1]);
        if (pcr > 0 && pcr < 5) {
          console.log(`  Matched pattern: ${pat} -> ${pcr}`);
          return { value: pcr, source: "Trendlyne (via Firecrawl)", basis: "page scrape" };
        }
      }
    }
    console.log("  None of the Trendlyne regex patterns matched.");
  }

  // Path C: Sensibull NIFTY page — alternative public source for PCR.
  console.log("PCR path C: Sensibull fallback...");
  const sbUrl = "https://www.sensibull.com/screeners/pcr";
  const r3 = await firecrawl(sbUrl, { formats: ["markdown", "html"] });
  if (r3) {
    const text = (r3.markdown || "") + "\n" + (r3.html || "");
    console.log(`  Sensibull sample (first 300 chars): ${text.slice(0, 300)}`);
    // Sensibull tables show "NIFTY 50  ...  1.03" - grab the number near "NIFTY 50".
    const m = text.match(/NIFTY\s*50[^0-9]{0,80}(\d+\.\d{2,3})/i);
    if (m) {
      const pcr = Number(m[1]);
      if (pcr > 0 && pcr < 5) {
        return { value: pcr, source: "Sensibull (via Firecrawl)", basis: "screener table" };
      }
    }
  }

  return null;
}

// ---------- 2. Impact Cost ----------

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function recentMonths(count) {
  const out = [];
  const now = new Date();
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth();
  for (let i = 0; i < count; i++) {
    out.push({ year: y, monthIdx: m, abbr: MONTH_ABBR[m] });
    m--;
    if (m < 0) { m = 11; y--; }
  }
  return out;
}

function urlCandidates({ year, abbr }) {
  const A = abbr;
  const a = abbr.toLowerCase();
  return [
    `https://archives.nseindia.com/content/equities/impact_cost/imc_${A}_${year}.csv`,
    `https://nsearchives.nseindia.com/content/equities/impact_cost/imc_${A}_${year}.csv`,
    `https://archives.nseindia.com/content/equities/impact_cost/imc_${A}${year}.csv`,
    `https://nsearchives.nseindia.com/content/equities/impact_cost/imc_${A}${year}.csv`,
    `https://archives.nseindia.com/content/equities/impact_cost/imc${a}${year}.csv`,
    `https://nsearchives.nseindia.com/content/equities/impact_cost/imc${a}${year}.csv`,
  ];
}

function parseImpactCostCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const headerCols = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const symIdx = headerCols.findIndex((h) => /^symbol$/i.test(h));
  if (symIdx === -1) return null;
  let icIdx = headerCols.findIndex((h) => /^impact[_\s]?cost$/i.test(h));
  if (icIdx === -1) icIdx = headerCols.findIndex((h) => /impact.*cost/i.test(h));
  if (icIdx === -1) return null;
  const out = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const sym = cols[symIdx]?.toUpperCase();
    const raw = cols[icIdx];
    if (!sym || !raw) continue;
    const v = parseFloat(raw.replace(/[^0-9.\-]/g, ""));
    if (!Number.isFinite(v)) continue;
    out[sym] = v;
  }
  return Object.keys(out).length ? out : null;
}

async function fetchImpactCost() {
  // Budget: don't burn many Firecrawl credits chasing this. Try the most
  // likely months (recent 4) with the 4 most common URL patterns each.
  // Stop on first parseable response.
  const months = recentMonths(4);
  console.log(`Impact cost: probing months ${months.map(m => m.abbr+" "+m.year).join(", ")}`);
  for (const month of months) {
    for (const url of urlCandidates(month).slice(0, 4)) {
      console.log(`  via Firecrawl: ${url}`);
      const res = await firecrawl(url, { formats: ["rawHtml"], timeoutMs: 30000 });
      if (!res) { continue; }
      const text = res.rawHtml || "";
      console.log(`    body length: ${text.length}, first 200 chars: ${text.slice(0, 200).replace(/\n/g, " ")}`);
      if (!text || text.length < 200) {
        console.log("    empty body");
        continue;
      }
      if (/<!doctype html/i.test(text.slice(0, 50))) {
        console.log("    body is HTML — wrong format for a CSV endpoint");
        continue;
      }
      const parsed = parseImpactCostCSV(text);
      if (parsed) {
        console.log(`    PARSED: ${Object.keys(parsed).length} tickers`);
        return {
          period: `${month.abbr} ${month.year}`,
          source: url,
          companies: Object.fromEntries(Object.entries(parsed).map(([s, v]) => [s, v])),
        };
      }
      console.log("    got body, couldn't parse as Impact Cost CSV");
      await sleep(200);
    }
  }
  return null;
}

// ---------- main ----------

function writeStub(reason) {
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify({
    generated_at: new Date().toISOString(),
    pcr: null,
    impact_cost: null,
    error: reason,
  }, null, 2) + "\n");
}

async function main() {
  // Read existing file to preserve any previous successful values if
  // today's fetch happens to fail (PCR especially — yesterday's value
  // is far more useful than null).
  let prev = {};
  try { prev = JSON.parse(readFileSync(OUT_PATH, "utf8")); } catch { /* first run */ }

  const out = {
    generated_at: new Date().toISOString(),
    pcr: null,
    impact_cost: null,
  };

  const pcr = await fetchPCR();
  if (pcr) {
    out.pcr = { ...pcr, fetched_at: new Date().toISOString() };
    console.log(`PCR: ${pcr.value} (${pcr.source})`);
  } else if (prev.pcr) {
    out.pcr = { ...prev.pcr, stale: true };
    console.log(`PCR fetch failed — retained yesterday's value ${prev.pcr.value} (marked stale).`);
  } else {
    console.log("PCR: both paths failed and no cached value to fall back on.");
  }

  const impact = await fetchImpactCost();
  if (impact) {
    out.impact_cost = { ...impact, fetched_at: new Date().toISOString() };
    console.log(`Impact cost: ${Object.keys(impact.companies).length} tickers (period ${impact.period})`);
  } else if (prev.impact_cost) {
    out.impact_cost = { ...prev.impact_cost, stale: true };
    console.log(`Impact cost fetch failed — retained previous (${prev.impact_cost.period}, ${Object.keys(prev.impact_cost.companies || {}).length} tickers, marked stale).`);
  } else {
    console.log("Impact cost: all probes missed and no cached value.");
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nWrote: ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("Fatal:", err.stack || err.message);
  writeStub(err.message);
  process.exit(0);
});
