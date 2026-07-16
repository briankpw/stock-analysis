/**
 * Finance-tuned sentiment scoring.
 *
 * The stock `vader-sentiment` npm package doesn't expose a mutable lexicon
 * (unlike the Python version), so instead of trying to inject our terms into
 * VADER's dictionary we run a **parallel finance-lexicon score** and blend
 * the two:
 *
 *   1. Compute VADER's compound score (good baseline for general English).
 *   2. Compute our own finance score by matching whole words against the
 *      ~120-entry finance lexicon we already tuned in Python.
 *   3. Blend: when finance-terms are present they dominate (60/40), when
 *      they aren't, VADER carries.
 *
 * This gives the same practical behaviour as the Python overlay (headlines
 * like "beats guidance" score bullish, "downgrade" scores bearish, etc.)
 * without needing to fork the VADER package.
 */

// The npm package ships CommonJS; give TS a light shape declaration.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import vader from "vader-sentiment";

type VaderScores = { neg: number; neu: number; pos: number; compound: number };
const analyser = vader.SentimentIntensityAnalyzer as {
  polarity_scores: (s: string) => VaderScores;
};

/**
 * Finance-specific lexicon: word → weight on VADER's [-4, +4] scale.
 * Values chosen to match the intensities of comparable VADER core terms
 * (e.g. "great"=3.1, "terrible"=-3.4).
 */
export const FINANCE_LEXICON: Readonly<Record<string, number>> = {
  // ---- Bullish ---------------------------------------------------------
  beat: 2.5, beats: 2.5, beating: 2.0, topped: 2.0, tops: 2.0,
  outperform: 2.5, outperforms: 2.5, outperforming: 2.0,
  upgrade: 2.8, upgrades: 2.5, upgraded: 2.5,
  surge: 2.5, surges: 2.5, surged: 2.5, surging: 2.5,
  soar: 2.8, soars: 2.8, soared: 2.8, soaring: 2.8,
  rally: 2.0, rallies: 2.0, rallied: 2.0, rallying: 2.0,
  jump: 1.5, jumps: 1.5, jumped: 1.5,
  climb: 1.2, climbs: 1.2, climbed: 1.2, climbing: 1.2,
  gain: 1.2, gains: 1.2, gained: 1.2,
  rise: 1.0, rises: 1.0, rose: 1.0, rising: 1.0,
  record: 1.5, peak: 1.5, peaked: 1.2,
  profit: 1.5, profits: 1.5, profitable: 2.0,
  buyback: 2.0, buybacks: 2.0, repurchase: 1.8, repurchases: 1.8,
  expansion: 1.2, expand: 1.2, expanding: 1.2, expanded: 1.2,
  growth: 1.2, growing: 1.2, grew: 1.2,
  bullish: 2.8, bull: 1.5,
  raise: 1.8, raises: 1.8, raised: 1.8, raising: 1.8,
  strong: 1.5, stronger: 1.5, strongest: 2.0, robust: 2.0,
  approve: 1.8, approved: 1.8, approves: 1.8, approval: 1.8,
  win: 1.5, wins: 1.5, won: 1.5, winning: 1.5,
  partnership: 1.0, acquire: 1.0, acquires: 1.0, acquisition: 0.8,
  breakthrough: 2.2, milestone: 1.5,
  boost: 1.5, boosts: 1.5, boosted: 1.5,
  exceed: 2.0, exceeds: 2.0, exceeded: 2.0, exceeding: 2.0,
  rebound: 1.8, rebounds: 1.8, rebounded: 1.8,
  innovate: 1.2, innovation: 1.2, innovative: 1.2,
  // ---- Bearish ---------------------------------------------------------
  miss: -2.5, misses: -2.5, missed: -2.5, missing: -2.0,
  underperform: -2.5, underperforms: -2.5, underperforming: -2.0,
  downgrade: -2.8, downgrades: -2.5, downgraded: -2.5,
  plunge: -2.8, plunges: -2.8, plunged: -2.8, plunging: -2.8,
  crash: -3.0, crashes: -3.0, crashed: -3.0, crashing: -3.0,
  tumble: -2.5, tumbles: -2.5, tumbled: -2.5, tumbling: -2.5,
  sink: -2.0, sinks: -2.0, sank: -2.0, sinking: -2.0,
  slump: -2.5, slumps: -2.5, slumped: -2.5, slumping: -2.5,
  slide: -1.5, slides: -1.5, slid: -1.5, sliding: -1.5,
  fall: -1.2, falls: -1.2, fell: -1.2, falling: -1.2,
  drop: -1.2, drops: -1.2, dropped: -1.2, dropping: -1.2,
  decline: -1.5, declines: -1.5, declined: -1.5, declining: -1.5,
  loss: -2.0, losses: -2.0, losing: -1.5,
  cut: -1.8, cuts: -1.8, cutting: -1.8,
  layoff: -2.5, layoffs: -2.5,
  lawsuit: -2.0, sued: -2.0, sues: -1.8, suing: -1.8,
  investigation: -2.0, investigations: -2.0, probe: -1.8, probing: -1.8,
  recall: -2.5, recalled: -2.5, recalls: -2.0,
  bankruptcy: -3.5, bankrupt: -3.5, insolvent: -3.5,
  delist: -2.5, delisted: -2.5, delisting: -2.5,
  fraud: -3.5, scandal: -3.0, corrupt: -3.0,
  warn: -2.0, warns: -2.0, warned: -2.0, warning: -1.8,
  concern: -1.2, concerns: -1.2, concerning: -1.5,
  worried: -1.2, worries: -1.2,
  bearish: -2.8, bear: -1.2,
  weak: -1.5, weaker: -1.5, weakness: -1.5, weakest: -2.0,
  risky: -1.5,
  unprofitable: -2.5,
  delay: -1.2, delays: -1.2, delayed: -1.5,
  reject: -2.0, rejects: -2.0, rejected: -2.0, rejection: -2.0,
  halt: -1.8, halts: -1.8, halted: -1.8,
  restructure: -1.5, restructuring: -1.5,
  impair: -2.0, impairment: -2.0, writedown: -2.0, writedowns: -2.0,
  shortage: -1.5, shortages: -1.5,
  downturn: -2.2, recession: -2.5,
  selloff: -2.0,
};

/**
 * Tokenise + score a text using the finance lexicon only. Returns a value
 * in [-1, +1] (the average lexicon weight of hit words, normalised).
 * Returns `null` if no finance words matched (caller falls back to VADER).
 */
function financeScore(text: string): number | null {
  // Simple word tokenizer: keep letters/hyphens, drop everything else.
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  let sum = 0;
  let hits = 0;
  for (const t of tokens) {
    const w = FINANCE_LEXICON[t];
    if (w !== undefined) {
      sum += w;
      hits++;
    }
  }
  if (hits === 0) return null;
  // Average weight / max (4) gives a well-behaved [-1, +1] mapping.
  const avg = sum / hits;
  return Math.max(-1, Math.min(1, avg / 4));
}

/**
 * Combined sentiment score for a headline.
 * Returns a compound score in [-1.0, +1.0].
 *
 * Blend rule: when finance-lexicon words are present, they dominate the
 * signal (60/40 finance/vader). When they aren't, VADER carries the score.
 */
export function scoreText(text: string): number {
  if (!text || !text.trim()) return 0;
  const vaderScore = analyser.polarity_scores(text).compound;
  const finScore = financeScore(text);
  if (finScore === null) return vaderScore;
  const blended = finScore * 0.6 + vaderScore * 0.4;
  return Math.max(-1, Math.min(1, blended));
}

// ---------------------------------------------------------------------------
// Classification thresholds (matches the Python implementation).
// ---------------------------------------------------------------------------
const BULL_THRESHOLD = 0.15;
const BEAR_THRESHOLD = -0.15;
const IMPACT_HIGH = 0.5;
const IMPACT_MEDIUM = 0.2;

export type SentimentLabel = "bullish" | "bearish" | "neutral";
export type ImpactLabel = "high" | "medium" | "low";

export function labelFromScore(score: number): SentimentLabel {
  if (score >= BULL_THRESHOLD) return "bullish";
  if (score <= BEAR_THRESHOLD) return "bearish";
  return "neutral";
}

export function impactFromScore(score: number): ImpactLabel {
  const m = Math.abs(score);
  if (m >= IMPACT_HIGH) return "high";
  if (m >= IMPACT_MEDIUM) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Time-weighted aggregation for a feed of scored items.
// ---------------------------------------------------------------------------
export interface Scored {
  score: number;
  publishedAt: Date;
  label: SentimentLabel;
}

/**
 * Exponential decay: a 3-day-old story counts half as much as a fresh one.
 * `halfLifeHours` defaults to 72h (same as Python).
 */
export function timeWeight(ageHours: number, halfLifeHours = 72): number {
  return Math.exp((-ageHours * Math.LN2) / Math.max(1, halfLifeHours));
}

export interface Aggregate {
  score: number;
  label: SentimentLabel;
  counts: { bullish: number; bearish: number; neutral: number };
}

export function aggregate(items: Scored[], now: Date = new Date()): Aggregate {
  const counts = { bullish: 0, bearish: 0, neutral: 0 };
  if (items.length === 0) return { score: 0, label: "neutral", counts };

  let weighted = 0;
  let total = 0;
  for (const it of items) {
    const ageHours = Math.max(
      0,
      (now.getTime() - it.publishedAt.getTime()) / 3_600_000,
    );
    const w = timeWeight(ageHours);
    weighted += it.score * w;
    total += w;
    counts[it.label] += 1;
  }
  const score = total > 0 ? weighted / total : 0;
  return {
    score: Math.round(score * 1000) / 1000,
    label: labelFromScore(score),
    counts,
  };
}
