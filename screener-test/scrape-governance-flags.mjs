#!/usr/bin/env node
// Governance flags scraper. Hits SEBI's enforcement orders and press
// releases via Firecrawl + LLM extract, pulls out the NSE listed
// companies named as noticees / respondents in active proceedings,
// fuzzily matches to NSE 500 tickers, and writes a per-ticker flag
// map. The Fundamentals "Governance Issues" rule reads this file to
// hard-fail companies with active SEBI cases.
//
// Cost budget: ~10-20 Firecrawl credits per weekly run.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENER_PATH = resolve(__dirname, "../public/data/screener-companies.json");
const OUT_PATH      = resolve(__dirname, "../public/data/governance-flags.json");

const FIRECRAWL_URL = "https://api.firecrawl.dev/v1/scrape";
const API_KEY = process.env.FIRECRAWL_API_KEY;

if (!API_KEY) {
  console.error("FIRECRAWL_API_KEY env var not set — writing empty flags file.");
  writeStub("FIRECRAWL_API_KEY not set");
  process.exit(0);
}

// Source URLs. SEBI's site is structured around chronological order
// archives; the orders page is the primary one. We hit a small set so
// the Firecrawl bill stays sane.
const SOURCES = [
  { url: "https://www.sebi.gov.in/enforcement/orders.html", label: "SEBI — orders listing" },
  { url: "https://www.sebi.gov.in/sebi_data/recent.html", label: "SEBI — recent activity" },
  // Previous URL (/media/press-releases.html) returned upstream 404.
  // Try a couple of working alternates.
  { url: "https://www.sebi.gov.in/media-and-notifications/press-releases.html", label: "SEBI — press releases (new path)" },
  { url: "https://www.sebi.gov.in/enforcement/adjudication-orders.html", label: "SEBI — adjudication orders" },
];

// LLM extract schema. The "is_listed_entity" + "is_active_proceeding"
// flags do the filtering work — SEBI orders mention many companies as
// third parties (auditors, banks, etc.) but only the noticees are
// what we want to flag.
const SCHEMA = {
  type: "object",
  properties: {
    flagged_entities: {
      type: "array",
      description: "Any Indian COMPANY (not individual person) mentioned on this page in a SEBI enforcement context — orders, adjudications, settlement notices, show-cause notices, investigations, appeals, press releases about action against the entity. The page is from sebi.gov.in. Include every company appearing as the subject (noticee / respondent / party) of SEBI action even if the order looks recent or concluded — we'll do our own filtering downstream. EXCLUDE individuals (people named in their personal capacity, like 'Mr. ABC'). EXCLUDE foreign companies. EXCLUDE third-party mentions that are clearly just contextual (auditors, banks named as regulators only).",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Company name as written, e.g. 'Reliance Industries Ltd.'" },
          order_type: { type: "string", description: "Best guess: adjudication | settlement | show-cause | investigation | appeal | press-release | other" },
          is_listed_entity: { type: "boolean", description: "true if the entity looks like a publicly listed Indian company (most have Ltd / Limited suffix)" },
          is_active_proceeding: { type: "boolean", description: "true if the matter looks like it is currently active (not fully closed and settled). When ambiguous, default to true." },
          context_snippet: { type: "string", description: "10-30 word snippet describing what SEBI is doing about this company" },
        },
        required: ["name", "is_listed_entity"],
      },
    },
  },
  required: ["flagged_entities"],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEBUG_PER_SOURCE = [];

async function firecrawlExtract(url, label) {
  console.log(`  Firecrawl LLM extract on: ${url}`);
  const entry = { url, label, at: new Date().toISOString() };
  try {
    const r = await fetch(FIRECRAWL_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["json"],
        jsonOptions: { schema: SCHEMA },
        onlyMainContent: false,
      }),
    });
    entry.fc_status = r.status;
    const text = await r.text();
    if (!r.ok) {
      entry.outcome = "fc_http_error";
      entry.error_body = text.slice(0, 300);
      console.log(`    Firecrawl HTTP ${r.status}: ${text.slice(0, 200)}`);
      DEBUG_PER_SOURCE.push(entry);
      return [];
    }
    let j;
    try { j = JSON.parse(text); }
    catch {
      entry.outcome = "non_json_response";
      entry.error_body = text.slice(0, 300);
      DEBUG_PER_SOURCE.push(entry);
      return [];
    }
    const data = j?.data || null;
    const extract = data?.json || data?.llm_extraction || data?.extract || {};
    const items = Array.isArray(extract.flagged_entities) ? extract.flagged_entities : [];
    entry.outcome = "ok";
    entry.upstream_status = data?.metadata?.statusCode || null;
    entry.total_extracted = items.length;
    // Save BEFORE-filter samples too — when post-filter is 0 this is the
    // only way to see what the LLM actually extracted and why we
    // rejected it.
    entry.prefilter_sample = items.slice(0, 15).map((it) => ({
      name: it.name,
      order_type: it.order_type,
      is_listed_entity: it.is_listed_entity,
      is_active_proceeding: it.is_active_proceeding,
      snippet: (it.context_snippet || "").slice(0, 150),
    }));
    // Filter to LISTED + ACTIVE before counting.
    const filtered = items.filter((it) => it.is_listed_entity !== false && it.is_active_proceeding !== false);
    entry.after_filter_count = filtered.length;
    entry.sample = filtered.slice(0, 10).map((it) => ({ name: it.name, order_type: it.order_type, snippet: (it.context_snippet || "").slice(0, 100) }));
    console.log(`    Extracted ${items.length} entities, ${filtered.length} after listed+active filter`);
    DEBUG_PER_SOURCE.push(entry);
    return filtered;
  } catch (err) {
    entry.outcome = "fetch_error";
    entry.error = err.message;
    console.log(`    Error: ${err.message}`);
    DEBUG_PER_SOURCE.push(entry);
    return [];
  }
}

// ---------- Fuzzy name → ticker matcher (same approach as PLI refresh) ----------

function buildNameMap(screener) {
  const map = new Map();
  for (const c of screener) {
    const fullName = String(c.Company || "");
    const m = String(c["Screener URL"] || "").match(/\/company\/([^/]+)/);
    if (!m) continue;
    const ticker = m[1].toUpperCase();
    const variants = generateNameVariants(fullName);
    for (const v of variants) map.set(v, ticker);
  }
  return map;
}

function normaliseName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\b(ltd|limited|pvt|private|corporation|corp|inc|company|co|the|of|and|&)\b/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function generateNameVariants(name) {
  const out = new Set();
  const n = normaliseName(name);
  if (!n) return out;
  out.add(n);
  out.add(n.replace(/\s+/g, ""));
  const parts = n.split(/\s+/);
  if (parts.length >= 2) {
    out.add(parts.slice(0, 2).join(" "));
    out.add(parts.slice(0, 2).join(""));
  }
  if (parts.length >= 3) out.add(parts.slice(0, 3).join(" "));
  const noSpace = n.replace(/\s+/g, "");
  if (noSpace.length >= 8) out.add(noSpace.slice(0, 8));
  return out;
}

function resolveTicker(rawName, nameMap) {
  const variants = generateNameVariants(rawName);
  for (const v of variants) {
    if (nameMap.has(v)) return nameMap.get(v);
  }
  return null;
}

// ---------- main ----------

function writeStub(reason) {
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify({
    generated_at: new Date().toISOString(),
    flagged_companies: {},
    error: reason,
  }, null, 2) + "\n");
}

async function main() {
  console.log("Loading Nifty 500 universe...");
  const screener = JSON.parse(readFileSync(SCREENER_PATH, "utf8"));
  const nameMap = buildNameMap(screener);
  console.log(`Built ticker map with ${nameMap.size} name variants for ${screener.length} companies.\n`);

  // Pull entities from every source. We keep ALL entities (not just the
  // matched ones) for the diagnostic file so we can audit unmatched
  // candidates later.
  const allEntities = [];
  for (const src of SOURCES) {
    const items = await firecrawlExtract(src.url, src.label);
    for (const it of items) allEntities.push({ ...it, _source: src.label, _url: src.url });
    await sleep(400);
  }

  console.log(`\nTotal entities collected across all sources: ${allEntities.length}`);

  // Match each to NSE 500 ticker; keep the first match per ticker so
  // the resulting map is deduped. Later mentions of the same company
  // append to a "mentions" array on the flag entry for audit.
  const flagged = {};
  const unmatched = [];
  for (const e of allEntities) {
    const ticker = resolveTicker(e.name, nameMap);
    if (!ticker) {
      unmatched.push({ name: e.name, type: e.order_type, source: e._source });
      continue;
    }
    if (!flagged[ticker]) {
      flagged[ticker] = {
        primary_name: e.name,
        order_type: e.order_type || null,
        snippet: e.context_snippet || null,
        source_url: e._url,
        source_label: e._source,
        mentions: [],
        first_seen_at: new Date().toISOString(),
      };
    }
    flagged[ticker].mentions.push({
      source: e._source,
      order_type: e.order_type || null,
      snippet: (e.context_snippet || "").slice(0, 200),
    });
  }

  console.log(`Matched ${Object.keys(flagged).length} flagged tickers from ${allEntities.length} entities (${unmatched.length} unmatched).`);
  if (Object.keys(flagged).length) {
    console.log("Flagged tickers:");
    Object.entries(flagged).forEach(([t, v]) => console.log(`  ${t.padEnd(15)} — ${v.primary_name} (${v.order_type || "unknown type"})`));
  }

  const payload = {
    generated_at: new Date().toISOString(),
    source_count: SOURCES.length,
    total_entities_seen: allEntities.length,
    flagged_companies: flagged,
    unmatched_sample: unmatched.slice(0, 30),
    sources: DEBUG_PER_SOURCE,
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2) + "\n");
  console.log(`\nWrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error("Fatal:", err.stack || err.message);
  writeStub(err.message);
  process.exit(0);
});
