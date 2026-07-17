/**
 * Rule-based classifier over fundamentals + technicals — port of
 * `src/insights.py`. Produces the "Overall score" + verdict shown at the top
 * of the Overview page.
 *
 * The English `label`, `detail`, `verdictLabel`, and `conclusion` fields are
 * kept as fallbacks so callers that don't localize still get a legible
 * string. Every insight *also* carries `labelKey` / `detailKey` (plus
 * optional params) so the client can render the same content in the active
 * locale via `useT()`. The `verdictKey` field and structured
 * `conclusionParts` enable the Overview page to compose a fully translated
 * conclusion sentence in the user's language.
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
export type Category = (typeof CATEGORIES)[keyof typeof CATEGORIES];

const WEIGHTS: Record<Category, number> = {
  Valuation: 0.20,
  Profitability: 0.25,
  "Financial Health": 0.20,
  Growth: 0.15,
  Technical: 0.10,
  Momentum: 0.05,
  Dividend: 0.05,
};

export type InsightParams = Record<string, string | number>;

export interface Insight {
  category: Category;
  sentiment: Sentiment;
  /** Localizable label templates. Prefer `labelKey` when rendering; fall back to `label`. */
  labelKey: string;
  labelParams?: InsightParams;
  label: string;
  detailKey: string;
  detailParams?: InsightParams;
  detail: string;
}

export type VerdictKey =
  | "strong"
  | "attractive"
  | "mixed"
  | "cautious"
  | "concerning";

export interface ConclusionParts {
  ticker: string;
  positivesCount: number;
  negativesCount: number;
  strongCategories: Category[];
  weakCategories: Category[];
  topPositives: Insight[];
  topNegatives: Insight[];
}

export interface Analysis {
  insights: Insight[];
  positives: Insight[];
  negatives: Insight[];
  neutrals: Insight[];
  categoryScores: Record<Category, number>;      // [-1, +1]
  categoryCounts: Record<Category, [number, number, number]>; // (pos, neg, neu)
  overallScore: number;                          // 0-100
  verdictKey: VerdictKey;
  verdictLabel: string;
  verdictEmoji: string;
  conclusionParts: ConclusionParts;
  /** English pre-composed conclusion — kept for consumers that don't localize. */
  conclusion: string;
}

// -------- Helpers ------------------------------------------------------------

interface FlagSpec {
  labelKey: string;
  labelParams?: InsightParams;
  labelEn: string;
  detailKey: string;
  detailParams?: InsightParams;
  detailEn: string;
}

function flag(
  arr: Insight[],
  category: Category,
  sentiment: Sentiment,
  spec: FlagSpec,
): void {
  arr.push({
    category,
    sentiment,
    labelKey: spec.labelKey,
    labelParams: spec.labelParams,
    label: spec.labelEn,
    detailKey: spec.detailKey,
    detailParams: spec.detailParams,
    detail: spec.detailEn,
  });
}

// -------- Category checks ---------------------------------------------------

function checkValuation(info: Info, out: Insight[]): void {
  const pe = toNum(info.trailingPE);
  if (pe !== null) {
    const p = { value: pe.toFixed(1) };
    const labelEn = `P/E ${p.value}`;
    if (pe <= 0) {
      flag(out, "Valuation", "negative", {
        labelKey: "insight.label.pe", labelParams: p, labelEn,
        detailKey: "insight.detail.pe.negative",
        detailEn: "Negative earnings — the company is unprofitable on a trailing basis.",
      });
    } else if (pe < 15) {
      flag(out, "Valuation", "positive", {
        labelKey: "insight.label.pe", labelParams: p, labelEn,
        detailKey: "insight.detail.pe.cheap",
        detailEn: "Trailing P/E below 15 suggests the stock is inexpensive relative to earnings.",
      });
    } else if (pe > 30) {
      flag(out, "Valuation", "negative", {
        labelKey: "insight.label.pe", labelParams: p, labelEn,
        detailKey: "insight.detail.pe.rich",
        detailEn: "Trailing P/E above 30 indicates a rich valuation — growth must sustain.",
      });
    } else {
      flag(out, "Valuation", "neutral", {
        labelKey: "insight.label.pe", labelParams: p, labelEn,
        detailKey: "insight.detail.pe.typical",
        detailEn: "Trailing P/E in the typical 15-30 range.",
      });
    }
  }

  const peg = toNum(info.pegRatio) ?? toNum(info.trailingPegRatio);
  if (peg !== null && peg > 0) {
    const p = { value: peg.toFixed(2) };
    const labelEn = `PEG ${p.value}`;
    if (peg < 1) {
      flag(out, "Valuation", "positive", {
        labelKey: "insight.label.peg", labelParams: p, labelEn,
        detailKey: "insight.detail.peg.low",
        detailEn: "PEG below 1 — earnings growth is not yet reflected in the price.",
      });
    } else if (peg > 2) {
      flag(out, "Valuation", "negative", {
        labelKey: "insight.label.peg", labelParams: p, labelEn,
        detailKey: "insight.detail.peg.high",
        detailEn: "PEG above 2 — the price already anticipates strong earnings growth.",
      });
    }
  }

  const pb = toNum(info.priceToBook);
  if (pb !== null && pb > 0) {
    const p = { value: pb.toFixed(2) };
    const labelEn = `P/B ${p.value}`;
    if (pb < 1) {
      flag(out, "Valuation", "positive", {
        labelKey: "insight.label.pb", labelParams: p, labelEn,
        detailKey: "insight.detail.pb.low",
        detailEn: "Trading below book value — often a value signal (or a warning sign; check assets).",
      });
    } else if (pb > 5) {
      flag(out, "Valuation", "negative", {
        labelKey: "insight.label.pb", labelParams: p, labelEn,
        detailKey: "insight.detail.pb.high",
        detailEn: "P/B above 5 — either asset-light or overpriced relative to equity.",
      });
    }
  }

  const ev = toNum(info.enterpriseToEbitda);
  if (ev !== null) {
    const p = { value: ev.toFixed(1) };
    const labelEn = `EV/EBITDA ${p.value}`;
    if (ev > 0 && ev < 10) {
      flag(out, "Valuation", "positive", {
        labelKey: "insight.label.evEbitda", labelParams: p, labelEn,
        detailKey: "insight.detail.evEbitda.low",
        detailEn: "EV/EBITDA under 10 is typically viewed as attractively valued.",
      });
    } else if (ev > 20) {
      flag(out, "Valuation", "negative", {
        labelKey: "insight.label.evEbitda", labelParams: p, labelEn,
        detailKey: "insight.detail.evEbitda.high",
        detailEn: "EV/EBITDA above 20 signals a premium multiple — sensitive to earnings shocks.",
      });
    }
  }
}

function checkProfitability(info: Info, out: Insight[]): void {
  const roe = toNum(info.returnOnEquity);
  if (roe !== null) {
    const p = { value: (roe * 100).toFixed(1) };
    const labelEn = `ROE ${p.value}%`;
    if (roe > 0.15) {
      flag(out, "Profitability", "positive", {
        labelKey: "insight.label.roe", labelParams: p, labelEn,
        detailKey: "insight.detail.roe.high",
        detailEn: "Return on Equity above 15% — the company earns strong returns on shareholder capital.",
      });
    } else if (roe < 0.05) {
      flag(out, "Profitability", "negative", {
        labelKey: "insight.label.roe", labelParams: p, labelEn,
        detailKey: "insight.detail.roe.low",
        detailEn: "Return on Equity below 5% — capital is not being deployed productively.",
      });
    }
  }

  const roa = toNum(info.returnOnAssets);
  if (roa !== null) {
    const p = { value: (roa * 100).toFixed(1) };
    const labelEn = `ROA ${p.value}%`;
    if (roa > 0.07) {
      flag(out, "Profitability", "positive", {
        labelKey: "insight.label.roa", labelParams: p, labelEn,
        detailKey: "insight.detail.roa.high",
        detailEn: "Return on Assets above 7% — efficient use of the balance sheet.",
      });
    } else if (roa < 0.02) {
      flag(out, "Profitability", "negative", {
        labelKey: "insight.label.roa", labelParams: p, labelEn,
        detailKey: "insight.detail.roa.low",
        detailEn: "Return on Assets below 2% — the business is not generating much from its assets.",
      });
    }
  }

  const op = toNum(info.operatingMargins);
  if (op !== null) {
    const p = { value: (op * 100).toFixed(1) };
    const labelEn = `Op. margin ${p.value}%`;
    if (op > 0.20) {
      flag(out, "Profitability", "positive", {
        labelKey: "insight.label.opMargin", labelParams: p, labelEn,
        detailKey: "insight.detail.opMargin.high",
        detailEn: "Operating margin above 20% points to pricing power or scale.",
      });
    } else if (op < 0.05) {
      flag(out, "Profitability", "negative", {
        labelKey: "insight.label.opMargin", labelParams: p, labelEn,
        detailKey: "insight.detail.opMargin.low",
        detailEn: "Operating margin below 5% — thin operating profit cushion.",
      });
    }
  }

  const pm = toNum(info.profitMargins);
  if (pm !== null) {
    const p = { value: (pm * 100).toFixed(1) };
    const labelEn = `Profit margin ${p.value}%`;
    if (pm > 0.15) {
      flag(out, "Profitability", "positive", {
        labelKey: "insight.label.profitMargin", labelParams: p, labelEn,
        detailKey: "insight.detail.profitMargin.high",
        detailEn: "Net profit margin above 15% converts a large fraction of revenue to shareholders.",
      });
    } else if (pm < 0) {
      flag(out, "Profitability", "negative", {
        labelKey: "insight.label.profitMargin", labelParams: p, labelEn,
        detailKey: "insight.detail.profitMargin.negative",
        detailEn: "Negative net margin — the company is currently loss-making.",
      });
    }
  }
}

function checkHealth(info: Info, out: Insight[]): void {
  const cur = toNum(info.currentRatio);
  if (cur !== null) {
    const p = { value: cur.toFixed(2) };
    const labelEn = `Current ratio ${p.value}`;
    if (cur >= 1.5) {
      flag(out, "Financial Health", "positive", {
        labelKey: "insight.label.currentRatio", labelParams: p, labelEn,
        detailKey: "insight.detail.currentRatio.high",
        detailEn: "Current ratio above 1.5 — comfortable short-term liquidity.",
      });
    } else if (cur < 1.0) {
      flag(out, "Financial Health", "negative", {
        labelKey: "insight.label.currentRatio", labelParams: p, labelEn,
        detailKey: "insight.detail.currentRatio.low",
        detailEn: "Current ratio below 1 — short-term liabilities exceed short-term assets.",
      });
    }
  }

  const rawDe = toNum(info.debtToEquity);
  if (rawDe !== null) {
    // yfinance sometimes reports D/E as a percentage (120 = 1.20); normalise.
    const de = rawDe > 5 ? rawDe / 100 : rawDe;
    const p = { value: de.toFixed(2) };
    const labelEn = `D/E ${p.value}`;
    if (de < 0.5) {
      flag(out, "Financial Health", "positive", {
        labelKey: "insight.label.de", labelParams: p, labelEn,
        detailKey: "insight.detail.de.low",
        detailEn: "Debt-to-Equity below 0.5 — conservative capital structure.",
      });
    } else if (de > 2.0) {
      flag(out, "Financial Health", "negative", {
        labelKey: "insight.label.de", labelParams: p, labelEn,
        detailKey: "insight.detail.de.high",
        detailEn: "Debt-to-Equity above 2 — leverage is elevated; earnings must service the debt.",
      });
    }
  }

  const fcf = toNum(info.freeCashflow);
  if (fcf !== null) {
    if (fcf > 0) {
      flag(out, "Financial Health", "positive", {
        labelKey: "insight.label.fcfPositive", labelEn: "FCF positive",
        detailKey: "insight.detail.fcf.positive",
        detailEn: "Free cash flow is positive — the business self-funds after capex.",
      });
    } else {
      flag(out, "Financial Health", "negative", {
        labelKey: "insight.label.fcfNegative", labelEn: "FCF negative",
        detailKey: "insight.detail.fcf.negative",
        detailEn: "Free cash flow is negative — external financing may be needed to sustain operations.",
      });
    }
  }
}

function checkGrowth(info: Info, out: Insight[]): void {
  const rev = toNum(info.revenueGrowth);
  if (rev !== null) {
    const p = { value: (rev * 100).toFixed(1) };
    if (rev > 0.10) {
      flag(out, "Growth", "positive", {
        labelKey: "insight.label.revenueUp", labelParams: p,
        labelEn: `Revenue +${p.value}%`,
        detailKey: "insight.detail.revenue.up",
        detailEn: "Year-over-year revenue growth above 10% — the top line is expanding.",
      });
    } else if (rev < 0) {
      flag(out, "Growth", "negative", {
        labelKey: "insight.label.revenueDown", labelParams: p,
        labelEn: `Revenue ${p.value}%`,
        detailKey: "insight.detail.revenue.down",
        detailEn: "Revenue is contracting versus the prior year.",
      });
    }
  }

  const earn = toNum(info.earningsGrowth);
  if (earn !== null) {
    const p = { value: (earn * 100).toFixed(1) };
    if (earn > 0.10) {
      flag(out, "Growth", "positive", {
        labelKey: "insight.label.earningsUp", labelParams: p,
        labelEn: `Earnings +${p.value}%`,
        detailKey: "insight.detail.earnings.up",
        detailEn: "Year-over-year earnings growth above 10% — bottom-line momentum.",
      });
    } else if (earn < -0.10) {
      flag(out, "Growth", "negative", {
        labelKey: "insight.label.earningsDown", labelParams: p,
        labelEn: `Earnings ${p.value}%`,
        detailKey: "insight.detail.earnings.down",
        detailEn: "Earnings have contracted materially versus the prior year.",
      });
    }
  }
}

function checkDividend(info: Info, out: Insight[]): void {
  const yld = toNum(info.dividendYield);
  if (yld === null || yld === 0) return;
  const yieldParams = { value: (yld * 100).toFixed(2) };
  const yieldLabelEn = `Yield ${yieldParams.value}%`;
  if (yld > 0.06) {
    flag(out, "Dividend", "negative", {
      labelKey: "insight.label.yield", labelParams: yieldParams, labelEn: yieldLabelEn,
      detailKey: "insight.detail.yield.high",
      detailEn: "Yield above 6% — attractive, but historically high yields often precede a cut. Check payout ratio.",
    });
  } else if (yld > 0.02) {
    flag(out, "Dividend", "positive", {
      labelKey: "insight.label.yield", labelParams: yieldParams, labelEn: yieldLabelEn,
      detailKey: "insight.detail.yield.healthy",
      detailEn: "Healthy dividend yield above 2% — adds to total return.",
    });
  }

  const payout = toNum(info.payoutRatio);
  if (payout !== null) {
    const p = { value: (payout * 100).toFixed(1) };
    const labelEn = `Payout ${p.value}%`;
    if (payout > 0 && payout < 0.60) {
      flag(out, "Dividend", "positive", {
        labelKey: "insight.label.payout", labelParams: p, labelEn,
        detailKey: "insight.detail.payout.low",
        detailEn: "Payout ratio under 60% — dividend is well-covered by earnings.",
      });
    } else if (payout > 0.90) {
      flag(out, "Dividend", "negative", {
        labelKey: "insight.label.payout", labelParams: p, labelEn,
        detailKey: "insight.detail.payout.high",
        detailEn: "Payout ratio above 90% — the dividend consumes nearly all earnings, leaving little cushion.",
      });
    }
  }
}

function checkTechnical(signals: LatestSignals | null, out: Insight[]): void {
  if (!signals) return;

  if (signals.trend.includes("Bullish")) {
    flag(out, "Technical", "positive", {
      labelKey: "insight.label.uptrend", labelEn: "Uptrend regime",
      detailKey: "insight.detail.uptrend",
      detailEn: "SMA 50 is above SMA 200 and price is above SMA 50 — classic golden-cross setup.",
    });
  } else if (signals.trend.includes("Bearish")) {
    flag(out, "Technical", "negative", {
      labelKey: "insight.label.downtrend", labelEn: "Downtrend regime",
      detailKey: "insight.detail.downtrend",
      detailEn: "SMA 50 is below SMA 200 and price is below SMA 50 — death-cross regime.",
    });
  }

  // signals.rsi looks like "Overbought (72.3)" — split so we can localize the
  // word ("Overbought" -> "超买") separately from the numeric reading.
  const rsiMatch = signals.rsi.match(/^([A-Za-z]+)\s*\(([^)]+)\)\s*$/);
  const rsiNumber = rsiMatch?.[2] ?? "";
  if (signals.rsi.includes("Overbought")) {
    flag(out, "Technical", "negative", {
      labelKey: "insight.label.rsiOverbought",
      labelParams: { number: rsiNumber },
      labelEn: signals.rsi,
      detailKey: "insight.detail.rsi.overbought",
      detailEn: "RSI(14) above 70 — short-term momentum is stretched; expect a pullback risk.",
    });
  } else if (signals.rsi.includes("Oversold")) {
    flag(out, "Technical", "positive", {
      labelKey: "insight.label.rsiOversold",
      labelParams: { number: rsiNumber },
      labelEn: signals.rsi,
      detailKey: "insight.detail.rsi.oversold",
      detailEn: "RSI(14) below 30 — potentially oversold and due for a bounce.",
    });
  }

  if (signals.macd === "Bullish") {
    flag(out, "Technical", "positive", {
      labelKey: "insight.label.macdBullish", labelEn: "MACD bullish",
      detailKey: "insight.detail.macd.bullish",
      detailEn: "MACD is above its signal line — momentum favours the upside.",
    });
  } else if (signals.macd === "Bearish") {
    flag(out, "Technical", "negative", {
      labelKey: "insight.label.macdBearish", labelEn: "MACD bearish",
      detailKey: "insight.detail.macd.bearish",
      detailEn: "MACD is below its signal line — momentum favours the downside.",
    });
  }

  if (signals.bollinger.includes("above upper")) {
    flag(out, "Technical", "negative", {
      labelKey: "insight.label.bbAboveUpper", labelEn: "Above upper band",
      detailKey: "insight.detail.bb.aboveUpper",
      detailEn: "Price is riding the upper Bollinger band — mean-reversion pressure.",
    });
  } else if (signals.bollinger.includes("below lower")) {
    flag(out, "Technical", "positive", {
      labelKey: "insight.label.bbBelowLower", labelEn: "Below lower band",
      detailKey: "insight.detail.bb.belowLower",
      detailEn: "Price is hugging the lower Bollinger band — potential reversion higher.",
    });
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
    const p = { value: (r3m * 100).toFixed(1) };
    if (r3m > 0.05) {
      flag(out, "Momentum", "positive", {
        labelKey: "insight.label.r3mUp", labelParams: p,
        labelEn: `3M return +${p.value}%`,
        detailKey: "insight.detail.r3m.up",
        detailEn: "Positive 3-month return — sustained buying interest.",
      });
    } else if (r3m < -0.10) {
      flag(out, "Momentum", "negative", {
        labelKey: "insight.label.r3mDown", labelParams: p,
        labelEn: `3M return ${p.value}%`,
        detailKey: "insight.detail.r3m.down",
        detailEn: "3-month return worse than -10% — recent selling pressure.",
      });
    }
  }
  if (r1y !== null) {
    const p = { value: (r1y * 100).toFixed(1) };
    if (r1y > 0.15) {
      flag(out, "Momentum", "positive", {
        labelKey: "insight.label.r1yUp", labelParams: p,
        labelEn: `1Y return +${p.value}%`,
        detailKey: "insight.detail.r1y.up",
        detailEn: "Trailing 1-year return above 15% — outperforming a passive benchmark expectation.",
      });
    } else if (r1y < -0.15) {
      flag(out, "Momentum", "negative", {
        labelKey: "insight.label.r1yDown", labelParams: p,
        labelEn: `1Y return ${p.value}%`,
        detailKey: "insight.detail.r1y.down",
        detailEn: "Down more than 15% over the past year — persistent underperformance.",
      });
    }
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
      const p = { value: (annVol * 100).toFixed(0) };
      flag(out, "Momentum", "negative", {
        labelKey: "insight.label.annVolHigh", labelParams: p,
        labelEn: `Ann. vol. ${p.value}%`,
        detailKey: "insight.detail.annVol.high",
        detailEn: "Annualised volatility above 50% — high price swings; size positions accordingly.",
      });
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

const VERDICT_LADDER: Array<[number, VerdictKey, string, string]> = [
  [80, "strong",     "Strong profile",     "🌟"],
  [65, "attractive", "Attractive profile", "✅"],
  [45, "mixed",      "Mixed signals",      "⚖️"],
  [30, "cautious",   "Cautious profile",   "⚠️"],
  [0,  "concerning", "Concerning profile", "🚫"],
];

function verdictOf(score: number): [VerdictKey, string, string] {
  for (const [threshold, key, label, emoji] of VERDICT_LADDER) {
    if (score >= threshold) return [key, label, emoji];
  }
  const last = VERDICT_LADDER[VERDICT_LADDER.length - 1]!;
  return [last[1], last[2], last[3]];
}

function composeEnglishConclusion(
  ticker: string,
  parts: ConclusionParts,
): string {
  const positives = parts.topPositives;
  const negatives = parts.topNegatives;
  const strong = parts.strongCategories.map((c) => c.toLowerCase());
  const weak = parts.weakCategories.map((c) => c.toLowerCase());
  const pieces: string[] = [];
  const posCount = parts.positivesCount;
  const negCount = parts.negativesCount;

  if (posCount && !negCount) {
    pieces.push(`**${ticker}** looks broadly favourable — every indicator we checked reads positively`);
  } else if (negCount && !posCount) {
    pieces.push(`**${ticker}** shows weakness across the indicators we checked`);
  } else if (posCount > negCount * 1.5) {
    pieces.push(`**${ticker}** looks broadly favourable, with ${posCount} positive signals versus ${negCount} concerns`);
  } else if (negCount > posCount * 1.5) {
    pieces.push(`**${ticker}** raises meaningful concerns, with ${negCount} negative signals versus ${posCount} positives`);
  } else {
    pieces.push(`**${ticker}** shows a mixed picture — ${posCount} positives balanced by ${negCount} concerns`);
  }
  if (strong.length) pieces.push(`. Strengths cluster in **${strong.join(", ")}**`);
  if (weak.length) {
    pieces.push(`${strong.length ? ", while weaknesses appear in " : ". Weaknesses appear in "}**${weak.join(", ")}**`);
  }
  pieces.push(". ");
  if (positives.length) {
    pieces.push("Notable positives: " + positives.slice(0, 2).map((p) => p.detail.replace(/\.+$/, "")).join("; ") + ". ");
  }
  if (negatives.length) {
    pieces.push("Key concerns: " + negatives.slice(0, 2).map((n) => n.detail.replace(/\.+$/, "")).join("; ") + ".");
  }
  return pieces.join("");
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
  const [verdictKey, verdictLabel, verdictEmoji] = verdictOf(overall);

  const strongCategories = (Object.entries(scores) as [Category, number][])
    .filter(([, s]) => s >= 0.5).map(([c]) => c);
  const weakCategories = (Object.entries(scores) as [Category, number][])
    .filter(([, s]) => s <= -0.5).map(([c]) => c);

  const conclusionParts: ConclusionParts = {
    ticker,
    positivesCount: positives.length,
    negativesCount: negatives.length,
    strongCategories,
    weakCategories,
    topPositives: positives.slice(0, 2),
    topNegatives: negatives.slice(0, 2),
  };

  return {
    insights: findings,
    positives, negatives, neutrals,
    categoryScores: scores,
    categoryCounts: counts,
    overallScore: overall,
    verdictKey,
    verdictLabel,
    verdictEmoji,
    conclusionParts,
    conclusion: composeEnglishConclusion(ticker, conclusionParts),
  };
}
