#!/usr/bin/env node
// One-off BSE-code backfill — for companies whose Screener URL slug is
// an NSE ticker (so we don't have their BSE numeric scrip code in our
// data). Visits each Screener company page with Playwright, scrapes the
// BSE code from the page header, writes a static supplement file the
// to-do generator reads from.
//
// Why this exists: the routine input format is "Name, BSECode" but
// the BSE T+1 file we used to populate the initial codes (Nov 2021)
// is missing ~119 post-2021 listings. This script fills those in.
//
// Cost: 0 (uses existing SCREENER_EMAIL/SCREENER_PASSWORD secrets,
// runs on GH Actions, no external API). Runtime: ~10 min for 119 pages.

import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENER_PATH = resolve(__dirname, "../public/data/screener-companies.json");
const OUT_PATH      = resolve(__dirname, "static/bse-codes-supplement.json");

const ORIGIN = "https://www.screener.in";
const EMAIL = process.env.SCREENER_EMAIL;
const PASSWORD = process.env.SCREENER_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error("SCREENER_EMAIL or SCREENER_PASSWORD env not set — aborting.");
  process.exit(1);
}

const screener = JSON.parse(readFileSync(SCREENER_PATH, "utf8"));

// Pull existing supplement so we don't redo work across runs.
let supplement = {};
if (existsSync(OUT_PATH)) {
  try { supplement = JSON.parse(readFileSync(OUT_PATH, "utf8")).codes || {}; }
  catch { supplement = {}; }
}

// Build the to-do list: companies whose URL slug isn't a numeric BSE
// code AND aren't in the supplement yet.
const toFetch = [];
for (const c of screener) {
  const m = String(c["Screener URL"] || "").match(/\/company\/([^/]+)/);
  if (!m) continue;
  const slug = m[1].toUpperCase();
  if (/^\d+$/.test(slug)) continue;             // already a BSE code
  if (supplement[slug]) continue;                // already backfilled
  toFetch.push({ name: c.Company, slug, url: c["Screener URL"] });
}
console.log(`Need to backfill ${toFetch.length} of ${screener.length} companies.`);

if (toFetch.length === 0) {
  console.log("Nothing to do — supplement already covers everything.");
  process.exit(0);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" });
const page = await ctx.newPage();

// Login (same flow as scrape.mjs)
console.log("Logging into Screener...");
await page.goto(`${ORIGIN}/login/`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.fill('input[name="username"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await Promise.all([
  page.waitForNavigation({ timeout: 60000 }),
  page.click('button[type="submit"]'),
]);
console.log("Logged in.");

let done = 0, errors = 0, found = 0;
const MAX = Number(process.env.MAX_BACKFILL || 0);   // 0 = no cap
const limit = MAX > 0 ? Math.min(MAX, toFetch.length) : toFetch.length;

for (let i = 0; i < limit; i++) {
  const c = toFetch[i];
  process.stdout.write(`[${i + 1}/${limit}] ${c.name.padEnd(28).slice(0, 28)} `);
  try {
    await page.goto(c.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    // BSE code shown in the company header — pattern: "BSE: 500325"
    const bseCode = await page.evaluate(() => {
      const text = document.body.innerText || "";
      const m = text.match(/\bBSE\s*:\s*(\d{5,8})\b/);
      return m ? m[1] : null;
    });
    if (bseCode) {
      supplement[c.slug] = bseCode;
      found++;
      console.log(`✓ ${bseCode}`);
    } else {
      console.log("✗ no BSE code on page (likely NSE-only or page changed)");
    }
    done++;
    // Throttle — be polite to Screener
    await page.waitForTimeout(400);
  } catch (err) {
    errors++;
    console.log(`ERR: ${err.message.slice(0, 80)}`);
  }
}

await browser.close();

writeFileSync(OUT_PATH, JSON.stringify({
  generated_at: new Date().toISOString(),
  source: "Screener company-page header (scraped via Playwright)",
  total_codes: Object.keys(supplement).length,
  codes: supplement,
}, null, 2) + "\n");

console.log(`\nDone. ${done} visited, ${found} BSE codes captured, ${errors} errors.`);
console.log(`Supplement now covers ${Object.keys(supplement).length} NSE-symbol slugs.`);
console.log(`Wrote ${OUT_PATH}`);
