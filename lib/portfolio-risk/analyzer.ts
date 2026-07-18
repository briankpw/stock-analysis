/**
 * Delisting / bankruptcy risk analyzer.
 *
 * Pure function of (bars, news, quote) → `RiskAssessment`. All I/O
 * (Yahoo fetches, DB writes, notifier fan-out) lives in the engine
 * layer so this file stays trivially unit-testable and cannot leak
 * side effects into the request path.
 *
 * The rule set is documented in `signals.ts`. This module's job is to
 * take upstream data at face value and fire the appropriate `RiskSignal`s.
 *
 * Design choices worth noting:
 *
 *   * `null`-tolerant everywhere. Yahoo hands us stale / missing fields
 *     for illiquid tickers and delisted names — the exact population
 *     we want to catch — so nothing in here throws when data is
 *     partial. Missing data itself is a signal (`data.noBars`,
 *     `bars.stale`).
 *   * News rules match at the first `NEWS_RULES` entry that hits per
 *     article. That means a "Chapter 11 filing delists company XYZ"
 *     headline fires only `news.bankruptcy` (the more severe one)
 *     rather than double-counting into two overlapping signals.
 *   * Recency filtering: news items older than `newsLookbackDays`
 *     are ignored so old bankruptcy coverage of a survived
 *     restructuring doesn't keep tripping the alert.
 */

import type { Bar } from "@/lib/indicators";
import type { NewsItem, Quote } from "@/lib/data";
import {
  NEWS_RULES,
  RISK_THRESHOLDS,
  bySeverityDesc,
  maxSeverity,
  type NewsRule,
  type RiskAssessment,
  type RiskSeverity,
  type RiskSignal,
  type RiskSignalId,
} from "./signals";

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface AnalyzeInput {
  ticker: string;
  bars: Bar[];
  news: NewsItem[];
  quote: Quote | null;
  now?: Date;
}

export function analyzeRisk(input: AnalyzeInput): RiskAssessment {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();

  const bars = input.bars;
  const closes = bars.map((b) => b.close);
  const latestClose = closes.length > 0 ? closes[closes.length - 1]! : null;

  // Latest bar age: bars are sorted ascending by time (see `data.ts`),
  // so the last entry's `time` is the newest. We treat it as
  // Unix-seconds (the shape emitted by `fetchHistory`).
  const latestBar = bars.length > 0 ? bars[bars.length - 1]! : null;
  const latestBarDate = latestBar
    ? new Date(latestBar.time * 1000).toISOString().slice(0, 10)
    : null;
  const latestBarAgeDays = latestBar
    ? (nowMs - latestBar.time * 1000) / (1000 * 60 * 60 * 24)
    : null;

  const drawdown90d = computeDrawdown(closes, 90);
  const daysSubOne = closes
    .slice(-30)
    .filter((c) => c < RISK_THRESHOLDS.subOnePrice).length;
  const volumeCollapse = detectVolumeCollapse(bars);

  const signals: RiskSignal[] = [];

  // ---- Data / bar-health signals -----------------------------------------

  if (bars.length === 0) {
    signals.push({
      id: "data.noBars",
      severity: "critical",
      labelKey: "portfolioRisk.signal.data.noBars.label",
      detailKey: "portfolioRisk.signal.data.noBars.detail",
    });
  } else if (
    latestBarAgeDays !== null &&
    latestBarAgeDays > RISK_THRESHOLDS.staleBarsDays
  ) {
    signals.push({
      id: "bars.stale",
      severity: "critical",
      labelKey: "portfolioRisk.signal.bars.stale.label",
      detailKey: "portfolioRisk.signal.bars.stale.detail",
      params: {
        days: Math.round(latestBarAgeDays),
        date: latestBarDate ?? "?",
      },
    });
  }

  // ---- Price collapse signals --------------------------------------------
  // Order matters — we only want the MOST severe drawdown bucket to
  // fire, so bail out after the first hit.

  if (
    latestClose !== null &&
    drawdown90d !== null &&
    drawdown90d <= RISK_THRESHOLDS.collapse90dDrawdown &&
    latestClose <= RISK_THRESHOLDS.collapse90dPriceCeiling
  ) {
    signals.push({
      id: "price.collapse90d",
      severity: "critical",
      labelKey: "portfolioRisk.signal.price.collapse90d.label",
      detailKey: "portfolioRisk.signal.price.collapse90d.detail",
      params: {
        pct: Math.round(drawdown90d * 100),
        price: formatPrice(latestClose),
      },
    });
  } else if (
    drawdown90d !== null &&
    drawdown90d <= RISK_THRESHOLDS.drawdown60d
  ) {
    signals.push({
      id: "price.drawdown60d",
      severity: "high",
      labelKey: "portfolioRisk.signal.price.drawdown60d.label",
      detailKey: "portfolioRisk.signal.price.drawdown60d.detail",
      params: { pct: Math.round(drawdown90d * 100) },
    });
  } else if (
    drawdown90d !== null &&
    drawdown90d <= RISK_THRESHOLDS.drawdown40d
  ) {
    signals.push({
      id: "price.drawdown40d",
      severity: "medium",
      labelKey: "portfolioRisk.signal.price.drawdown40d.label",
      detailKey: "portfolioRisk.signal.price.drawdown40d.detail",
      params: { pct: Math.round(drawdown90d * 100) },
    });
  }

  // Sub-$1 buckets: extended vs. one-off. Extended is a HIGH because
  // it's an actual exchange-listing-rule trigger, not just a red day.
  if (daysSubOne >= RISK_THRESHOLDS.subOneExtendedSessions) {
    signals.push({
      id: "price.subOneExtended",
      severity: "high",
      labelKey: "portfolioRisk.signal.price.subOneExtended.label",
      detailKey: "portfolioRisk.signal.price.subOneExtended.detail",
      params: { count: daysSubOne, total: Math.min(30, closes.length) },
    });
  } else if (
    latestClose !== null &&
    latestClose < RISK_THRESHOLDS.subOnePrice
  ) {
    signals.push({
      id: "price.subOne",
      severity: "medium",
      labelKey: "portfolioRisk.signal.price.subOne.label",
      detailKey: "portfolioRisk.signal.price.subOne.detail",
      params: { price: formatPrice(latestClose) },
    });
  }

  // Volume collapse only fires when we actually have enough bars to
  // be confident. Otherwise it looks like a signal but is really an
  // artefact of a short lookback.
  if (volumeCollapse && bars.length >= 60) {
    signals.push({
      id: "volume.collapse",
      severity: "high",
      labelKey: "portfolioRisk.signal.volume.collapse.label",
      detailKey: "portfolioRisk.signal.volume.collapse.detail",
    });
  }

  // ---- News keyword signals ----------------------------------------------
  // Dedup per-rule so a torrent of "Chapter 11" coverage counts as
  // one signal rather than five — but keep the freshest article for
  // the "Read more" deep-link.
  const fired = new Map<RiskSignalId, RiskSignal>();
  const cutoffMs = nowMs - RISK_THRESHOLDS.newsLookbackDays * 24 * 60 * 60 * 1000;
  for (const item of input.news) {
    const ts = Date.parse(item.publishedAt);
    if (Number.isFinite(ts) && ts < cutoffMs) continue;
    const rule = firstMatchingRule(item, NEWS_RULES);
    if (!rule) continue;
    const existing = fired.get(rule.id);
    // Prefer the freshest source per rule.
    if (existing && !isFresher(item, existing)) continue;
    fired.set(rule.id, {
      id: rule.id,
      severity: rule.severity,
      labelKey: rule.labelKey,
      detailKey: rule.detailKey,
      params: { title: truncate(item.title, 140) },
      sourceUrl: item.link || undefined,
      sourceTitle: item.title,
      sourcePublishedAt: item.publishedAt,
    });
  }
  for (const s of fired.values()) signals.push(s);

  // ---- Aggregate ---------------------------------------------------------
  signals.sort(bySeverityDesc);
  let overallSeverity: RiskSeverity | null = null;
  for (const s of signals) overallSeverity = maxSeverity(overallSeverity, s.severity);

  // Suppress unused-variable warnings from the passed-in quote — we
  // don't currently read it, but it's part of the input contract so
  // callers don't have to change their fetch orchestration when we
  // add quote-driven signals later.
  void input.quote;

  return {
    ticker: input.ticker.toUpperCase(),
    fetchedAt: now.toISOString(),
    overallSeverity,
    signals,
    latestClose,
    latestBarDate,
    drawdown90d,
    daysSubOne,
    volumeCollapse,
    fingerprint: fingerprintSignals(signals),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Peak-to-current drawdown over the trailing `days` closes, as a
 * signed fraction (e.g. -0.65 = down 65%). Returns `null` when we
 * don't have enough bars to compute a meaningful peak (< 10 bars) or
 * when the peak is zero/negative.
 */
function computeDrawdown(closes: number[], days: number): number | null {
  if (closes.length < 10) return null;
  const slice = closes.slice(-days);
  const peak = Math.max(...slice);
  const latest = slice[slice.length - 1]!;
  if (!(peak > 0)) return null;
  return latest / peak - 1;
}

/**
 * Volume collapse detector: 5-day avg < 20% of 60-day avg AND the
 * short-window avg is under 100k shares. The second gate keeps us
 * from firing on already-illiquid names where a 5:1 ratio is normal
 * noise.
 */
function detectVolumeCollapse(bars: Bar[]): boolean {
  if (bars.length < 60) return false;
  const last5 = bars.slice(-5);
  const last60 = bars.slice(-60);
  const avg = (xs: Bar[]) =>
    xs.reduce((a, b) => a + (b.volume ?? 0), 0) / Math.max(1, xs.length);
  const avg5 = avg(last5);
  const avg60 = avg(last60);
  if (!(avg60 > 0)) return false;
  return avg5 < 0.2 * avg60 && avg5 < 100_000;
}

function firstMatchingRule(item: NewsItem, rules: NewsRule[]): NewsRule | null {
  const hay = `${item.title}\n${item.summary}`;
  for (const rule of rules) {
    for (const p of rule.patterns) if (p.test(hay)) return rule;
  }
  return null;
}

function isFresher(candidate: NewsItem, existing: RiskSignal): boolean {
  if (!existing.sourcePublishedAt) return true;
  const a = Date.parse(candidate.publishedAt);
  const b = Date.parse(existing.sourcePublishedAt);
  if (!Number.isFinite(a)) return false;
  if (!Number.isFinite(b)) return true;
  return a > b;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, Math.max(0, n - 1)) + "…";
}

function formatPrice(p: number): string {
  return p < 1 ? p.toFixed(3) : p.toFixed(2);
}

/**
 * Stable content hash of the fired signal IDs. Used by the engine's
 * on-change gate — a fingerprint difference between ticks means the
 * user got a new signal (or lost one), and is the trigger for a push
 * notification.
 *
 * Cheap FNV-1a; the number of signals is tiny so we don't need
 * cryptographic strength.
 */
function fingerprintSignals(signals: RiskSignal[]): string {
  if (signals.length === 0) return "clean";
  const ids = signals.map((s) => s.id).sort();
  let h = 0x811c9dc5;
  for (const id of ids) {
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    h ^= 0x2c; // separator
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
