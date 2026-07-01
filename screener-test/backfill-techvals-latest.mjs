#!/usr/bin/env node
// One-off: add `techPass` (passing technical-rule keys) to the LATEST
// snapshot only, by joining it with today's technicals.json. The latest
// snapshot and technicals.json are the same trading day, so this is
// accurate. Earlier snapshots are intentionally left untouched — we have
// no historical per-indicator data for them, so the Custom Lab backtest
// falls back to composite-only on those days and "accrues forward" as the
// daily writer (write-snapshot.mjs) stamps techPass on each new snapshot.
//
// Purely additive: only the techPass field is added per stock; every
// other field is preserved byte-for-byte by re-serializing the same object.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as techScoring from "../public/js/tech-scoring.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = resolve(__dirname, "../public/data/snapshots");
const TECH_PATH = resolve(__dirname, "../public/data/technicals.json");

const idx = JSON.parse(readFileSync(resolve(SNAP_DIR, "index.json"), "utf8"));
const latest = idx.dates[idx.dates.length - 1];
const snapPath = resolve(SNAP_DIR, `${latest}.json`);
const snap = JSON.parse(readFileSync(snapPath, "utf8"));
const tech = JSON.parse(readFileSync(TECH_PATH, "utf8"));

const techByTicker = new Map((tech.companies || []).map((c) => [String(c.ticker).toUpperCase(), c]));

let withVals = 0;
for (const s of snap.stocks) {
  const tc = s.ticker ? techByTicker.get(String(s.ticker).toUpperCase()) : null;
  let vals = null;
  try { vals = techScoring.techVals(tc); } catch { vals = null; }
  delete s.techPass;   // superseded by the richer techVals record
  s.techVals = vals;
  if (vals) withVals++;
}

writeFileSync(snapPath, JSON.stringify(snap, null, 2));
console.log(`Added techVals to ${latest}: ${withVals}/${snap.stocks.length} stocks have indicator values.`);
