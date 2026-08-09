#!/usr/bin/env node
// End-of-day close correction for the daily snapshot.
//
// The snapshot is WRITTEN in the morning (05:53 IST, pre-market). That timing
// is deliberate for the SCORES: the composite / rating / AI top-7 are based
// only on data known before the session opens, so the AI basket never picks
// with look-ahead. But it also means each stock's `close` starts as the
// PREVIOUS session's close (the newest one Yahoo has pre-market) — so a
// Friday snapshot written Friday morning holds Thursday's close, and the
// dashboard reads a day-old price until the next run.
//
// This job runs AFTER market close and overwrites ONLY the `close` field with
// today's ACTUAL close. Nothing else is touched — composites, ratings, picks,
// per-indicator values all stay morning-based — so there is still no
// look-ahead in selection, only an accurate price for the day.
//
// Close source, most trustworthy first:
//   1. Live feed (Munshot) `current`, captured at 15:30 IST market close — a
//      real-time quote, so it carries the finalized NSE close even when Yahoo
//      lags (e.g. BOSCHLTD's true 42,950 vs Yahoo's stale 42,000). This covers
//      the tracked baskets.
//   2. technicals.json `cmp` (Yahoo), freshly re-scraped this evening — covers
//      the rest of the universe, best-effort.
//   3. Keep the existing close if neither is available.
//
// Usage:
//   node correct-snapshot-closes.mjs                 # today (IST)
//   node correct-snapshot-closes.mjs --date 2026-08-10
//   node correct-snapshot-closes.mjs --dry           # print, don't write

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = resolve(__dirname, "../public/data");
const SNAP_DIR  = resolve(DATA_DIR, "snapshots");
const LIVE_PATH = resolve(DATA_DIR, "live-prices.json");
const TECH_PATH = resolve(DATA_DIR, "technicals.json");
const IST_OFFSET = 19800; // +5:30 in seconds

const args = process.argv.slice(2);
const getArg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry");

const istDateOf = (ms) => new Date(ms + IST_OFFSET * 1000).toISOString().slice(0, 10);
const readJsonSafe = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

run().catch((e) => { console.error("Fatal:", e.stack || e.message); process.exit(1); });

async function run() {
  const date = getArg("--date") || istDateOf(Date.now());
  const snapPath = resolve(SNAP_DIR, `${date}.json`);
  if (!existsSync(snapPath)) {
    console.log(`No snapshot for ${date} (weekend / not written yet) — nothing to correct.`);
    return;
  }
  const snap = JSON.parse(readFileSync(snapPath, "utf8"));

  // 1. Munshot closes — only trusted when the feed's OWN date is this date, so
  //    a stale live-prices.json can never overwrite a snapshot with old quotes.
  const live = readJsonSafe(LIVE_PATH);
  const liveFresh = live?.generated_at && istDateOf(new Date(live.generated_at).getTime()) === date;
  const liveClose = {};
  if (liveFresh) {
    for (const [t, q] of Object.entries(live.prices || {})) {
      if (q && typeof q.current === "number") liveClose[String(t).toUpperCase()] = q.current;
    }
  }

  // 2. Yahoo cmp from the current technicals.json (freshly re-scraped this run).
  const tech = readJsonSafe(TECH_PATH);
  const techCmp = {};
  for (const c of (tech?.companies || tech || [])) {
    if (c?.ticker && typeof c.cmp === "number") techCmp[String(c.ticker).toUpperCase()] = c.cmp;
  }

  let updated = 0, fromLive = 0, fromTech = 0, withClose = 0, withoutClose = 0;
  const changes = [];
  for (const s of snap.stocks) {
    const t = String(s.ticker || "").toUpperCase();
    let nc = null, src = null;
    if (t && liveClose[t] != null)      { nc = liveClose[t]; src = "live"; }
    else if (t && techCmp[t] != null)   { nc = techCmp[t];  src = "tech"; }
    if (nc != null && nc !== s.close) {
      if (changes.length < 8) changes.push(`${t}: ${s.close} → ${nc} (${src})`);
      s.close = nc;
      updated++;
      if (src === "live") fromLive++; else fromTech++;
    }
    if (s.close != null) withClose++; else withoutClose++;
  }
  snap.coverage = { with_close: withClose, without_close: withoutClose };
  snap.closes_corrected_at = new Date().toISOString();

  console.log(`Snapshot ${date}: corrected ${updated} closes (${fromLive} live / ${fromTech} Yahoo); ${liveFresh ? Object.keys(liveClose).length + " live tickers" : "live feed not fresh — Yahoo only"}.`);
  if (changes.length) console.log("  e.g. " + changes.join(" · "));
  if (!updated) { console.log("  (nothing changed)"); }

  if (DRY) { console.log("[dry run — not writing]"); return; }
  if (!updated) return;
  writeFileSync(snapPath, JSON.stringify(snap, null, 2));
  console.log(`Wrote ${snapPath}`);
}
