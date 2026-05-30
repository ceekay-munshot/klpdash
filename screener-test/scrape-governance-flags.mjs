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
// Sources. We switched from SEBI-only after the May 30 diagnostic run:
//
//   - SEBI's enforcement/orders.html listing page works (200 OK) but
//     the listing itself doesn't carry noticee names — only order titles
//     + PDF links. We'd need to drill into individual PDFs (~50 extra
//     Firecrawl calls/week) to get company names from SEBI directly.
//   - Three other SEBI URLs we tried (recent.html, two press-release
//     paths, adjudication-orders.html) all returned upstream 404.
//   - Worse, the LLM hallucinated "XYZ Industries Ltd / ABC Fintech Ltd"
//     etc. when fed an empty 404 page. The hallucination guard below
//     now rejects any Firecrawl response with upstream_status != 200.
//
// New strategy: BSE + NSE Corporate Announcements. Under SEBI LODR
// regulations, listed companies must disclose SEBI inquiries /
// investigations / show-cause notices to BSE and NSE within 24 hours.
// That's a much cleaner stream of governance signal:
//   - Real disclosures published by the company itself (no third-party
//     hearsay)
//   - Direct link between disclosure and ticker
//   - Easier for the LLM to spot (the disclosure subject line typically
//     contains "Disclosure under Reg 30 of SEBI LODR" + nature)
//
// We retain SEBI's orders.html as a low-priority backup; if the listing
// gains noticee data in future or has a parseable structure we don't
// see today, the LLM will surface it.
const SOURCES = [
  { url: "https://www.bseindia.com/corporates/ann.html", label: "BSE — corporate announcements (recent)" },
  { url: "https://www.bseindia.com/markets/MarketInfo/PressRelease.aspx", label: "BSE — press releases" },
  { url: "https://www.nseindia.com/companies-listing/corporate-filings-announcements", label: "NSE — corporate filings & announcements" },
  { url: "https://www.sebi.gov.in/enforcement/orders.html", label: "SEBI — orders listing (backup)" },
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
      description: "Listed Indian companies on this page that have disclosed (under SEBI LODR Reg 30) or been the subject of a SEBI action involving WRONGDOING. INCLUDE ONLY entries where the page text clearly contains at least one of: 'SEBI', 'show-cause', 'adjudication', 'investigation', 'enforcement', 'violation', 'penalty', 'insider trading', 'fraud', 'misrepresentation', 'consent order', 'noticee', 'WTM order', 'AO order'. STRICTLY EXCLUDE all routine corporate filings — these are NOT governance issues even though they appear on the same announcements feed: outcome of board meeting, board-meeting intimation, quarterly / annual financial results, audited results, dividend declaration / record date, AGM / EGM notice, change in director / KMP, allotment of securities, code of conduct, newspaper publication of results, transfer of unclaimed dividend, related-party transactions report, registered office change, postal ballot, scheme of arrangement, ESOP allotment, voting results, share transfer, statement of investor complaints. STRICTLY EXCLUDE individuals named in their personal capacity. STRICTLY EXCLUDE foreign companies. EMPTY OK: if the page shows only routine filings or is an error page, return an empty array — DO NOT invent placeholder names ('XYZ Industries', 'ABC Limited' etc.) just to populate the schema.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Exact company name as written on the page. Must be a name actually present in the source page content." },
          order_type: { type: "string", description: "Best guess from this list ONLY: sebi-inquiry | sebi-investigation | show-cause | adjudication | settlement | lodr-violation-disclosure | enforcement-order | other. Do NOT use this field for routine filing categories like 'board meeting' or 'result'." },
          is_listed_entity: { type: "boolean", description: "true if the entity looks like a publicly listed Indian company" },
          is_active_proceeding: { type: "boolean", description: "true if the matter looks active. When ambiguous, default to true." },
          context_snippet: { type: "string", description: "10-30 word VERBATIM snippet from the page that contains the SEBI / violation / penalty / investigation keyword. Required for the entry to be valid — if you can't quote that, do not include this entity." },
        },
        required: ["name", "is_listed_entity", "context_snippet"],
      },
    },
  },
  required: ["flagged_entities"],
};

// Post-LLM safety net: even with the prompt tightened, the model
// sometimes still labels routine filings as "lodr-violation". Reject
// entries whose order_type or snippet smells routine.
const ROUTINE_TYPE_RE = /^(result|outcome|board\s*meeting|board\s*update|company\s*update|dividend|agm|egm|scheme|allotment|esop|voting|share\s*transfer|director\s*change|change\s*in\s*kmp|code\s*of\s*conduct|registered\s*office|newspaper)/i;
const SEBI_SIGNAL_RE = /\b(sebi|show[- ]?cause|adjudicat\w+|investigat\w+|enforcement|violation|penalty|insider[- ]?trading|fraud|misrepresent\w+|consent\s+order|noticee|wtm\s+order|ao\s+order)\b/i;

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
    let items = Array.isArray(extract.flagged_entities) ? extract.flagged_entities : [];
    entry.outcome = "ok";
    entry.upstream_status = data?.metadata?.statusCode || null;
    entry.total_extracted_raw = items.length;

    // Hallucination guard #1: Firecrawl says it succeeded but the
    // upstream URL returned a 4xx/5xx. The LLM was extracting names
    // from SEBI's HTML 404 page in the previous run and inventing
    // placeholders like "XYZ Industries Ltd." to satisfy the schema.
    // Reject the whole response when upstream is not 200.
    if (entry.upstream_status && entry.upstream_status !== 200) {
      entry.dropped_reason = `upstream_status=${entry.upstream_status} — refusing LLM output to avoid hallucination`;
      items = [];
    }

    // Hallucination guard #2: classic placeholder patterns. The LLM has
    // been observed to emit "XYZ Industries", "ABC Fintech", "LMN Corp"
    // etc. when the page has no real content. Strip any entity whose
    // name reads like a textbook example.
    const PLACEHOLDER = /\b(XYZ|ABC|LMN|PQR|Foo|Bar|Sample|Example|Placeholder)\b/i;
    const filteredOutPlaceholders = items.filter((it) => PLACEHOLDER.test(String(it.name || "")));
    if (filteredOutPlaceholders.length) {
      entry.dropped_placeholders = filteredOutPlaceholders.map((it) => it.name);
      items = items.filter((it) => !PLACEHOLDER.test(String(it.name || "")));
    }
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
    // Filter: must be listed + active. Then run the safety net to
    // drop routine corporate filings the LLM mislabelled as
    // governance issues (BSE / NSE announcement pages are flooded
    // with board-meeting / financial-result / dividend filings —
    // the prior run flagged every single one of them).
    const dropped = { not_listed: 0, not_active: 0, routine_type: 0, no_sebi_signal: 0 };
    const filtered = items.filter((it) => {
      if (it.is_listed_entity === false) { dropped.not_listed++; return false; }
      if (it.is_active_proceeding === false) { dropped.not_active++; return false; }
      const type = String(it.order_type || "").trim();
      const snippet = String(it.context_snippet || "");
      if (type && ROUTINE_TYPE_RE.test(type)) { dropped.routine_type++; return false; }
      // The snippet has to mention SEBI / violation / show-cause /
      // adjudication / etc. — if the LLM couldn't quote SEBI-specific
      // language from the page, this isn't a real governance flag.
      if (!SEBI_SIGNAL_RE.test(snippet) && !SEBI_SIGNAL_RE.test(type)) { dropped.no_sebi_signal++; return false; }
      return true;
    });
    entry.after_filter_count = filtered.length;
    entry.dropped_counts = dropped;
    entry.sample = filtered.slice(0, 10).map((it) => ({ name: it.name, order_type: it.order_type, snippet: (it.context_snippet || "").slice(0, 100) }));
    console.log(`    Extracted ${items.length} entities, ${filtered.length} after governance-signal filter (dropped: ${JSON.stringify(dropped)})`);
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
