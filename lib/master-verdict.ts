/**
 * Master verdict — the *one* place a user looks to decide "should I
 * buy or sell this ticker right now?"
 *
 * The app already has four independently-useful signal engines:
 *
 *   1. Technical signal      (`computeTechnicalSignal`)   — 9 checks,
 *      trend/momentum/mean-reversion/levels/mood, score in [-1, +1]
 *      with a 5-band verdict.
 *   2. 6-Signal resonance    (`computeResonance`)          — a fast
 *      moomoo/TDX momentum strategy: fires BUY when all six checks
 *      align bullish, SELL when all six align bearish.
 *   3. Fundamentals score    (`Analysis.overallScore`)     — the
 *      overview page's 0–100 KPI-derived score.
 *   4. News sentiment        (`Aggregate.score`)           — time-decayed
 *      finance-tuned sentiment over recent headlines.
 *
 * Plus a market-wide backdrop:
 *   5. Fear & Greed          (0–100, contrarian at extremes)
 *
 * Each of those has its own card and its own audience, but nobody
 * wants to open five tabs and reason across five scales to conclude
 * "buy". This module fuses them into ONE score, one verdict, one
 * "why" list — the baseline the user reviews first, with the
 * sub-scorers available as detail below.
 *
 * Design principles
 * -----------------
 * * **Weighted, transparent aggregation.** No black boxes. The
 *   weights live in `SOURCE_WEIGHTS` as a single named table and each
 *   contributing source appears in `sources[]` with its normalized
 *   score, weight, contribution, and rationale.
 * * **Everything normalized to [-1, +1].** Regardless of how the
 *   sub-scorer expresses itself, the master layer converts to a common
 *   scale and blends. Missing inputs are simply dropped — coverage
 *   captures "how much of the picture was available", agreement
 *   captures "how much the available pieces agreed".
 * * **Regime propagation.** The technical scorer's regime (bull /
 *   bear / flat) is threaded through so the UI can show a "trend
 *   context" chip and the sentiment pull is halved when the trend is
 *   strongly opposite (news euphoria in a confirmed downtrend is
 *   noise; news gloom in a confirmed uptrend is a buy-the-dip cue —
 *   both cases we don't want sentiment to steamroll the trend).
 * * **Same 5-band verdict as the technical scorer.** Users already
 *   know the strong_buy / buy / hold / sell / strong_sell language
 *   from the Charts page; no new vocabulary to learn.
 * * **Explainable rationale.** `topReasons` is the ranked list of the
 *   biggest drivers (by absolute weighted contribution), regardless of
 *   which sub-scorer they came from. Bullish reasons first, then
 *   bearish, capped at ~5 total.
 *
 * What this is NOT
 * ----------------
 * * NOT a backtested trading strategy — no equity curve, no forward
 *   returns, no position sizing. This is a *decision aid*, not an
 *   automated trader.
 * * NOT a recommendation. The verdict is a summary of *what today's
 *   readings say*, with all the biases of the underlying scorers.
 * * NOT time-aware beyond what each sub-scorer bakes in. There is no
 *   attempt to smooth the master score across bars (hysteresis, if
 *   added later, would live here).
 */

import type { TechnicalSignal, Verdict } from "./technical-signal";
import { verdictFromScore } from "./technical-signal";
import type { ResonanceResult } from "./resonance";
import type { Aggregate as NewsAggregate } from "./sentiment";
import type { Analysis } from "./insights";

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

export type MasterSourceId =
  | "technical"
  | "resonance"
  | "fundamentals"
  | "sentiment"
  | "mood";

export interface MasterSource {
  /** Stable machine id — matches the i18n key path (`master.src.<id>`). */
  id: MasterSourceId;
  /**
   * Normalized score in [-1, +1] for this source, or `null` when the
   * source didn't have enough data to vote. Nulls are dropped from the
   * weighted average but reported so the UI can render "not available".
   */
  score: number | null;
  /** Configured weight (see `SOURCE_WEIGHTS`) before any regime discount. */
  baseWeight: number;
  /**
   * Effective weight actually applied to this source on this bar. May
   * be lower than `baseWeight` when a regime-based discount is in
   * effect (e.g. sentiment halved when it disagrees with a strong
   * trend). Always ≤ `baseWeight`.
   */
  effectiveWeight: number;
  /**
   * Signed contribution to the weighted average — `score *
   * effectiveWeight`. `null` when `score` is `null`. Sorted absolute
   * value of this field is what `topReasons` uses to rank drivers.
   */
  contribution: number | null;
  /**
   * i18n key for the *source label* ("Technical Signal", "Resonance",
   * etc.). The UI localises via this key.
   */
  labelKey: string;
  /**
   * A short human-readable phrase describing what this source is
   * saying on this bar. Falls back to English if the localised
   * version is missing.
   */
  labelEn: string;
  /**
   * A short phrase describing the *why* — used as the rationale line
   * in the top-reasons list. English fallback for missing i18n.
   */
  rationaleKey: string;
  rationaleEn: string;
  /**
   * Optional numeric params for interpolation into localised
   * rationale (e.g. `{ score: 78, aligned: 5 }`).
   */
  rationaleParams?: Record<string, string | number>;
}

export interface MasterVerdict {
  /** Same 5-band scheme as the technical signal — reuses the vocabulary. */
  verdict: Verdict;
  /** Weighted score in [-1, +1]. */
  score: number;
  /**
   * Fraction of the total *base* weight that actually voted. High
   * coverage + high agreement = strongest possible signal; low
   * coverage = the picture is thin (e.g. no news, no F&G) and the
   * verdict is less reliable.
   */
  coverage: number;
  /**
   * `|Σ bullish − Σ bearish| / Σ |contribution|`, in [0, 1]. 1 = every
   * available source agreed on direction, 0 = perfect conflict. `null`
   * when no source voted.
   */
  agreement: number | null;
  /**
   * Full breakdown per source — always the same 5 entries in a fixed
   * order (technical, resonance, fundamentals, sentiment, mood), with
   * `score = null` for sources that didn't vote.
   */
  sources: MasterSource[];
  /**
   * Trend regime (from the technical scorer) — surfaced so the UI can
   * show a "context" chip. `flat` when the technical signal wasn't
   * available.
   */
  regime: "bull" | "bear" | "flat";
  /**
   * Top ~5 drivers, ranked by absolute contribution. Bullish drivers
   * first, then bearish. Excludes sources that didn't vote and
   * sources whose contribution was near zero.
   */
  topReasons: MasterSource[];
  /**
   * True when at least one source voted. `false` means every input
   * was missing or in warm-up — the UI should show a "not enough
   * data" state.
   */
  hasData: boolean;
}

// ---------------------------------------------------------------------------
// Weight table — the *only* place the sub-scorer weights live.
//
// Rationale for the chosen split:
//   Technical (40%)    — the most granular, multi-factor signal in the
//                        app and the one most users came from a
//                        Charts-page workflow. Anchoring the master
//                        verdict here means "if you already trusted
//                        the technical card, the master is a
//                        superset".
//   Fundamentals (25%) — long-horizon anchor. Fundamentals move
//                        slowly so a heavier weight here is a
//                        stability contribution, not a signal-timing
//                        contribution.
//   Resonance (15%)    — high-conviction momentum trigger. Rare
//                        events, so weighting it too heavily would
//                        make the master flicker every time the
//                        6-signal alignment forms or breaks; 15%
//                        gives it a real voice without dominance.
//   Sentiment (15%)    — short-horizon pulse. Overlaps with both
//                        technical (via the score's momentum leg) and
//                        news catalysts; useful but rate-limited by
//                        regime discount below.
//   Mood (5%)          — market-wide contrarian backdrop. Small
//                        because it's a broad-brush signal that
//                        doesn't know the ticker's beta (see review).
// ---------------------------------------------------------------------------

export const SOURCE_WEIGHTS: Record<MasterSourceId, number> = {
  technical: 0.40,
  fundamentals: 0.25,
  resonance: 0.15,
  sentiment: 0.15,
  mood: 0.05,
};

// A source's contribution is meaningful for the top-reasons list only
// when it accounts for at least this fraction of the max possible
// contribution. Prevents tiny drift-y sources from cluttering the
// "why" panel with noise.
const REASON_MIN_ABS = 0.02;

// ---------------------------------------------------------------------------
// Sub-scorer → normalized [-1, +1] adapters
// ---------------------------------------------------------------------------

/**
 * Technical scorer already emits `score ∈ [-1, +1]`. Just pass through.
 * Rationale reads from bullishCount/bearishCount so the master card's
 * "why" line stays useful without dumping the full contributor list.
 *
 * Low-conviction clamp
 * --------------------
 * When the technical scorer downgraded its own verdict from buy/sell
 * to hold (i.e., `sig.verdict !== sig.rawVerdict`), the raw score
 * still lives in the buy or sell band (|score| ≥ 0.15). Feeding that
 * raw score into the master would push the overall verdict toward
 * buy/sell even though we already decided the underlying data wasn't
 * strong enough to justify a directional call. Clamp the contribution
 * into the "hold" band [−0.15, +0.15] so a downgraded technical can
 * still nudge the master (it *is* leaning), but can't overrule the
 * downgrade the technical card is showing to the user. Keeps the two
 * layers internally consistent: whatever verdict the technical card
 * displays, the master's math treats the source as being in the same
 * band.
 */
const HOLD_BAND_MAX = 0.15;

function adaptTechnical(sig: TechnicalSignal | null): MasterSource {
  const base: Omit<MasterSource, "score" | "contribution" | "effectiveWeight"> = {
    id: "technical",
    baseWeight: SOURCE_WEIGHTS.technical,
    labelKey: "master.src.technical.label",
    labelEn: "Technical signal",
    rationaleKey: "master.src.technical.rationale",
    rationaleEn: "Technical signal is neutral.",
  };
  if (!sig || sig.rows.length === 0) {
    return { ...base, score: null, contribution: null, effectiveWeight: 0 };
  }

  const downgraded = sig.verdict !== sig.rawVerdict;
  const effectiveScore = downgraded
    ? Math.max(-HOLD_BAND_MAX, Math.min(HOLD_BAND_MAX, sig.score))
    : sig.score;

  const rawPct = Math.round(sig.score * 100);
  const effPct = Math.round(effectiveScore * 100);
  const params: Record<string, string | number> = {
    verdict: sig.verdict,
    rawVerdict: sig.rawVerdict,
    score: effPct,
    rawScore: rawPct,
    bull: sig.bullishCount,
    bear: sig.bearishCount,
    conviction: sig.conviction,
  };

  const rationaleEn = downgraded
    ? `Technical raw score ${rawPct >= 0 ? "+" : ""}${rawPct} clamped to ${effPct >= 0 ? "+" : ""}${effPct} (low conviction — ${sig.bullishCount} bull / ${sig.bearishCount} bear).`
    : `Technical score ${rawPct >= 0 ? "+" : ""}${rawPct} (${sig.bullishCount} bull / ${sig.bearishCount} bear signals).`;

  const rationaleKey = downgraded
    ? "master.src.technical.rationale.downgraded"
    : "master.src.technical.rationale";

  return {
    ...base,
    score: effectiveScore,
    effectiveWeight: SOURCE_WEIGHTS.technical,
    contribution: effectiveScore * SOURCE_WEIGHTS.technical,
    rationaleKey,
    rationaleEn,
    rationaleParams: params,
  };
}

/**
 * Resonance is a categorical strategy. Map its state to a numeric score
 * that captures both *side* and *conviction*:
 *
 *   verdict = buy      →  +1.0   (fresh bullish alignment, strongest)
 *   verdict = holding  →  +0.75  (bullish alignment persists)
 *   verdict = sell     →  -1.0
 *   verdict = avoid    →  -0.75
 *   verdict = out      →  (alignedCount − bearishAligned) / 6  ∈ [-1, +1]
 *                        — partial alignment gives a gentle nudge without
 *                        pretending the strategy is triggering
 *   verdict = warmup   →  null (not enough bars)
 */
function adaptResonance(res: ResonanceResult | null): MasterSource {
  const base: Omit<MasterSource, "score" | "contribution" | "effectiveWeight"> = {
    id: "resonance",
    baseWeight: SOURCE_WEIGHTS.resonance,
    labelKey: "master.src.resonance.label",
    labelEn: "6-Signal resonance",
    rationaleKey: "master.src.resonance.rationale",
    rationaleEn: "Resonance strategy is inactive.",
  };
  if (!res || res.verdict === "warmup") {
    return { ...base, score: null, contribution: null, effectiveWeight: 0 };
  }
  let score: number;
  let rationaleKey = "master.src.resonance.rationale.out";
  let rationaleEn = `Resonance ${res.alignedCount}/6 bullish, ${res.bearishAlignedCount}/6 bearish.`;
  switch (res.verdict) {
    case "buy":
      score = 1;
      rationaleKey = "master.src.resonance.rationale.buy";
      rationaleEn = "Fresh 6/6 bullish alignment (rare trigger).";
      break;
    case "holding":
      score = 0.75;
      rationaleKey = "master.src.resonance.rationale.holding";
      rationaleEn = `6/6 bullish alignment holding (${Math.abs(res.streak)} bars).`;
      break;
    case "sell":
      score = -1;
      rationaleKey = "master.src.resonance.rationale.sell";
      rationaleEn = "Fresh 6/6 bearish alignment (rare trigger).";
      break;
    case "avoid":
      score = -0.75;
      rationaleKey = "master.src.resonance.rationale.avoid";
      rationaleEn = `6/6 bearish alignment holding (${Math.abs(res.streak)} bars).`;
      break;
    case "out":
    default: {
      // Partial alignment as a soft nudge — divide the *net* aligned
      // count by 6 for a value in [-1, +1] that peaks only at full
      // resonance (which the `buy`/`sell` cases above already handle).
      const net = res.alignedCount - res.bearishAlignedCount;
      score = Math.max(-1, Math.min(1, net / 6));
      break;
    }
  }
  return {
    ...base,
    score,
    effectiveWeight: SOURCE_WEIGHTS.resonance,
    contribution: score * SOURCE_WEIGHTS.resonance,
    rationaleKey,
    rationaleEn,
    rationaleParams: {
      verdict: res.verdict,
      aligned: res.alignedCount,
      bearAligned: res.bearishAlignedCount,
      streak: Math.abs(res.streak),
    },
  };
}

/**
 * Fundamentals score arrives as 0–100. Map to [-1, +1] symmetrically
 * around 50: score = 50 → 0, score = 100 → +1, score = 0 → -1.
 */
function adaptFundamentals(analysis: Analysis | null | undefined): MasterSource {
  const base: Omit<MasterSource, "score" | "contribution" | "effectiveWeight"> = {
    id: "fundamentals",
    baseWeight: SOURCE_WEIGHTS.fundamentals,
    labelKey: "master.src.fundamentals.label",
    labelEn: "Fundamentals",
    rationaleKey: "master.src.fundamentals.rationale",
    rationaleEn: "Fundamentals score unavailable.",
  };
  if (!analysis || !Number.isFinite(analysis.overallScore)) {
    return { ...base, score: null, contribution: null, effectiveWeight: 0 };
  }
  const s01 = Math.max(0, Math.min(100, analysis.overallScore));
  const score = (s01 - 50) / 50;
  return {
    ...base,
    score,
    effectiveWeight: SOURCE_WEIGHTS.fundamentals,
    contribution: score * SOURCE_WEIGHTS.fundamentals,
    rationaleKey: "master.src.fundamentals.rationale.value",
    rationaleEn: `Fundamentals overall ${s01.toFixed(0)}/100 (${analysis.positives.length} positives / ${analysis.negatives.length} concerns).`,
    rationaleParams: {
      overall: Math.round(s01),
      positives: analysis.positives.length,
      negatives: analysis.negatives.length,
    },
  };
}

/**
 * News aggregate already emits `score ∈ [-1, +1]`. Empty feeds (no
 * items) come through as score=0 label=neutral — treat that as "no
 * data" and return null so we don't dilute coverage with an empty
 * feed's zero vote.
 */
function adaptSentiment(news: NewsAggregate | null | undefined): MasterSource {
  const base: Omit<MasterSource, "score" | "contribution" | "effectiveWeight"> = {
    id: "sentiment",
    baseWeight: SOURCE_WEIGHTS.sentiment,
    labelKey: "master.src.sentiment.label",
    labelEn: "News sentiment",
    rationaleKey: "master.src.sentiment.rationale",
    rationaleEn: "No recent news available.",
  };
  if (!news) {
    return {
      ...base,
      score: null,
      contribution: null,
      effectiveWeight: 0,
      rationaleKey: "master.src.sentiment.rationale.unavailable",
      rationaleEn: "News feed unavailable.",
    };
  }
  const total = news.counts.bullish + news.counts.bearish + news.counts.neutral;
  if (total === 0) {
    return {
      ...base,
      score: null,
      contribution: null,
      effectiveWeight: 0,
      rationaleKey: "master.src.sentiment.rationale.empty",
      rationaleEn: "No recent news headlines to score.",
    };
  }
  return {
    ...base,
    score: news.score,
    effectiveWeight: SOURCE_WEIGHTS.sentiment,
    contribution: news.score * SOURCE_WEIGHTS.sentiment,
    rationaleKey: `master.src.sentiment.rationale.${news.label}`,
    rationaleEn: `News is ${news.label} (${news.counts.bullish}↑ / ${news.counts.bearish}↓ / ${news.counts.neutral}·).`,
    rationaleParams: {
      label: news.label,
      score: news.score.toFixed(2),
      bull: news.counts.bullish,
      bear: news.counts.bearish,
      neutral: news.counts.neutral,
    },
  };
}

/**
 * F&G in [0, 100]. Only the extremes vote (contrarian by design). Below
 * 25 → +0.5 (extreme fear, contrarian buy). Above 75 → -0.5 (extreme
 * greed, contrarian sell). Otherwise `score: null` — the mood didn't
 * cross the vote threshold — but we still surface the actual reading in
 * the rationale so the source-breakdown row explains itself instead of
 * looking like a data outage.
 */
function adaptMood(fearGreedScore: number | null | undefined): MasterSource {
  const base: Omit<MasterSource, "score" | "contribution" | "effectiveWeight"> = {
    id: "mood",
    baseWeight: SOURCE_WEIGHTS.mood,
    labelKey: "master.src.mood.label",
    labelEn: "Market mood (F&G)",
    rationaleKey: "master.src.mood.rationale.unavailable",
    rationaleEn: "Fear & Greed Index unavailable.",
  };
  if (fearGreedScore === null || fearGreedScore === undefined || !Number.isFinite(fearGreedScore)) {
    // Truly missing (CNN blocked, endpoint failure). Rationale above makes that clear.
    return { ...base, score: null, contribution: null, effectiveWeight: 0 };
  }
  if (fearGreedScore < 25) {
    const score = 0.5;
    return {
      ...base,
      score,
      effectiveWeight: SOURCE_WEIGHTS.mood,
      contribution: score * SOURCE_WEIGHTS.mood,
      rationaleKey: "master.src.mood.rationale.extremeFear",
      rationaleEn: `Extreme Fear (F&G ${fearGreedScore.toFixed(0)}) — contrarian buy backdrop.`,
      rationaleParams: { fg: fearGreedScore.toFixed(0) },
    };
  }
  if (fearGreedScore > 75) {
    const score = -0.5;
    return {
      ...base,
      score,
      effectiveWeight: SOURCE_WEIGHTS.mood,
      contribution: score * SOURCE_WEIGHTS.mood,
      rationaleKey: "master.src.mood.rationale.extremeGreed",
      rationaleEn: `Extreme Greed (F&G ${fearGreedScore.toFixed(0)}) — contrarian sell backdrop.`,
      rationaleParams: { fg: fearGreedScore.toFixed(0) },
    };
  }
  // Data present but between the extremes — surface the value so the row
  // is informative rather than looking like "N/A". `score: null` keeps
  // the mood out of the weighted average (design intent), but the
  // rationale text tells the user the reading exists and why it didn't
  // vote today.
  const rounded = Math.round(fearGreedScore);
  const zone: "fear" | "neutral" | "greed" =
    fearGreedScore < 45 ? "fear" : fearGreedScore > 55 ? "greed" : "neutral";
  return {
    ...base,
    score: null,
    contribution: null,
    effectiveWeight: 0,
    rationaleKey: `master.src.mood.rationale.${zone}`,
    rationaleEn: `F&G at ${rounded} (${zone}) — not extreme enough to trigger a contrarian vote.`,
    rationaleParams: { fg: rounded, zone },
  };
}

// ---------------------------------------------------------------------------
// Regime-based sentiment discount
// ---------------------------------------------------------------------------

/**
 * Halve sentiment's effective weight when it disagrees strongly with
 * the trend regime — news euphoria in a confirmed downtrend or news
 * gloom in a confirmed uptrend tends to be noise-around-a-catalyst
 * rather than a trend-flipping signal.
 *
 * The threshold is deliberately loose (|sentiment| > 0.15, same as
 * the "bullish/bearish" label cutoff) so borderline sentiment doesn't
 * trigger the discount.
 */
function applyRegimeDiscount(
  source: MasterSource,
  regime: "bull" | "bear" | "flat",
): MasterSource {
  if (source.id !== "sentiment" || source.score === null) return source;
  if (regime === "flat") return source;
  const disagreeing =
    (regime === "bull" && source.score < -0.15) ||
    (regime === "bear" && source.score > 0.15);
  if (!disagreeing) return source;
  const discounted = source.baseWeight * 0.5;
  return {
    ...source,
    effectiveWeight: discounted,
    contribution: source.score * discounted,
  };
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

export interface MasterInputs {
  technical: TechnicalSignal | null;
  resonance: ResonanceResult | null;
  fundamentals: Analysis | null | undefined;
  sentiment: NewsAggregate | null | undefined;
  fearGreedScore: number | null | undefined;
}

export function computeMasterVerdict(inp: MasterInputs): MasterVerdict {
  const regime: "bull" | "bear" | "flat" =
    inp.technical?.regime ?? "flat";

  // Build sources in a fixed order so `sources[i]` is stable for
  // consumers (tests, memoisation keys, i18n).
  const rawSources: MasterSource[] = [
    adaptTechnical(inp.technical),
    adaptResonance(inp.resonance),
    adaptFundamentals(inp.fundamentals),
    adaptSentiment(inp.sentiment),
    adaptMood(inp.fearGreedScore),
  ];
  const sources = rawSources.map((s) => applyRegimeDiscount(s, regime));

  // ---- Weighted average over voting sources ---------------------------
  let weightSum = 0;         // Σ effectiveWeight over voting sources
  let baseWeightAll = 0;     // Σ baseWeight over ALL sources (for coverage)
  let contribSum = 0;        // Σ contribution (signed)
  let absContribSum = 0;     // Σ |contribution| (for agreement)
  let bullContribSum = 0;
  let bearContribSum = 0;
  for (const src of sources) {
    baseWeightAll += src.baseWeight;
    if (src.score === null || src.contribution === null) continue;
    weightSum += src.effectiveWeight;
    contribSum += src.contribution;
    absContribSum += Math.abs(src.contribution);
    if (src.contribution > 0) bullContribSum += src.contribution;
    else if (src.contribution < 0) bearContribSum += -src.contribution;
  }

  const hasData = weightSum > 0;
  const score = hasData ? Math.max(-1, Math.min(1, contribSum / weightSum)) : 0;
  const coverage = baseWeightAll > 0 ? weightSum / baseWeightAll : 0;
  const agreement = absContribSum > 0
    ? Math.abs(bullContribSum - bearContribSum) / absContribSum
    : null;
  const verdict: Verdict = hasData ? verdictFromScore(score) : "hold";

  // ---- Top drivers -----------------------------------------------------
  // Sort by absolute contribution so the biggest movers surface first.
  // Within ties, bullish before bearish keeps the panel visually stable.
  const voters = sources.filter(
    (s) => s.contribution !== null && Math.abs(s.contribution) >= REASON_MIN_ABS,
  );
  voters.sort((a, b) => {
    const dA = Math.abs(a.contribution ?? 0);
    const dB = Math.abs(b.contribution ?? 0);
    if (dB !== dA) return dB - dA;
    return (b.contribution ?? 0) - (a.contribution ?? 0);
  });
  const topReasons = voters.slice(0, 5);

  return {
    verdict,
    score,
    coverage,
    agreement,
    sources,
    regime,
    topReasons,
    hasData,
  };
}
