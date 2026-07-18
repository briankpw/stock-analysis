/**
 * Delisting / bankruptcy risk-signal catalog.
 *
 * Every signal the analyser can emit is registered here. Keeping the
 * catalog in one file lets the UI, notifier, and analyser all agree on
 * severity ranking, i18n key layout, and the human explanation for
 * each rule — nothing is defined inside `analyzer.ts` where a reader
 * would have to hunt for it.
 *
 * The catalog is intentionally opinionated about what counts as
 * "immediate action needed" (`critical`) vs. "keep watching" (`high` /
 * `medium`). The thresholds trace back to real exchange-listing
 * rules:
 *
 *   * NYSE Rule 802.01C and NASDAQ Rule 5810(c)(3)(A): a stock is out
 *     of compliance with the minimum-price requirement once the
 *     30-trading-day average close drops below $1. Approximated here
 *     as "≥ 20 of the last 30 sessions below $1".
 *   * Common bankruptcy filing keywords are all in the SEC's Form 8-K
 *     Item 1.03 disclosure vocabulary.
 *   * "Going concern" / "material weakness" wording is what auditors
 *     use in an audit-report qualification (Auditing Standard 3105).
 *
 * The analyser is a pure function of (bars, news, quote); rate
 * limiting and duplicate-suppression happen in the engine layer.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Severity ranking used to sort signals, colour badges, and gate
 * notifications.
 *
 *   * `critical` — treat as "take action today" (bankruptcy filing,
 *     delisting notice, no bars from upstream, 90-day collapse).
 *   * `high`     — elevated risk that warrants a look this week
 *     (going concern, SEC action, sub-$1 for a month).
 *   * `medium`   — monitor (a single sub-$1 close, moderate
 *     drawdown, volume collapse without other triggers).
 */
export type RiskSeverity = "critical" | "high" | "medium";

/** Every distinct rule the analyser can fire. */
export type RiskSignalId =
  | "news.bankruptcy"
  | "news.delisting"
  | "news.goingConcern"
  | "news.sec"
  | "news.tradingHalt"
  | "data.noBars"
  | "bars.stale"
  | "price.collapse90d"
  | "price.drawdown60d"
  | "price.drawdown40d"
  | "price.subOneExtended"
  | "price.subOne"
  | "volume.collapse";

/**
 * A single fired signal. `params` is threaded through to the i18n
 * dictionary so the same key can render as "Below $1 for 24 of last
 * 30 sessions" for one ticker and "for 21 of last 30" for another
 * without spawning bespoke strings.
 *
 * `sourceUrl` / `sourceTitle` / `sourcePublishedAt` are only set for
 * signals that were derived from a specific news headline — they let
 * the UI render a "Read the article" deep-link instead of a bare
 * warning.
 */
export interface RiskSignal {
  id: RiskSignalId;
  severity: RiskSeverity;
  /** i18n dictionary key for the short label (e.g. "Bankruptcy filing news"). */
  labelKey: string;
  /** i18n dictionary key for the fuller explanation (may contain {vars}). */
  detailKey: string;
  /** Values interpolated into the detail string. */
  params?: Record<string, string | number>;
  sourceUrl?: string;
  sourceTitle?: string;
  sourcePublishedAt?: string;
}

/**
 * Result of analysing a single ticker.
 *
 *   * `overallSeverity` is the highest of all fired signals, or
 *     `null` when the ticker is clean. The tab hides itself entirely
 *     when *every* portfolio symbol resolves to `null`.
 *   * `fingerprint` is a cheap stable hash of the fired signal set —
 *     the notifier uses it to detect "new risks emerged" without
 *     comparing individual arrays across ticks.
 */
export interface RiskAssessment {
  ticker: string;
  fetchedAt: string;
  overallSeverity: RiskSeverity | null;
  signals: RiskSignal[];
  /** Latest close from the bars array; null if we got no bars. */
  latestClose: number | null;
  /** ISO date (YYYY-MM-DD) of the most recent bar. */
  latestBarDate: string | null;
  /** 90-day drawdown from the peak close, as a fraction (e.g. -0.65). */
  drawdown90d: number | null;
  /** Sessions in last 30 with close below $1. */
  daysSubOne: number;
  /** True when 5-day avg volume < 20% of 60-day avg AND avg < 100k. */
  volumeCollapse: boolean;
  /** Stable content hash of the fired signal IDs. */
  fingerprint: string;
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<RiskSeverity, number> = {
  medium: 1,
  high: 2,
  critical: 3,
};

/** Higher of the two severities, or `null` when both are null. */
export function maxSeverity(
  a: RiskSeverity | null,
  b: RiskSeverity | null,
): RiskSeverity | null {
  if (a === null) return b;
  if (b === null) return a;
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

/** Sort helper: critical → high → medium. */
export function bySeverityDesc(a: RiskSignal, b: RiskSignal): number {
  return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
}

// ---------------------------------------------------------------------------
// Configuration knobs — surfaced here so the engine's tick can tune
// them via `settings.bot.*` in a future change without editing the
// analyser body.
// ---------------------------------------------------------------------------

export const RISK_THRESHOLDS = {
  /** How many calendar days can pass before the latest bar is "stale". */
  staleBarsDays: 7,
  /** 90-day drawdown that trips `price.collapse90d`. */
  collapse90dDrawdown: -0.8,
  /** Price ceiling that must ALSO be satisfied for `price.collapse90d`. */
  collapse90dPriceCeiling: 2,
  /** 90-day drawdown for `price.drawdown60d`. */
  drawdown60d: -0.6,
  /** 90-day drawdown for `price.drawdown40d`. */
  drawdown40d: -0.4,
  /** Sub-$1 threshold — matches the NYSE / NASDAQ minimum-price rule. */
  subOnePrice: 1,
  /** Sessions out of last 30 below `subOnePrice` for the "extended" flag. */
  subOneExtendedSessions: 20,
  /** How many days of news to scan for keyword-based signals. */
  newsLookbackDays: 30,
} as const;

// ---------------------------------------------------------------------------
// News keyword catalog
//
// Word boundaries (`\b`) are important — without them "recovery"
// matches "receiver" and "insolvent" partial-matches all sorts of
// unrelated corporate jargon. The `_test` field is exported for use
// by the analyser via `matchAny()`.
// ---------------------------------------------------------------------------

export interface NewsRule {
  id: Extract<
    RiskSignalId,
    | "news.bankruptcy"
    | "news.delisting"
    | "news.goingConcern"
    | "news.sec"
    | "news.tradingHalt"
  >;
  severity: RiskSeverity;
  labelKey: string;
  detailKey: string;
  patterns: RegExp[];
}

/**
 * Order matters — we walk this list top-to-bottom and stop at the
 * first match per news item, so `bankruptcy` beats a general
 * `delisting` mention when a filing mentions both.
 */
export const NEWS_RULES: NewsRule[] = [
  {
    id: "news.bankruptcy",
    severity: "critical",
    labelKey: "portfolioRisk.signal.news.bankruptcy.label",
    detailKey: "portfolioRisk.signal.news.bankruptcy.detail",
    patterns: [
      // Chapter 7 (liquidation) and Chapter 11 (reorganisation) are
      // the two 8-K disclosures worth pinging on immediately.
      /\bchapter\s*(7|11)\b/i,
      /\bbankruptc(y|ies)\b/i,
      /\bliquidation\b/i,
      /\breceivership\b/i,
      /\binsolvenc(y|ies)\b/i,
      /\bwind[-\s]*down\b/i,
    ],
  },
  {
    id: "news.delisting",
    severity: "critical",
    labelKey: "portfolioRisk.signal.news.delisting.label",
    detailKey: "portfolioRisk.signal.news.delisting.detail",
    patterns: [
      // `\bdelist\w*\b` covers delist/delisted/delisting.
      /\bdelist\w*\b/i,
      /removed\s+from\s+(the\s+)?(nasdaq|nyse|exchange)/i,
      /notice\s+of\s+non[-\s]?compliance/i,
    ],
  },
  {
    id: "news.tradingHalt",
    severity: "high",
    labelKey: "portfolioRisk.signal.news.tradingHalt.label",
    detailKey: "portfolioRisk.signal.news.tradingHalt.detail",
    patterns: [
      /trading\s+halt\w*/i,
      /\bhalt(s|ed)?\s+in\s+trading\b/i,
    ],
  },
  {
    id: "news.goingConcern",
    severity: "high",
    labelKey: "portfolioRisk.signal.news.goingConcern.label",
    detailKey: "portfolioRisk.signal.news.goingConcern.detail",
    patterns: [
      /going\s+concern/i,
      /material\s+weakness/i,
      /\brestatement\b/i,
      /auditor\s+(withdrew|resign\w*)/i,
    ],
  },
  {
    id: "news.sec",
    severity: "high",
    labelKey: "portfolioRisk.signal.news.sec.label",
    detailKey: "portfolioRisk.signal.news.sec.detail",
    patterns: [
      /\bsec\s+(investigat\w+|subpoena\w*|charges|enforcement|probe)/i,
      /securities\s+fraud/i,
    ],
  },
];

// ---------------------------------------------------------------------------
// UI helpers — used by the tab component to colour severity chips.
// Kept here so the palette stays consistent with the catalog.
// ---------------------------------------------------------------------------

export const SEVERITY_UI: Record<
  RiskSeverity,
  { chip: string; bg: string; ring: string; text: string; emoji: string }
> = {
  critical: {
    chip: "bg-danger/15 text-danger border-danger/40",
    bg: "bg-danger/5",
    ring: "ring-danger/40",
    text: "text-danger",
    emoji: "🚨",
  },
  high: {
    chip: "bg-warning/15 text-warning border-warning/40",
    bg: "bg-warning/5",
    ring: "ring-warning/40",
    text: "text-warning",
    emoji: "⚠️",
  },
  medium: {
    chip: "bg-amber-500/15 text-amber-500 border-amber-500/40",
    bg: "bg-amber-500/5",
    ring: "ring-amber-500/40",
    text: "text-amber-500",
    emoji: "🟡",
  },
};
