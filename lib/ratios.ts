/**
 * Fundamental ratio groups — TypeScript port of `src/ratios.py`.
 *
 * Each group is a `MetricGroup { title, metrics }` where `metrics` is a
 * list of `[label, formattedValue, tone]` tuples. The UI iterates groups
 * and renders them as key/value cards, colours each value by tone, plus
 * looks the label up in `lib/knowledge` for beginner-mode hints.
 */

import type { Bar } from "./indicators";
import { annualisedVolatility } from "./indicators";
import { toNum } from "./utils";
import { DASH, fmtCompactCurrency, fmtNumber, fmtPercent } from "./format";
import type { Info } from "./data";

/**
 * Semantic tone applied to a metric's rendered value:
 *   good    = healthy, coloured green
 *   warn    = borderline / worth a closer look, coloured amber
 *   bad     = concerning, coloured red
 *   neutral = no rule of thumb applies (or the value is missing) — no colour
 */
export type Tone = "good" | "warn" | "bad" | "neutral";

/** Tuple form for a single row in a metric group. Tone is optional so
 *  older constructors (or non-numeric rows like `"unavailable"`) can omit it. */
export type MetricEntry = [label: string, formatted: string, tone?: Tone];

export interface MetricGroup {
  title: string;
  metrics: MetricEntry[];
}

function currencyOf(info: Info): string {
  return (info.financialCurrency as string) || (info.currency as string) || "$";
}

// ---- Tone classification ---------------------------------------------------
//
// Thresholds are aligned with the `ruleOfThumb` copy in `lib/knowledge.ts`
// so the tooltip explanation and the colour on the number always agree.
// Metrics without a judge (e.g. `Market Cap`, `52W High`) render neutral.

type Judge = (n: number) => Tone;

const JUDGES: Readonly<Record<string, Judge>> = {
  // ---- Price & Volume -------------------------------------------------
  "Period Return": (n) => (n > 0 ? "good" : n < 0 ? "bad" : "neutral"),
  "Annualized Volatility": (n) =>
    n <= 0.20 ? "good" : n >= 0.40 ? "bad" : "neutral",

  // ---- Valuation (lower_better; negative P/E means the metric is
  //      undefined in the traditional sense — treat as concerning). --
  "Trailing P/E": (n) =>
    n < 0 ? "bad" : n <= 15 ? "good" : n >= 30 ? "bad" : "neutral",
  "Forward P/E": (n) =>
    n < 0 ? "bad" : n <= 15 ? "good" : n >= 30 ? "bad" : "neutral",
  "PEG Ratio": (n) =>
    n > 0 && n <= 1 ? "good" : n > 2 ? "bad" : "neutral",
  "Price / Book": (n) => (n <= 1 ? "good" : n > 5 ? "bad" : "neutral"),
  "Price / Sales (TTM)": (n) => (n <= 2 ? "good" : n > 10 ? "bad" : "neutral"),
  "EV / EBITDA": (n) => (n <= 10 ? "good" : n > 20 ? "bad" : "neutral"),
  "EV / Revenue": (n) => (n <= 3 ? "good" : n > 10 ? "bad" : "neutral"),

  // ---- Profitability (higher_better; negative = losing money). -------
  "Gross Margins": (n) =>
    n < 0 ? "bad" : n >= 0.40 ? "good" : n <= 0.15 ? "warn" : "neutral",
  "Operating Margins": (n) =>
    n < 0 ? "bad" : n >= 0.15 ? "good" : n < 0.05 ? "warn" : "neutral",
  "Profit Margins": (n) =>
    n < 0 ? "bad" : n >= 0.15 ? "good" : n < 0.05 ? "warn" : "neutral",
  "EBITDA Margins": (n) =>
    n < 0 ? "bad" : n >= 0.20 ? "good" : "neutral",
  "Return on Assets": (n) =>
    n < 0 ? "bad" : n >= 0.10 ? "good" : n < 0.02 ? "warn" : "neutral",
  "Return on Equity": (n) =>
    n < 0 ? "bad" : n >= 0.15 ? "good" : n < 0.05 ? "warn" : "neutral",

  // ---- Financial Health ---------------------------------------------
  "Debt / Equity": (n) => {
    // yfinance sometimes reports D/E as percent (e.g. 155 for 1.55).
    // If the number looks percent-scaled (> 10) divide back into a ratio.
    const r = n > 10 ? n / 100 : n;
    return r <= 1 ? "good" : r > 2 ? "bad" : "neutral";
  },
  "Current Ratio": (n) =>
    n >= 1.5 ? "good" : n < 1 ? "bad" : n < 1.2 ? "warn" : "neutral",
  "Quick Ratio": (n) =>
    n >= 1 ? "good" : n < 0.5 ? "bad" : n < 0.8 ? "warn" : "neutral",
  "Free Cash Flow": (n) => (n > 0 ? "good" : n < 0 ? "bad" : "neutral"),
  "Operating Cash Flow": (n) => (n > 0 ? "good" : n < 0 ? "bad" : "neutral"),

  // ---- Growth & Earnings --------------------------------------------
  "Revenue Growth (YoY)": (n) =>
    n >= 0.10 ? "good" : n < 0 ? "bad" : "neutral",
  "Earnings Growth (YoY)": (n) =>
    n >= 0.10 ? "good" : n < 0 ? "bad" : "neutral",
  "EPS (TTM)": (n) => (n > 0 ? "good" : n < 0 ? "bad" : "neutral"),
  "EPS (Forward)": (n) => (n > 0 ? "good" : n < 0 ? "bad" : "neutral"),

  // ---- Dividend -----------------------------------------------------
  // Yield above 6% is more warning than "good": the price may have crashed
  // or the dividend is unsustainable. 2-6% is the healthy sweet spot.
  "Dividend Yield": (n) =>
    n >= 0.06 ? "warn" : n >= 0.02 ? "good" : "neutral",
  "Payout Ratio": (n) =>
    n <= 0 ? "neutral" : n <= 0.6 ? "good" : n > 1 ? "bad" : "warn",
};

/**
 * Classify a metric value into a semantic tone based on its label. Returns
 * `"neutral"` for metrics without a rule of thumb, for context-only metrics,
 * or when the value is null / NaN / non-numeric.
 */
export function judgeMetric(label: string, value: unknown): Tone {
  const n = toNum(value);
  if (n === null) return "neutral";
  const judge = JUDGES[label];
  return judge ? judge(n) : "neutral";
}

/** Build a `MetricEntry` with tone attached in one place. */
function m(label: string, raw: unknown, formatted: string): MetricEntry {
  return [label, formatted, judgeMetric(label, raw)];
}

// ---- Group builders --------------------------------------------------------

export function buildValuationGroup(info: Info): MetricGroup {
  const c = currencyOf(info);
  const peg = info.pegRatio ?? info.trailingPegRatio;
  return {
    title: "Valuation",
    metrics: [
      m("Market Cap", info.marketCap, fmtCompactCurrency(info.marketCap, c)),
      m("Enterprise Value", info.enterpriseValue, fmtCompactCurrency(info.enterpriseValue, c)),
      m("Trailing P/E", info.trailingPE, fmtNumber(info.trailingPE)),
      m("Forward P/E", info.forwardPE, fmtNumber(info.forwardPE)),
      m("PEG Ratio", peg, fmtNumber(peg)),
      m("Price / Book", info.priceToBook, fmtNumber(info.priceToBook)),
      m("Price / Sales (TTM)", info.priceToSalesTrailing12Months, fmtNumber(info.priceToSalesTrailing12Months)),
      m("EV / EBITDA", info.enterpriseToEbitda, fmtNumber(info.enterpriseToEbitda)),
      m("EV / Revenue", info.enterpriseToRevenue, fmtNumber(info.enterpriseToRevenue)),
    ],
  };
}

export function buildProfitabilityGroup(info: Info): MetricGroup {
  return {
    title: "Profitability",
    metrics: [
      m("Gross Margins", info.grossMargins, fmtPercent(info.grossMargins)),
      m("Operating Margins", info.operatingMargins, fmtPercent(info.operatingMargins)),
      m("Profit Margins", info.profitMargins, fmtPercent(info.profitMargins)),
      m("EBITDA Margins", info.ebitdaMargins, fmtPercent(info.ebitdaMargins)),
      m("Return on Assets", info.returnOnAssets, fmtPercent(info.returnOnAssets)),
      m("Return on Equity", info.returnOnEquity, fmtPercent(info.returnOnEquity)),
    ],
  };
}

export function buildFinancialHealthGroup(info: Info): MetricGroup {
  const c = currencyOf(info);
  return {
    title: "Financial Health",
    metrics: [
      m("Total Cash", info.totalCash, fmtCompactCurrency(info.totalCash, c)),
      m("Total Debt", info.totalDebt, fmtCompactCurrency(info.totalDebt, c)),
      m("Debt / Equity", info.debtToEquity, fmtNumber(info.debtToEquity)),
      m("Current Ratio", info.currentRatio, fmtNumber(info.currentRatio)),
      m("Quick Ratio", info.quickRatio, fmtNumber(info.quickRatio)),
      m("Free Cash Flow", info.freeCashflow, fmtCompactCurrency(info.freeCashflow, c)),
      m("Operating Cash Flow", info.operatingCashflow, fmtCompactCurrency(info.operatingCashflow, c)),
    ],
  };
}

export function buildGrowthGroup(info: Info): MetricGroup {
  const c = currencyOf(info);
  return {
    title: "Growth & Earnings",
    metrics: [
      m("Revenue (TTM)", info.totalRevenue, fmtCompactCurrency(info.totalRevenue, c)),
      m("Revenue / Share", info.revenuePerShare, fmtNumber(info.revenuePerShare)),
      m("Revenue Growth (YoY)", info.revenueGrowth, fmtPercent(info.revenueGrowth)),
      m("Earnings Growth (YoY)", info.earningsGrowth, fmtPercent(info.earningsGrowth)),
      m("EPS (TTM)", info.trailingEps, fmtNumber(info.trailingEps)),
      m("EPS (Forward)", info.forwardEps, fmtNumber(info.forwardEps)),
    ],
  };
}

export function buildDividendGroup(info: Info): MetricGroup {
  const divRate = toNum(info.dividendRate);
  const fiveYearAvg = toNum(info.fiveYearAvgDividendYield);
  const c = (info.currency as string) || currencyOf(info);
  // yfinance reports fiveYearAvgDividendYield as a whole-number percent
  // (e.g. 1.35 == 1.35%). Convert to a fraction before formatting/judging.
  const fiveYearFraction = fiveYearAvg !== null ? fiveYearAvg / 100 : null;
  return {
    title: "Dividend",
    metrics: [
      m(
        "Dividend Rate",
        divRate,
        divRate ? fmtCompactCurrency(divRate, c) : DASH,
      ),
      m("Dividend Yield", info.dividendYield, fmtPercent(info.dividendYield)),
      m("Payout Ratio", info.payoutRatio, fmtPercent(info.payoutRatio)),
      m(
        "5Y Avg Yield",
        fiveYearFraction,
        fiveYearFraction !== null ? fmtPercent(fiveYearFraction) : DASH,
      ),
    ],
  };
}


export function computePriceStats(bars: Bar[]): MetricGroup {
  if (bars.length === 0) {
    return { title: "Price & Volume", metrics: [["History", "unavailable", "neutral"]] };
  }
  const closes = bars.map((b) => b.close);
  const volumes = bars.map((b) => b.volume);

  const lastClose = closes[closes.length - 1]!;
  const firstClose = closes[0]!;
  const periodReturn = firstClose !== 0 ? lastClose / firstClose - 1 : null;

  const last252 = closes.slice(-252);
  const high52 = last252.length >= 20 ? Math.max(...last252) : Math.max(...closes);
  const low52 = last252.length >= 20 ? Math.min(...last252) : Math.min(...closes);

  const vol = annualisedVolatility(closes);

  const metrics: MetricEntry[] = [
    m("Last Close", lastClose, fmtNumber(lastClose)),
    m("Period Return", periodReturn, fmtPercent(periodReturn)),
    m("52W High", high52, fmtNumber(high52)),
    m("52W Low", low52, fmtNumber(low52)),
    m("Annualized Volatility", vol, fmtPercent(vol)),
  ];

  if (volumes.length > 0) {
    const last20 = volumes.slice(-20);
    const avgVol = last20.reduce((a, b) => a + b, 0) / last20.length;
    const lastVol = volumes[volumes.length - 1]!;
    metrics.push(m("Avg Volume (20d)", avgVol, fmtNumber(avgVol, 0)));
    metrics.push(m("Last Volume", lastVol, fmtNumber(lastVol, 0)));
  }

  return { title: "Price & Volume", metrics };
}


export function allGroups(info: Info, bars: Bar[]): MetricGroup[] {
  return [
    computePriceStats(bars),
    buildValuationGroup(info),
    buildProfitabilityGroup(info),
    buildFinancialHealthGroup(info),
    buildGrowthGroup(info),
    buildDividendGroup(info),
  ];
}
