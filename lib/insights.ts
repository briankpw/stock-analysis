/**
 * Rule-based classifier over fundamentals + technicals — port of
 * `src/insights.py`. Produces the "Overall score" + verdict shown at the top
 * of the Overview page.
 *
 * See the Python module for the design rationale (explainable, no LLM,
 * category-weighted, not investment advice).
 */

import { toNum } from "./utils";
import type { Info } from "./data";
import type { Bar } from "./indicators";
import type { LatestSignals } from "./indicators";

export type Sentiment = "positive" | "negative" | "neutral";

export const CATEGORIES = {
  VALUATION: "Valuation",
  PROFITABILITY: "Profitability",
  HEALTH: "Financial Health",
  GROWTH: "Growth",
  TECHNICAL: "Technical",
  MOMENTUM: "Momentum",
  DIVIDEND: "Dividend",
} as const;
type Category = (typeof CATEGORIES)[keyof typeof CATEGORIES];

const WEIGHTS: Record<Category, number> = {
  Valuation: 0.20,
  Profitability: 0.25,
  "Financial Health": 0.20,
  Growth: 0.15,
  Technical: 0.10,
  Momentum: 0.05,
  Dividend: 0.05,
};

export interface Insight {
  category: Category;
  sentiment: Sentiment;
  label: string;
  detail: string;
}

export interface Analysis {
  insights: Insight[];
  positives: Insight[];
  negatives: Insight[];
  neutrals: Insight[];
  categoryScores: Record<Category, number>;      // [-1, +1]
  categoryCounts: Record<Category, [number, number, number]>; // (pos, neg, neu)
  overallScore: number;                          // 0-100
  verdictLabel: string;
  verdictEmoji: string;
  conclusion: string;
}

// -------- Helpers ------------------------------------------------------------
function flag(
  arr: Insight[],
  category: Category,
  sentiment: Sentiment,
  label: string,
  detail: string,
) {
  arr.push({ category, sentiment, label, detail });
}

// -------- Category checks ---------------------------------------------------

function checkValuation(info: Info, out: Insight[]): void {
  const pe = toNum(info.trailingPE);
  if (pe !== null) {
    if (pe <= 0) flag(out, "Valuation", "negative", `P/E ${pe.toFixed(1)}`,
      "Negative earnings — the company is unprofitable on a trailing basis.");
    else if (pe < 15) flag(out, "Valuation", "positive", `P/E ${pe.toFixed(1)}`,
      "Trailing P/E below 15 suggests the stock is inexpensive relative to earnings.");
    else if (pe > 30) flag(out, "Valuation", "negative", `P/E ${pe.toFixed(1)}`,
      "Trailing P/E above 30 indicates a rich valuation — growth must sustain.");
    else flag(out, "Valuation", "neutral", `P/E ${pe.toFixed(1)}`,
      "Trailing P/E in the typical 15-30 range.");
  }

  const peg = toNum(info.pegRatio) ?? toNum(info.trailingPegRatio);
  if (peg !== null && peg > 0) {
    if (peg < 1) flag(out, "Valuation", "positive", `PEG ${peg.toFixed(2)}`,
      "PEG below 1 — earnings growth is not yet reflected in the price.");
    else if (peg > 2) flag(out, "Valuation", "negative", `PEG ${peg.toFixed(2)}`,
      "PEG above 2 — the price already anticipates strong earnings growth.");
  }

  const pb = toNum(info.priceToBook);
  if (pb !== null && pb > 0) {
    if (pb < 1) flag(out, "Valuation", "positive", `P/B ${pb.toFixed(2)}`,
      "Trading below book value — often a value signal (or a warning sign; check assets).");
    else if (pb > 5) flag(out, "Valuation", "negative", `P/B ${pb.toFixed(2)}`,
      "P/B above 5 — either asset-light or overpriced relative to equity.");
  }

  const ev = toNum(info.enterpriseToEbitda);
  if (ev !== null) {
    if (ev > 0 && ev < 10) flag(out, "Valuation", "positive", `EV/EBITDA ${ev.toFixed(1)}`,
      "EV/EBITDA under 10 is typically viewed as attractively valued.");
    else if (ev > 20) flag(out, "Valuation", "negative", `EV/EBITDA ${ev.toFixed(1)}`,
      "EV/EBITDA above 20 signals a premium multiple — sensitive to earnings shocks.");
  }
}

function checkProfitability(info: Info, out: Insight[]): void {
  const roe = toNum(info.returnOnEquity);
  if (roe !== null) {
    if (roe > 0.15) flag(out, "Profitability", "positive", `ROE ${(roe * 100).toFixed(1)}%`,
      "Return on Equity above 15% — the company earns strong returns on shareholder capital.");
    else if (roe < 0.05) flag(out, "Profitability", "negative", `ROE ${(roe * 100).toFixed(1)}%`,
      "Return on Equity below 5% — capital is not being deployed productively.");
  }
  const roa = toNum(info.returnOnAssets);
  if (roa !== null) {
    if (roa > 0.07) flag(out, "Profitability", "positive", `ROA ${(roa * 100).toFixed(1)}%`,
      "Return on Assets above 7% — efficient use of the balance sheet.");
    else if (roa < 0.02) flag(out, "Profitability", "negative", `ROA ${(roa * 100).toFixed(1)}%`,
      "Return on Assets below 2% — the business is not generating much from its assets.");
  }
  const op = toNum(info.operatingMargins);
  if (op !== null) {
    if (op > 0.20) flag(out, "Profitability", "positive", `Op. margin ${(op * 100).toFixed(1)}%`,
      "Operating margin above 20% points to pricing power or scale.");
    else if (op < 0.05) flag(out, "Profitability", "negative", `Op. margin ${(op * 100).toFixed(1)}%`,
      "Operating margin below 5% — thin operating profit cushion.");
  }
  const pm = toNum(info.profitMargins);
  if (pm !== null) {
    if (pm > 0.15) flag(out, "Profitability", "positive", `Profit margin ${(pm * 100).toFixed(1)}%`,
      "Net profit margin above 15% converts a large fraction of revenue to shareholders.");
    else if (pm < 0) flag(out, "Profitability", "negative", `Profit margin ${(pm * 100).toFixed(1)}%`,
      "Negative net margin — the company is currently loss-making.");
  }
}

function checkHealth(info: Info, out: Insight[]): void {
  const cur = toNum(info.currentRatio);
  if (cur !== null) {
    if (cur >= 1.5) flag(out, "Financial Health", "positive", `Current ratio ${cur.toFixed(2)}`,
      "Current ratio above 1.5 — comfortable short-term liquidity.");
    else if (cur < 1.0) flag(out, "Financial Health", "negative", `Current ratio ${cur.toFixed(2)}`,
      "Current ratio below 1 — short-term liabilities exceed short-term assets.");
  }
  const rawDe = toNum(info.debtToEquity);
  if (rawDe !== null) {
    // yfinance sometimes reports D/E as a percentage (120 = 1.20); normalise.
    const de = rawDe > 5 ? rawDe / 100 : rawDe;
    if (de < 0.5) flag(out, "Financial Health", "positive", `D/E ${de.toFixed(2)}`,
      "Debt-to-Equity below 0.5 — conservative capital structure.");
    else if (de > 2.0) flag(out, "Financial Health", "negative", `D/E ${de.toFixed(2)}`,
      "Debt-to-Equity above 2 — leverage is elevated; earnings must service the debt.");
  }
  const fcf = toNum(info.freeCashflow);
  if (fcf !== null) {
    if (fcf > 0) flag(out, "Financial Health", "positive", "FCF positive",
      "Free cash flow is positive — the business self-funds after capex.");
    else flag(out, "Financial Health", "negative", "FCF negative",
      "Free cash flow is negative — external financing may be needed to sustain operations.");
  }
}

function checkGrowth(info: Info, out: Insight[]): void {
  const rev = toNum(info.revenueGrowth);
  if (rev !== null) {
    if (rev > 0.10) flag(out, "Growth", "positive", `Revenue +${(rev * 100).toFixed(1)}%`,
      "Year-over-year revenue growth above 10% — the top line is expanding.");
    else if (rev < 0) flag(out, "Growth", "negative", `Revenue ${(rev * 100).toFixed(1)}%`,
      "Revenue is contracting versus the prior year.");
  }
  const earn = toNum(info.earningsGrowth);
  if (earn !== null) {
    if (earn > 0.10) flag(out, "Growth", "positive", `Earnings +${(earn * 100).toFixed(1)}%`,
      "Year-over-year earnings growth above 10% — bottom-line momentum.");
    else if (earn < -0.10) flag(out, "Growth", "negative", `Earnings ${(earn * 100).toFixed(1)}%`,
      "Earnings have contracted materially versus the prior year.");
  }
}

function checkDividend(info: Info, out: Insight[]): void {
  const yld = toNum(info.dividendYield);
  if (yld === null || yld === 0) return;
  if (yld > 0.06) flag(out, "Dividend", "negative", `Yield ${(yld * 100).toFixed(2)}%`,
    "Yield above 6% — attractive, but historically high yields often precede a cut. Check payout ratio.");
  else if (yld > 0.02) flag(out, "Dividend", "positive", `Yield ${(yld * 100).toFixed(2)}%`,
    "Healthy dividend yield above 2% — adds to total return.");

  const payout = toNum(info.payoutRatio);
  if (payout !== null) {
    if (payout > 0 && payout < 0.60) flag(out, "Dividend", "positive", `Payout ${(payout * 100).toFixed(1)}%`,
      "Payout ratio under 60% — dividend is well-covered by earnings.");
    else if (payout > 0.90) flag(out, "Dividend", "negative", `Payout ${(payout * 100).toFixed(1)}%`,
      "Payout ratio above 90% — the dividend consumes nearly all earnings, leaving little cushion.");
  }
}

function checkTechnical(signals: LatestSignals | null, out: Insight[]): void {
  if (!signals) return;

  if (signals.trend.includes("Bullish")) {
    flag(out, "Technical", "positive", "Uptrend regime",
      "SMA 50 is above SMA 200 and price is above SMA 50 — classic golden-cross setup.");
  } else if (signals.trend.includes("Bearish")) {
    flag(out, "Technical", "negative", "Downtrend regime",
      "SMA 50 is below SMA 200 and price is below SMA 50 — death-cross regime.");
  }

  if (signals.rsi.includes("Overbought")) {
    flag(out, "Technical", "negative", signals.rsi,
      "RSI(14) above 70 — short-term momentum is stretched; expect a pullback risk.");
  } else if (signals.rsi.includes("Oversold")) {
    flag(out, "Technical", "positive", signals.rsi,
      "RSI(14) below 30 — potentially oversold and due for a bounce.");
  }

  if (signals.macd === "Bullish") {
    flag(out, "Technical", "positive", "MACD bullish",
      "MACD is above its signal line — momentum favours the upside.");
  } else if (signals.macd === "Bearish") {
    flag(out, "Technical", "negative", "MACD bearish",
      "MACD is below its signal line — momentum favours the downside.");
  }

  if (signals.bollinger.includes("above upper")) {
    flag(out, "Technical", "negative", "Above upper band",
      "Price is riding the upper Bollinger band — mean-reversion pressure.");
  } else if (signals.bollinger.includes("below lower")) {
    flag(out, "Technical", "positive", "Below lower band",
      "Price is hugging the lower Bollinger band — potential reversion higher.");
  }
}

function checkMomentum(bars: Bar[], out: Insight[]): void {
  if (bars.length === 0) return;
  const closes = bars.map((b) => b.close);
  const ret = (days: number): number | null => {
    if (closes.length <= days) return null;
    return closes[closes.length - 1]! / closes[closes.length - days - 1]! - 1;
  };
  const r3m = ret(63);
  const r1y = ret(252);
  if (r3m !== null) {
    if (r3m > 0.05) flag(out, "Momentum", "positive", `3M return +${(r3m * 100).toFixed(1)}%`,
      "Positive 3-month return — sustained buying interest.");
    else if (r3m < -0.10) flag(out, "Momentum", "negative", `3M return ${(r3m * 100).toFixed(1)}%`,
      "3-month return worse than -10% — recent selling pressure.");
  }
  if (r1y !== null) {
    if (r1y > 0.15) flag(out, "Momentum", "positive", `1Y return +${(r1y * 100).toFixed(1)}%`,
      "Trailing 1-year return above 15% — outperforming a passive benchmark expectation.");
    else if (r1y < -0.15) flag(out, "Momentum", "negative", `1Y return ${(r1y * 100).toFixed(1)}%`,
      "Down more than 15% over the past year — persistent underperformance.");
  }

  // Volatility as a risk factor (annualised)
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    if (prev !== 0) rets.push(closes[i]! / prev - 1);
  }
  if (rets.length > 1) {
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (rets.length - 1);
    const annVol = Math.sqrt(variance) * Math.sqrt(252);
    if (annVol > 0.50) {
      flag(out, "Momentum", "negative", `Ann. vol. ${(annVol * 100).toFixed(0)}%`,
        "Annualised volatility above 50% — high price swings; size positions accordingly.");
    }
  }
}

// -------- Aggregation -------------------------------------------------------

function scoreByCategory(items: Insight[]): {
  scores: Record<Category, number>;
  counts: Record<Category, [number, number, number]>;
} {
  const scores = {} as Record<Category, number>;
  const counts = {} as Record<Category, [number, number, number]>;
  for (const cat of Object.keys(WEIGHTS) as Category[]) {
    const catItems = items.filter((i) => i.category === cat);
    const pos = catItems.filter((i) => i.sentiment === "positive").length;
    const neg = catItems.filter((i) => i.sentiment === "negative").length;
    const neu = catItems.filter((i) => i.sentiment === "neutral").length;
    counts[cat] = [pos, neg, neu];
    const directional = pos + neg;
    scores[cat] = directional === 0 ? 0 : (pos - neg) / Math.max(1, directional);
  }
  return { scores, counts };
}

function overallScore(categoryScores: Record<Category, number>): number {
  let weighted = 0;
  let weightTotal = 0;
  for (const cat of Object.keys(WEIGHTS) as Category[]) {
    const s = categoryScores[cat];
    if (s === undefined) continue;
    weighted += s * WEIGHTS[cat];
    weightTotal += WEIGHTS[cat];
  }
  if (weightTotal === 0) return 50;
  const normalised = weighted / weightTotal; // [-1, +1]
  return Math.round((50 + normalised * 50) * 10) / 10;
}

const VERDICT_LADDER: Array<[number, string, string]> = [
  [80, "Strong profile", "🌟"],
  [65, "Attractive profile", "✅"],
  [45, "Mixed signals", "⚖️"],
  [30, "Cautious profile", "⚠️"],
  [0,  "Concerning profile", "🚫"],
];

function verdictOf(score: number): [string, string] {
  for (const [threshold, label, emoji] of VERDICT_LADDER) {
    if (score >= threshold) return [label, emoji];
  }
  return [VERDICT_LADDER[VERDICT_LADDER.length - 1]![1], VERDICT_LADDER[VERDICT_LADDER.length - 1]![2]];
}

function composeConclusion(
  ticker: string,
  scores: Record<Category, number>,
  positives: Insight[],
  negatives: Insight[],
): string {
  const strong = (Object.entries(scores) as [Category, number][])
    .filter(([, s]) => s >= 0.5).map(([c]) => c.toLowerCase());
  const weak = (Object.entries(scores) as [Category, number][])
    .filter(([, s]) => s <= -0.5).map(([c]) => c.toLowerCase());

  const parts: string[] = [];
  if (positives.length && !negatives.length) {
    parts.push(`**${ticker}** looks broadly favourable — every indicator we checked reads positively`);
  } else if (negatives.length && !positives.length) {
    parts.push(`**${ticker}** shows weakness across the indicators we checked`);
  } else if (positives.length > negatives.length * 1.5) {
    parts.push(`**${ticker}** looks broadly favourable, with ${positives.length} positive signals versus ${negatives.length} concerns`);
  } else if (negatives.length > positives.length * 1.5) {
    parts.push(`**${ticker}** raises meaningful concerns, with ${negatives.length} negative signals versus ${positives.length} positives`);
  } else {
    parts.push(`**${ticker}** shows a mixed picture — ${positives.length} positives balanced by ${negatives.length} concerns`);
  }
  if (strong.length) parts.push(`. Strengths cluster in **${strong.join(", ")}**`);
  if (weak.length) {
    parts.push(`${strong.length ? ", while weaknesses appear in " : ". Weaknesses appear in "}**${weak.join(", ")}**`);
  }
  parts.push(". ");
  if (positives.length) {
    parts.push("Notable positives: " + positives.slice(0, 2).map((p) => p.detail.replace(/\.+$/, "")).join("; ") + ". ");
  }
  if (negatives.length) {
    parts.push("Key concerns: " + negatives.slice(0, 2).map((n) => n.detail.replace(/\.+$/, "")).join("; ") + ".");
  }
  return parts.join("");
}


// -------- Public API --------------------------------------------------------

export function analyze(
  ticker: string,
  info: Info,
  bars: Bar[],
  signals: LatestSignals | null,
): Analysis {
  const findings: Insight[] = [];
  checkValuation(info, findings);
  checkProfitability(info, findings);
  checkHealth(info, findings);
  checkGrowth(info, findings);
  checkDividend(info, findings);
  checkTechnical(signals, findings);
  checkMomentum(bars, findings);

  const positives = findings.filter((f) => f.sentiment === "positive");
  const negatives = findings.filter((f) => f.sentiment === "negative");
  const neutrals = findings.filter((f) => f.sentiment === "neutral");

  const { scores, counts } = scoreByCategory(findings);
  const overall = overallScore(scores);
  const [verdictLabel, verdictEmoji] = verdictOf(overall);
  const conclusion = composeConclusion(ticker, scores, positives, negatives);

  return {
    insights: findings,
    positives, negatives, neutrals,
    categoryScores: scores,
    categoryCounts: counts,
    overallScore: overall,
    verdictLabel,
    verdictEmoji,
    conclusion,
  };
}
