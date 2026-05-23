#!/usr/bin/env node
// Screener.in screen scraper (headless-browser version).
// Screener injects custom ribbon ratios via JavaScript, so a plain fetch
// only sees the 9 default ratios. This uses Playwright (headless Chrome)
// to render each page fully before extracting.
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import * as cheerio from "cheerio";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "output");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ORIGIN = "https://www.screener.in";

const EMAIL = process.env.SCREENER_EMAIL;
const PASSWORD = process.env.SCREENER_PASSWORD;
const screenUrl = process.env.SCREEN_URL || "https://www.screener.in/screens/3675531/fundareal-klp-final/";
const maxPages = Number(process.env.MAX_PAGES || "30");
const maxCompanies = Number(process.env.MAX_COMPANIES || "0"); // 0 = all

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

run().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});

async function run() {
  if (!EMAIL || !PASSWORD) throw new Error("Set SCREENER_EMAIL + SCREENER_PASSWORD in repo secrets.");
  mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ userAgent: UA });
  const page = await context.newPage();

  try {
    console.log("Logging in to Screener...");
    await loginViaBrowser(page);
    console.log("Login OK.\n");

    const base = screenUrl.split("?")[0].replace(/\/+$/, "");
    const companies = await fetchScreenCompanies(page, base);
    console.log(`\nScreen returned ${companies.length} companies.`);
    if (!companies.length) throw new Error("Screen returned no companies.");

    const limit = maxCompanies > 0 ? Math.min(maxCompanies, companies.length) : companies.length;
    console.log(`Scraping ${limit} company pages...\n`);

    const rows = [];
    const allKeys = new Set(["Company", "Screener URL"]);
    let failures = 0;

    for (let i = 0; i < limit; i++) {
      const c = companies[i];
      process.stdout.write(`[${i + 1}/${limit}] ${c.name} ... `);
      try {
        const data = await fetchCompanyData(page, c.path, i === 0);
        const row = { Company: c.name, "Screener URL": `${ORIGIN}${c.path}`, ...data };
        Object.keys(data).forEach((k) => allKeys.add(k));
        rows.push(row);
        console.log(`${Object.keys(data).length} fields`);
      } catch (err) {
        failures++;
        rows.push({ Company: c.name, "Screener URL": `${ORIGIN}${c.path}`, Error: err.message });
        console.log(`FAILED: ${err.message}`);
      }
      await sleep(300);
    }

    const headers = [...allKeys];
    const csv = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ""))]
      .map((line) => line.map(csvCell).join(","))
      .join("\n");
    writeFileSync(resolve(OUT_DIR, "screener-companies.csv"), csv + "\n");
    writeFileSync(resolve(OUT_DIR, "screener-companies.json"), JSON.stringify(rows, null, 2) + "\n");

    console.log("\n=== Done ===");
    console.log(`Companies scraped: ${rows.length} (${failures} failed)`);
    console.log(`Columns found: ${headers.length}`);
    console.log(`Columns: ${headers.join(" | ")}`);
  } finally {
    await browser.close();
  }
}

async function loginViaBrowser(page) {
  await page.goto(`${ORIGIN}/login/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.fill('input[name="username"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await Promise.all([
    page.waitForLoadState("domcontentloaded").catch(() => {}),
    page.click('button[type="submit"]')
  ]);
  await page.waitForTimeout(1500);
  const html = await page.content();
  if (!/\/logout\//.test(html)) {
    throw new Error("Login failed — check SCREENER_EMAIL / SCREENER_PASSWORD.");
  }
}

async function fetchScreenCompanies(page, base) {
  const companies = [];
  const seen = new Set();
  let totalPages = 1;

  for (let p = 1; p <= maxPages; p++) {
    process.stdout.write(`Reading screen page ${p} ... `);
    await page.goto(`${base}/?page=${p}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const $ = cheerio.load(await page.content());
    const table = $("table.data-table").first();
    if (!table.length) {
      console.log("no table");
      if (p === 1) throw new Error("No data table on screen page 1.");
      break;
    }
    let added = 0;
    table.find("tbody tr").each((_, tr) => {
      const link = $(tr).find("td a[href^='/company/']").first();
      const href = link.attr("href");
      if (href && !seen.has(href)) {
        seen.add(href);
        companies.push({ name: link.text().trim().replace(/\s+/g, " "), path: href });
        added++;
      }
    });
    const m = $("body").text().match(/page\s+\d+\s+of\s+(\d+)/i);
    if (m) totalPages = Number(m[1]);
    console.log(`${added} companies (page ${p} of ${totalPages})`);
    if (p >= totalPages) break;
    await sleep(300);
  }
  return companies;
}

async function fetchCompanyData(page, path, debug = false) {
  await page.goto(`${ORIGIN}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  // Wait for JS to inject custom ribbon ratios (defaults are 9).
  await page
    .waitForFunction(() => document.querySelectorAll("#top-ratios li").length > 9, { timeout: 12000 })
    .catch(() => {});
  await page.waitForTimeout(800);

  const html = await page.content();
  if (debug) {
    writeFileSync(resolve(OUT_DIR, "_debug-first-company.html"), html);
  }
  const $ = cheerio.load(html);

  const data = {};
  $("#top-ratios li").each((_, li) => {
    const name = $(li).find(".name").text().trim().replace(/\s+/g, " ");
    const value = $(li).find(".value").text().trim().replace(/\s+/g, " ");
    if (name) data[name] = cleanValue(value);
  });
  if (!Object.keys(data).length) throw new Error("no #top-ratios block found");

  const npq = parseSectionRow($, "#quarters", /^net profit/i);
  if (npq && npq.values.length) {
    const last4 = npq.values.slice(-4);
    data["Net Profit Qtr (latest)"] = last4[3] ?? "";
    data["Net Profit Qtr (-1)"] = last4[2] ?? "";
    data["Net Profit Qtr (-2)"] = last4[1] ?? "";
    data["Net Profit Qtr (-3)"] = last4[0] ?? "";
  }

  const cf = parseSectionRow($, "#cash-flow", /cash from operating/i);
  if (cf && cf.values.length) {
    const yearly = cf.headers
      .map((h, i) => ({ h, v: cf.values[i] }))
      .filter((p) => p.v !== undefined && !/ttm/i.test(p.h))
      .map((p) => p.v);
    data["CF Operations LY"] = yearly[yearly.length - 1] ?? "";
    data["CF Operations PY"] = yearly[yearly.length - 2] ?? "";
  }

  const opm = parseSectionRow($, "#profit-loss", /^opm\s*%/i);
  if (opm && opm.values.length) {
    const nums = opm.headers
      .map((h, i) => ({ h, v: opm.values[i] }))
      .filter((p) => p.v !== undefined && !/ttm/i.test(p.h))
      .map((p) => parseFloat(String(p.v).replace(/[^0-9.\-]/g, "")))
      .filter((n) => Number.isFinite(n));
    const last5 = nums.slice(-5);
    data["OPM 5Year %"] = last5.length
      ? (last5.reduce((a, b) => a + b, 0) / last5.length).toFixed(2)
      : "";
  }

  return data;
}

function parseSectionRow($, sectionSel, labelRegex) {
  const table = $(`${sectionSel} table`).first();
  if (!table.length) return null;
  const headers = [];
  table.find("thead th").each((_, th) => headers.push($(th).text().trim().replace(/\s+/g, " ")));
  let result = null;
  table.find("tbody tr").each((_, tr) => {
    if (result) return;
    const cells = $(tr).find("td");
    const label = $(cells[0]).text().trim().replace(/\s+/g, " ");
    if (labelRegex.test(label)) {
      const values = [];
      cells.each((i, td) => {
        if (i > 0) values.push($(td).text().trim().replace(/\s+/g, " "));
      });
      result = { headers: headers.slice(1), values };
    }
  });
  return result;
}

function cleanValue(v) {
  return String(v || "").replace(/\s+/g, " ").replace(/^₹\s*/, "").trim();
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
