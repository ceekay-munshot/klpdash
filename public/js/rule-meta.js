// Per-rule metadata for drill-down cards: where the data comes from, how
// any computation is done, and the verbatim client scoring logic (plus our
// approximation note if it differs).
//
// Structure: META[tabId][ruleKey] = {
//   source:      (company) => { url, label, section }   // mandatory
//   calculation: string | null                          // null = no calc, just fetched
//   clientLogic: string                                 // verbatim from client's sheet
//   ourLogic:    string | null                          // null = same as client
// }

// ---------- shared source helpers ----------
const SCREENER = (c) => ({ url: c?.["Screener URL"] || "https://www.screener.in/", label: "Screener.in", section: "Company page · Top Ratios" });
const SCREENER_QUARTERS = (c) => ({ ...SCREENER(c), section: "Company page · Quarters section" });
const SCREENER_CASHFLOW = (c) => ({ ...SCREENER(c), section: "Company page · Cash Flow statement" });
const SCREENER_SHAREHOLD = (c) => ({ ...SCREENER(c), section: "Company page · Shareholding Pattern" });
const YAHOO = (c) => {
  const ticker = c?.ticker || (String(c?.["Screener URL"] || "").match(/\/company\/([^/]+)/)?.[1]) || "";
  return { url: ticker ? `https://finance.yahoo.com/quote/${ticker}.NS` : "https://finance.yahoo.com", label: "Yahoo Finance", section: "Historical daily OHLCV (1Y)" };
};
const YAHOO_CRUDE = () => ({ url: "https://finance.yahoo.com/quote/BZ=F", label: "Yahoo Finance", section: "Brent Crude futures (BZ=F)" });
const YAHOO_INRUSD = () => ({ url: "https://finance.yahoo.com/quote/USDINR=X", label: "Yahoo Finance", section: "USD/INR spot (USDINR=X)" });
const YAHOO_VIX = () => ({ url: "https://finance.yahoo.com/quote/%5EINDIAVIX", label: "Yahoo Finance", section: "India VIX (^INDIAVIX)" });
const YAHOO_NIFTY500 = () => ({ url: "https://finance.yahoo.com/quote/%5ECRSLDX", label: "Yahoo Finance", section: "Nifty 500 index (^CRSLDX)" });
const NSE_BHAVCOPY = () => ({ url: "https://www.nseindia.com/all-reports", label: "NSE archives", section: "sec_bhavdata_full daily CSV" });
const NSE_FII = () => ({ url: "https://www.nseindia.com/reports/fii-dii", label: "NSE", section: "Daily FII/DII activity report" });
const NSE_PIT = () => ({ url: "https://www.nseindia.com/companies-listing/corporate-filings-insider-trading", label: "NSE corporate filings", section: "PIT (Prohibition of Insider Trading) disclosures" });
const NSE_FNO_LIST = () => ({ url: "https://www.nseindia.com/products-services/equity-derivatives-list-underlyings", label: "NSE F&O eligible list", section: "Stocks with active futures + options" });
const RBI_DBIE = () => ({ url: "https://dbie.rbi.org.in/", label: "RBI Database on Indian Economy", section: "Macro statistics — GDP, CPI, G-Sec yield" });
const MOSPI = () => ({ url: "https://www.mospi.gov.in/", label: "MoSPI", section: "Quarterly GDP and monthly CPI releases" });
const PIB_PLI = () => ({ url: "https://pib.gov.in/PressReleseDetailm.aspx?PRID=1761136", label: "PIB / DPIIT", section: "PLI scheme approved beneficiaries" });
const MNRE = () => ({ url: "https://mnre.gov.in/", label: "MNRE", section: "Renewable capacity addition tenders + awards" });

export const META = {
  fundamentals: {
    roe: {
      source: SCREENER,
      calculation: null,
      clientLogic: "PASS if ROE > 12%; 2 pts. Score reflects capital efficiency vs cost of equity. Borderline 8–12% = 1 pt.",
      ourLogic: null,
    },
    roce: {
      source: SCREENER,
      calculation: null,
      clientLogic: "PASS if ROCE > 15%; 2 pts. Confirms returns exceed cost of capital deployed. Borderline 10–15% = 1 pt.",
      ourLogic: null,
    },
    ebitda: {
      source: SCREENER,
      calculation: "Read full OPM (Operating Profit Margin) series from Screener's Profit & Loss table (up to 12 years). Take the most recent 6 years. PASS if latest year is improving AND no 2+ year contraction streak in window. FAIL if 2+ consecutive years of contraction detected. Fallback to 2-year comparison only when history is too short.",
      clientLogic: "PASS if EBITDA margin improving YoY; 1 pt. FAIL if contracting 2+ consecutive years (0 pts).",
      ourLogic: null,
    },
    npm: {
      source: SCREENER,
      calculation: "Compare NPM (Net Profit Margin) last year vs preceding. PASS if stable/expanding; PARTIAL if compression ≤ 200 bps; FAIL if margin compressed > 200 bps.",
      clientLogic: "PASS if NPM stable on ~bps; 1 pt. Flag if margin compressed > 200 bps in latest year (0 pts).",
      ourLogic: null,
    },
    cfo: {
      source: SCREENER_CASHFLOW,
      calculation: "Read full Cash from Operating Activities series from Screener's Cash Flow Statement (up to 10 years). PASS if positive across all years in the available window. HARD FAIL if latest year is negative — per client framework, that's an automatic disqualification regardless of profitability.",
      clientLogic: "PASS if positive CFO for 10 consecutive years; 2 pts. Negative CFO is a hard fail regardless of PAT.",
      ourLogic: null,
    },
    rev3y: {
      source: SCREENER,
      calculation: "Read Sales growth 3Years from Screener Top Ratios. Apply sector-defensive threshold: 8% pass / 5% partial for defensives (FMCG, Pharma, Utilities, Healthcare), 12% pass / 8% partial for everyone else.",
      clientLogic: "PASS if Revenue CAGR (3Y) ≥ 12–15%; 2 pts. 8–12% = 1 pt. < 8% = 0 pts. Sector-adjust for defensives.",
      ourLogic: null,
    },
    pat3y: {
      source: SCREENER,
      calculation: null,
      clientLogic: "PASS if PAT CAGR (3Y) ≥ 15%; 2 pts. 8–15% = 1 pt. < 8% = 0 pts. High PAT CAGR with margin expansion is the strongest signal.",
      ourLogic: null,
    },
    eps: {
      source: SCREENER_QUARTERS,
      calculation: "Read last 4 quarters of EPS from Screener's Quarterly Results table. PASS if all 4 quarters positive AND at least 2 of 3 QoQ transitions are increases. PARTIAL if positive but growth not consistent. FAIL if any negative or erratic. Falls back to 3Y/5Y CAGR check if quarterly history is too short.",
      clientLogic: "PASS if EPS positive and growing consistently over 3–4 quarters; 1 pt. Erratic EPS = 0 pts.",
      ourLogic: null,
    },
    qoq: {
      source: SCREENER_QUARTERS,
      calculation: "Look at Net Profit values for the last 4 quarters (latest, -1, -2, -3) from Screener Quarters section. PASS if Q-latest > Q-1 AND Q-1 > Q-2; FAIL if any 2 consecutive declines.",
      clientLogic: "PASS if QoQ earnings improvement for last 3 quarters; 1 pt. Any 2 consecutive declines = 0 pts.",
      ourLogic: null,
    },
    de: {
      source: SCREENER,
      calculation: null,
      clientLogic: "PASS if Debt/Equity < 0.5; 2 pts. 0.5–1.0 = 1 pt. > 1.0 = 0 pts. Exclude financial sector.",
      ourLogic: null,
    },
    icr: {
      source: SCREENER,
      calculation: null,
      clientLogic: "PASS if Interest Coverage > 3; 2 pts. 1.5–3 = 1 pt. < 1.5 = automatic fail (debt-serviceability risk, hard fail).",
      ourLogic: null,
    },
    cr: {
      source: SCREENER,
      calculation: null,
      clientLogic: "PASS if Current Ratio > 1.2; 1 pt. Below 1.0 signals liquidity stress = 0 pts.",
      ourLogic: null,
    },
    pledge: {
      source: SCREENER_SHAREHOLD,
      calculation: null,
      clientLogic: "PASS if Promoter Pledge < 5%; 2 pts. 5–20% = 1 pt. > 20% = hard fail. Rising pledge trend = red flag.",
      ourLogic: null,
    },
    ph: {
      source: SCREENER_SHAREHOLD,
      calculation: null,
      clientLogic: "PASS if Promoter Holding stable or increasing; 1 pt. Consistent promoter reduction > 2% per quarter = 0 pts.",
      ourLogic: null,
    },
    fiidii: {
      source: SCREENER_SHAREHOLD,
      calculation: "Read FII Holding Series + DII Holding Series (last 8 quarterly snapshots from Screener's Shareholding Pattern). Take last 4 quarters. Sum each quarter. PASS if combined holding is higher at Q-latest than Q-3 AND at least 2 of 3 QoQ transitions are increases. PARTIAL if net up but inconsistent or FII fell >2 pp across the 4 quarters. FAIL if combined trending down. Falls back to single-quarter ribbon change for recent IPOs without 4 quarters of history.",
      clientLogic: "PASS if FII + DII holding increasing trend over last 4 quarters; 1 pt. Sharp FII exit = flag.",
      ourLogic: null,
    },
    insider: {
      source: NSE_PIT,
      calculation: "Pull NSE PIT (Prohibition of Insider Trading) disclosures over last 6 months. Aggregate per ticker: sum(secAcq × CE/PE indicator) for Buy transactions, Sell transactions. Net buy value > 0 = PASS. Estimate insider sell as % of float using (market cap / current price). > 1% of float sold = hard fail per client spec.",
      clientLogic: "PASS if net insider buying in last 2 quarters; 1 pt. Insider selling > 1% holding = 0 pts.",
      ourLogic: null,
    },
    div: {
      source: SCREENER,
      calculation: "Read Dividend Payout % series from Screener's Profit & Loss table (annual history up to 12 years). Take the last 5 years. PASS if dividend > 0 in at least 3 of those 5 years (per client framework). 4-of-5 or 5-of-5 also pass with a stronger note. FAIL otherwise. Falls back to ribbon's 'Dividend last year' + '5-yr avg yield' when annual history is too short.",
      clientLogic: "PASS if dividend paid in at least 3 of last 5 years; 1 pt. Erratic or nil dividend = 0 pts (discretionary).",
      ourLogic: null,
    },
    auditorRemarks: {
      source: () => ({ url: "https://www.sebi.gov.in/", label: "SEBI / Annual Reports", section: "Auditor's opinion section (deferred)" }),
      calculation: null,
      clientLogic: "PASS if clean unqualified opinion; 2 pts. Any qualification or emphasis-of-matter = 1 pt. Adverse opinion or disclaimer = hard fail.",
      ourLogic: "Deferred. Requires either a curated list maintained by your team (companies with adverse/qualified opinions in latest AR) or LLM-based extraction from annual report PDFs. Will populate as Batch C2.",
    },
    governanceIssues: {
      source: () => ({ url: "https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=27&smid=0", label: "SEBI Orders Database", section: "Active proceedings + litigation flags (deferred)" }),
      calculation: null,
      clientLogic: "PASS if no active SEBI proceedings or litigation flags; 2 pts. Any active investigation = 0 pts (hard fail).",
      ourLogic: "Deferred. Will be a curated list maintained from SEBI Orders Database — typically 10–15 NSE 500 names with active proceedings at any given time.",
    },
  },

  technicals: {
    ema50: {
      source: YAHOO,
      calculation: "Standard 50-day EMA computed from Yahoo daily closes. Formula: EMA today = price × (2/51) + EMA yesterday × (49/51). Seeded with first 50-day SMA. PASS if today's close > 50 EMA.",
      clientLogic: "PASS if CMP > 50 EMA on daily timeframe; 2 pts. Below 50 EMA = 0 pts. Confirms short-to-medium term uptrend.",
      ourLogic: null,
    },
    dma200: {
      source: YAHOO,
      calculation: "200-day SMA from Yahoo daily closes (simple average of last 200 closes). PASS if today's close > 200 DMA. Returns N/A for companies with < 200 trading days of history.",
      clientLogic: "PASS if CMP > 200 DMA on daily timeframe; 2 pts. Fail = stock exits pipeline (primary trend filter).",
      ourLogic: null,
    },
    gold: {
      source: YAHOO,
      calculation: "Compute 50-day SMA and 200-day SMA from Yahoo closes. Golden Cross active if 50 SMA > 200 SMA. Death Cross if 50 SMA < 200 SMA.",
      clientLogic: "PASS if 50 DMA > 200 DMA (Golden Cross active); 1 pt. Death Cross (50 < 200) = 0 pts.",
      ourLogic: null,
    },
    hhhl: {
      source: YAHOO,
      calculation: "Aggregate daily Yahoo OHLCV into weekly bars (max high + min low per 5-day group). Take 26 weekly bars ≈ 6 months. Split into recent 13-week window vs prior 13-week window. Pattern present if recent max(high) > prior max(high) AND recent min(low) > prior min(low).",
      clientLogic: "PASS if HH-HL visible on weekly chart over 6+ months; 1 pt. Lower-lows pattern = 0 pts.",
      ourLogic: null,
    },
    rsi: {
      source: YAHOO,
      calculation: "RSI(14) = 100 − 100 / (1 + RS) where RS = average gain / average loss over last 14 daily closes. Wilder smoothing for subsequent updates.",
      clientLogic: "PASS if RSI 55–75 (ideal momentum zone); 2 pts. RSI > 80 = overbought = 1 pt. RSI < 40 = weak/failing = 0 pts.",
      ourLogic: null,
    },
    macd: {
      source: YAHOO,
      calculation: "MACD line = EMA(12) − EMA(26). Signal = EMA(9) of MACD line. PASS if MACD line > signal AND MACD line > 0. Positive crossover detected if MACD crossed above signal in last day.",
      clientLogic: "PASS if MACD line > signal line and above zero (positive crossover); 2 pts. Negative crossover = 0 pts.",
      ourLogic: null,
    },
    adx: {
      source: YAHOO,
      calculation: "ADX(14) using Wilder smoothing. Compute True Range, +DM, −DM each day. Smooth to +DI / −DI. DX = 100 × |+DI − −DI| / (+DI + −DI). ADX = 14-period Wilder smoothing of DX. Scoring: > 25 = 1 pt, 20–25 = 0.5 pt (per client framework), < 20 = 0.",
      clientLogic: "PASS if ADX > 25 (strong trend); 1 pt. ADX 20–25 = 0.5 pts (developing). ADX < 20 = choppy/no trend = 0 pts.",
      ourLogic: null,
    },
    rs: {
      source: YAHOO,
      calculation: "Compute 6-month return for stock and for Nifty 500 index (^CRSLDX). Relative Strength = stock_return − index_return.",
      clientLogic: "PASS if 6M price return > Nifty 500 index return; 2 pts. Underperforming benchmark = 1 pt.",
      ourLogic: null,
    },
    volbo: {
      source: YAHOO,
      calculation: "Compare today's volume against the average of the prior 20 trading days' volume. Volume ratio = today / 20-day avg. PASS if ratio ≥ 1.5×.",
      clientLogic: "PASS if breakout-day volume ≥ 1.5× 20-day avg; 2 pts. Low volume breakout = suspect = 1 pt.",
      ourLogic: null,
    },
    delivery: {
      source: NSE_BHAVCOPY,
      calculation: "Fetch NSE sec_bhavdata_full daily CSV for the last ~30 trading days. Extract DELIV_PER per ticker per day. Compute recent-half average vs older-half average. PASS if recent average > older average by > 1 pp.",
      clientLogic: "PASS if delivery % trending up over last 30 trading days; 1 pt. Declining delivery % = 0 pts.",
      ourLogic: null,
    },
    instact: {
      source: SCREENER_SHAREHOLD,
      calculation: "Pull 'Chg in FII Hold' + 'Chg in DII Hold' from each company's Screener Top Ratios. Sum > 0 = PASS. PARTIAL if sum positive but FII alone falling > 2%.",
      clientLogic: "PASS if FII + DII cumulative buying in last 2 quarters; 1 pt. Net institutional selling = 0 pts.",
      ourLogic: null,
    },
    near52w: {
      source: YAHOO,
      calculation: "Compute 52-week high from last 250 daily closes. Proximity ratio = today's close / 52W high. Distance from high = (1 − ratio) × 100%.",
      clientLogic: "PASS if within 10% of 52-week high; 2 pts. > 20% below 52W high = weak structure = 0 pts.",
      ourLogic: null,
    },
    consolidation: {
      source: YAHOO,
      calculation: "Look at the last 30 trading days = 6 weeks. Base range % = (max(high) − min(low)) / avg(close) × 100. Tight base = range < 12%. Breakout = today's close > prior 6-week high. Volume confirm = today's volume > 1.5× base avg volume. Strong = all three; partials documented in the note.",
      clientLogic: "PASS if breaking out of at least 6-week base on strong volume; 2 pts. No base = 0 pts.",
      ourLogic: null,
    },
    base: {
      source: YAHOO,
      calculation: "Take last 60 daily closes. Drawdown % = (max − min) / max × 100. Closing-range tightness = standard deviation of closes ÷ mean of closes, expressed as %. Healthy = drawdown < 15% AND tightness < 4%.",
      clientLogic: "PASS if base formed with controlled drawdown < 15% and tight closing range; 1 pt.",
      ourLogic: null,
    },
    beta: {
      source: YAHOO,
      calculation: "Compute 1-year (up to 252 trading days) of daily returns for stock and Nifty 500 index. Beta = covariance(stock_returns, index_returns) / variance(index_returns).",
      clientLogic: "PASS if Beta 0.7–1.3 (moderate); 1 pt. Beta > 1.5 = high risk, weight penalty. Beta < 0.5 = drag risk.",
      ourLogic: null,
    },
    atr: {
      source: YAHOO,
      calculation: "ATR(14) using Wilder smoothing over True Range values. ATR % = ATR ÷ latest close × 100. Trend assessed from atr_history.json accumulator (≥10 daily snapshots needed for trend): recent-half avg vs older-half avg. Scoring combines absolute level (<2.5% / 2.5–4% / >4%) AND trend direction (declining boosts to PASS, rising downgrades to partial). Accumulator builds 1 snapshot per daily Technicals scrape, so the trend signal strengthens over ~2 weeks.",
      clientLogic: "PASS if 14-day ATR % declining or stable (< 2.5% for large cap); 1 pt. Rising ATR = position-size flag.",
      ourLogic: null,
    },
  },

  macro: {
    infra: {
      source: (c) => ({ url: "https://pib.gov.in/PressReleaseIframePage.aspx?PRID=2003687", label: "PIB / Union Budget", section: "FY26 Budget capex announcement" }),
      calculation: "Check if company's Broad Industry is in the curated infra-beneficiary list (Cement, Construction, Engineering, Capital Goods, Iron & Steel, Power) AND govt_capex_active flag is true.",
      clientLogic: "PASS if stock is in Capital Goods / Cement / Roads sector with active govt capex; 2 pts. No exposure = 0 pts.",
      ourLogic: null,
    },
    ratecut: {
      source: (c) => ({ url: "https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx", label: "RBI", section: "Monetary Policy Committee statements" }),
      calculation: "Check if company's Broad Industry is in rate-sensitive list (Banks, NBFCs, Housing Finance, Realty, Auto) AND rate_cut_cycle flag is true.",
      clientLogic: "PASS if sector benefits from falling rates and RBI stance is accommodative; 2 pts. Neutral = 1 pt.",
      ourLogic: null,
    },
    chinaplus1: {
      source: (c) => ({ url: "https://www.dpiit.gov.in/", label: "DPIIT / Ministry of Commerce", section: "PLI scheme + China+1 substitution disclosures" }),
      calculation: "Primary: company NSE ticker on curated china_plus_one_companies list (~50 names — EMS, specialty chemicals, pharma APIs, bearings, auto components with significant China+1 share gain). Fallback: Broad Industry membership in china_plus_one sector theme (Specialty Chemicals, Pharma, Electric Equipment, Electronics).",
      clientLogic: "PASS if company derives > 15% revenue from China+1 substitution or EMS theme; 2 pts.",
      ourLogic: "Hybrid approach. Primary path: curated company list (~50 names with material China+1 / EMS revenue exposure — full 2 pts on match). Fallback path: sector membership for companies not on the explicit list (1 pt partial credit). Closes the previous sector-only proxy.",
    },
    rural: {
      source: (c) => ({ url: "https://nabard.org/", label: "NABARD / IMD", section: "Rural recovery + monsoon indicators" }),
      calculation: "Check if company's Broad Industry is rural-facing (FMCG, Agro, Tractors, 2-Wheelers) AND rural_recovery_signal is 'good'.",
      clientLogic: "PASS if rural indicators improving (MSP hike, normal monsoon, kharif sowing); 1 pt. Drought risk = 0 pts.",
      ourLogic: null,
    },
    gdp: {
      source: RBI_DBIE,
      calculation: null,
      clientLogic: "PASS if GDP growth ≥ 6.5% and trending up; 2 pts. Below 6% = broad market caution = 1 pt.",
      ourLogic: null,
    },
    cpi: {
      source: MOSPI,
      calculation: null,
      clientLogic: "PASS if CPI within RBI 4% ± 2% band and stable; 1 pt. Elevated inflation compresses margins for input-cost-sensitive companies.",
      ourLogic: null,
    },
    crude: {
      source: YAHOO_CRUDE,
      calculation: "Read latest Brent crude price (Yahoo BZ=F) + 30-day trend. PASS for beneficiary sectors (Paints, Aviation, OMCs) if crude < $85. FAIL for hurt sectors (Aviation, Logistics, Refineries) if crude > $90.",
      clientLogic: "PASS for beneficiaries if crude < $85/bbl; 1 pt. Score for importers. Flag at $90+.",
      ourLogic: null,
    },
    inr: {
      source: YAHOO_INRUSD,
      calculation: "Read latest USD/INR (Yahoo USDINR=X) + 30-day trend. PASS for exporters (IT, Pharma) if INR weakening (USD/INR rising). FAIL for importers (Refineries, Capital Goods) if INR weakening.",
      clientLogic: "PASS for IT / Pharma exporters if INR weakening trend; 1 pt. Strong INR hurts exporters = 0 pts.",
      ourLogic: null,
    },
    bonds: {
      source: (c) => ({ url: "https://www.ccilindia.com/", label: "CCIL / RBI", section: "10-year G-Sec yield + trend" }),
      calculation: null,
      clientLogic: "PASS for Banks / NBFCs if 10Y yield declining; 1 pt. Rising yields compress NIMs = 0 pts.",
      ourLogic: "Live G-Sec yield is fetched daily from a small chain of public sources (Yahoo Finance under several candidate symbols, then a worldgovernmentbonds.com HTML scrape). Falls back to the static value in macro-context.json if all live fetches fail. Trend is computed from the 30-day window when Yahoo returns history; from the same-day change column when scraping worldgovernmentbonds.",
    },
    pli: {
      source: PIB_PLI,
      calculation: "Look up company's NSE ticker in our curated PLI beneficiary list (~79 names across electronics, pharma, auto, textiles, food processing, steel, batteries — sourced from DPIIT and PIB releases).",
      clientLogic: "PASS if company has approved PLI allocation or confirmed PLI-scheme revenue; 2 pts.",
      ourLogic: "Curated static list. PASS = ticker is in the list. Updated quarterly as DPIIT approves new beneficiaries.",
    },
    renewable: {
      source: MNRE,
      calculation: "Look up company's NSE ticker in our curated renewable-energy participants list (~20 names — solar, wind, hydro, green hydrogen — from MNRE tender announcements + corporate disclosures).",
      clientLogic: "PASS if company is a direct participant in renewable capacity addition pipeline; 2 pts.",
      ourLogic: "Curated static list, same shape as PLI.",
    },
  },

  sentiment: {
    vix: {
      source: YAHOO_VIX,
      calculation: "Read latest India VIX value from Yahoo ^INDIAVIX.",
      clientLogic: "PASS if VIX < 15 (low fear, risk-on); 2 pts. VIX 15–20 = caution = 1 pt. VIX > 20 = reduce exposure = 0 pts.",
      ourLogic: null,
    },
    fiidii: {
      source: NSE_FII,
      calculation: "Append daily FII net-value row from NSE /api/fiidiiTradeReact to public/data/fii-dii-history.json. Compute signal from latest up to 20 days of accumulated data: ≥ 50% positive days = 'yes', 30–50% = 'mixed', < 30% = 'no'.",
      clientLogic: "PASS if FII net positive for last 10 of 20 trading days; 2 pts. Consistent FII selling = 0 pts.",
      ourLogic: "We use a daily-snapshot accumulator. Each daily macro scrape adds one row; the rolling 20-day signal stabilises after ~10 daily runs.",
    },
    pcr: {
      source: () => ({ url: "https://www.nseindia.com/option-chain", label: "NSE option chain", section: "NIFTY weekly + monthly option chain (deferred)" }),
      calculation: null,
      clientLogic: "PASS if PCR 0.9–1.3 (balanced to bullish); 1 pt. PCR < 0.8 = overly bullish caution. PCR > 1.5 = panic.",
      ourLogic: "Sourced via Firecrawl from NSE's NIFTY option-chain JSON endpoint, with a Trendlyne HTML fallback if NSE refuses. Firecrawl proxies through residential IPs / headless browser, bypassing the bot detection that blocks direct GHA-runner fetches. Yesterday's value is cached and surfaced (marked stale) when today's fetch fails. Refreshed daily.",
    },
    breadth: {
      source: YAHOO_NIFTY500,
      calculation: "Compute per-company today's pct change (close − previous close) from Yahoo OHLCV for all 499 Nifty 500 stocks. Count advances (pChange > 0) vs declines (pChange < 0). A/D ratio = advances / declines.",
      clientLogic: "PASS if A/D ratio > 1.5 consistently; 1 pt. Narrow breadth (only large caps up) = 0 pts.",
      ourLogic: "We compute A/D from our own Nifty 500 universe rather than scrape NSE's breadth widget — fully under our control.",
    },
    adtv: {
      source: YAHOO,
      calculation: "Take last 20 daily bars (≈ 4 weeks). Sum (close × volume) across the window. Average and divide by 1e7 to get ADTV in ₹ crores.",
      clientLogic: "PASS if ADTV ≥ ₹10 Cr (adjust for portfolio AUM); 2 pts. < ₹5 Cr = illiquid = hard fail.",
      ourLogic: null,
    },
    impact: {
      source: () => ({ url: "https://www.nseindia.com/products-services/equity-market-impact-cost", label: "NSE Impact Cost report", section: "Monthly publication — Firecrawl-sourced" }),
      calculation: "Firecrawl probes NSE's monthly Impact Cost CSV across the last 4 months × 6 URL patterns. First parseable response wins. Per-ticker impact cost percentages are merged into Sentiment tab rows.",
      clientLogic: "PASS if impact cost ≤ 0.3% for mid-cap; 2 pts. > 0.5% = high slippage risk.",
      ourLogic: null,
    },
    spread: {
      source: () => ({ url: "https://www.nseindia.com/market-data/live-equity-market", label: "NSE live order book", section: "Real-time bid-ask spread (deferred)" }),
      calculation: null,
      clientLogic: "PASS if bid-ask spread < 0.1% of CMP; 1 pt. Wide spread (> 0.3%) signals thin order book = 0 pts.",
      ourLogic: "Read from Yahoo Finance chart-meta snapshot (bid + ask fields) — Yahoo populates these intermittently for NSE tickers, so coverage isn't full and individual companies degrade to N/A when Yahoo omits the snapshot. This is a free path that piggybacks on the existing 500-call/day OHLCV fetch — no Firecrawl credits burned.",
    },
    fno: {
      source: NSE_FNO_LIST,
      calculation: "Check if company's NSE ticker is in our curated F&O eligible list (~200 NSE stocks with active futures + options).",
      clientLogic: "PASS if stock has active F&O contracts; 1 pt. Non-F&O stock = 0 pts (prefer but not mandatory).",
      ourLogic: null,
    },
  },
};
