#!/usr/bin/env node
// Impact Cost scraper. NSE publishes a monthly Impact Cost report listing
// the average impact cost (basis points / percent) per stock. The file
// sits in NSE's static archives — URL pattern shifts subtly between
// months (Apr_2024 vs Apr2024, etc.), so we probe a small set of
// candidate URLs across the last few months and use whichever responds
// first. If everything fails the rule stays N/A and we don't regress.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, "../public/data/impact-cost.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NSE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  "Accept": "text/csv, application/octet-stream, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.nseindia.com/products-services/equity-market-impact-cost",
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
  for (const url of [
    "https://www.nseindia.com/",
    "https://www.nseindia.com/products-services/equity-market-impact-cost",
  ]) {
    try {
      const r = await fetch(url, { headers: NSE_HEADERS });
      saveCookies(r);
    } catch { /* ignore */ }
    await sleep(500);
  }
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Walk back from "now" the requested number of months. Each entry is
// { year, monthIdx, abbr } — monthIdx is 0-11 to keep things simple.
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

// Candidate URL patterns NSE has used over the years. We probe each
// against several recent months. First responder wins.
function urlCandidates({ year, abbr }) {
  const A = abbr;
  const a = abbr.toLowerCase();
  return [
    `https://archives.nseindia.com/content/equities/impact_cost/imc_${A}_${year}.csv`,
    `https://nsearchives.nseindia.com/content/equities/impact_cost/imc_${A}_${year}.csv`,
    `https://archives.nseindia.com/content/equities/impact_cost/imc_${A}${year}.csv`,
    `https://nsearchives.nseindia.com/content/equities/impact_cost/imc_${A}${year}.csv`,
    `https://archives.nseindia.com/content/equities/impact_cost/impact_cost_${A}_${year}.csv`,
    `https://nsearchives.nseindia.com/content/equities/impact_cost/impact_cost_${A}_${year}.csv`,
    `https://archives.nseindia.com/content/equities/impact_cost/imc${a}${year}.csv`,
    `https://nsearchives.nseindia.com/content/equities/impact_cost/imc${a}${year}.csv`,
  ];
}

async function tryFetchCSV(url) {
  // Hard 4s deadline per URL. The archives are CDN-served and usually
  // respond in < 500ms when the file exists; anything slower is almost
  // certainly NSE stalling, not a real cache miss.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(url, { headers: { ...NSE_HEADERS, Cookie: cookieJar }, redirect: "follow", signal: ctrl.signal });
    if (!r.ok) return null;
    saveCookies(r);
    const text = await r.text();
    // Reject HTML-error pages or tiny responses (NSE sometimes 200s but
    // returns a JSON error envelope).
    if (!text || text.length < 200) return null;
    if (/^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text)) return null;
    return { url, text };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Parse the CSV. Historical NSE format:
//   Symbol,SECURITY_NAME,Impact_Cost
//   TCS,Tata Consultancy Services Ltd,0.04
// Newer variants sometimes add "Market Cap Tier" or split by orderbook
// size. We're permissive: find the column whose header looks impact-
// cost-ish and use it.
function parseImpactCostCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const headerCols = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const symIdx = headerCols.findIndex((h) => /^symbol$/i.test(h));
  if (symIdx === -1) return null;
  // Pick the impact cost column. Prefer "Impact_Cost" / "Impact Cost",
  // else any column containing the words.
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

async function run() {
  console.log("Initialising NSE session...");
  await initNSESession();

  const months = recentMonths(6);
  console.log(`Probing impact cost archives across the last ${months.length} months: ${months.map((m) => `${m.abbr} ${m.year}`).join(", ")}`);

  let hit = null;
  for (const month of months) {
    if (hit) break;
    for (const url of urlCandidates(month)) {
      process.stdout.write(`  trying ${url} ... `);
      const res = await tryFetchCSV(url);
      if (res) {
        console.log(`OK (${res.text.length} bytes)`);
        const parsed = parseImpactCostCSV(res.text);
        if (parsed) {
          console.log(`  parsed ${Object.keys(parsed).length} tickers`);
          hit = { url: res.url, month, companies: parsed };
          break;
        } else {
          console.log("  parsed 0 tickers — wrong format, trying next URL");
        }
      } else {
        console.log("miss");
      }
      await sleep(250);
    }
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });

  if (!hit) {
    console.log("\nNo impact cost CSV reachable. Writing empty payload — rule stays N/A.");
    writeFileSync(OUT_PATH, JSON.stringify({
      generated_at: new Date().toISOString(),
      source: "NSE archives — all candidate URLs failed",
      period: null,
      companies: {},
    }, null, 2) + "\n");
    process.exit(0);
  }

  const payload = {
    generated_at: new Date().toISOString(),
    source: hit.url,
    period: `${hit.month.abbr} ${hit.month.year}`,
    companies: Object.fromEntries(
      Object.entries(hit.companies).map(([sym, v]) => [sym, { impact_cost_pct: v }])
    ),
  };
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + "\n");
  console.log(`\nWrote ${Object.keys(payload.companies).length} tickers to ${OUT_PATH}`);
  console.log(`Source: ${payload.source}`);
  console.log(`Period: ${payload.period}`);
}

run().catch((err) => {
  console.error("Fatal:", err.stack || err.message);
  // Still write an empty payload so consumers don't see stale data on next run.
  try {
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, JSON.stringify({
      generated_at: new Date().toISOString(),
      source: `error: ${err.message}`,
      period: null,
      companies: {},
    }, null, 2) + "\n");
  } catch { /* ignore */ }
  process.exit(0);
});
