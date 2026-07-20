"use client";

/**
 * "Risks" tab for /my-portfolio — surfaces delisting / bankruptcy /
 * price-collapse warnings for every stock currently held.
 *
 * Design goals (from the user's request):
 *
 *   * Blank / quiet when everything is fine — no scary red panels
 *     just because a stock is down 3%. We only render the risk list
 *     when at least one holding trips a HIGH or CRITICAL signal
 *     (MEDIUM stays quietly available in a collapsed "watchlist"
 *     footer so users can inspect without being pushed).
 *   * When there IS a risk, show it prominently: the ticker, the
 *     current price, the exact signals that fired, and a deep-link
 *     to the news article when the signal came from a headline.
 *   * Give the user a one-click switch to enable background push
 *     notifications for these same symbols. When on, the client
 *     sync-pushes its symbol list to the server; the worker walks it
 *     every tick and fires a push whenever a fresh critical/high
 *     signal appears.
 */

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  BellOff,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Info as InfoIcon,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination, usePagination } from "@/components/ui/pagination";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";
import { useUi } from "@/lib/state";
import { useHoldings } from "@/lib/holdings-state";
import {
  aggregatePositions,
  uniqueOpenSymbols,
} from "@/lib/portfolio-aggregate";
import {
  usePortfolioRiskAnalysis,
  useRiskNotifications,
} from "@/hooks/use-portfolio-risks";
import {
  SEVERITY_UI,
  type RiskAssessment,
  type RiskSeverity,
  type RiskSignal,
} from "@/lib/portfolio-risk/signals";
import type { MinRiskSeverity } from "@/lib/portfolio-risk/store";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Convenience selectors
// ---------------------------------------------------------------------------

function useOpenSymbols(): string[] {
  const rows = useHoldings((s) => s.rows);
  return React.useMemo(() => uniqueOpenSymbols(aggregatePositions(rows)), [rows]);
}

/**
 * Public helper — used by /my-portfolio/page.tsx to render a live
 * badge on the tab label WITHOUT mounting the whole tab body.
 *
 * We piggyback on the same auto-refreshing analysis hook so the badge
 * and the tab always agree. Rendering this hook twice (once in the
 * tab bar, once in the tab body) is safe: the hook's SWR-ish cache
 * means both instances hit the same in-flight request rather than
 * doubling Yahoo load.
 */
export function usePortfolioRiskBadge(): {
  critical: number;
  high: number;
  loading: boolean;
} {
  const symbols = useOpenSymbols();
  const { assessments, loading, dismissed } = usePortfolioRiskAnalysis(symbols);
  return React.useMemo(() => {
    let critical = 0;
    let high = 0;
    for (const a of assessments) {
      // Skip tickers the user dismissed for this exact signal set —
      // otherwise the badge would keep claiming "1 critical" for a
      // false-positive the user already told us was noise.
      if (dismissed[a.ticker] === a.fingerprint) continue;
      if (a.overallSeverity === "critical") critical += 1;
      else if (a.overallSeverity === "high") high += 1;
    }
    return { critical, high, loading };
  }, [assessments, loading, dismissed]);
}

// ---------------------------------------------------------------------------
// Tab body
// ---------------------------------------------------------------------------

export function PortfolioRisksTab() {
  const t = useT();
  const symbols = useOpenSymbols();
  const {
    assessments,
    loading,
    error,
    errors,
    skipped,
    lastFetchedAt,
    refresh,
    dismissed,
    dismiss,
    undismiss,
  } = usePortfolioRiskAnalysis(symbols);

  // Sort worst-first so a critical delisting always leads.
  const sorted = React.useMemo(() => {
    const rank: Record<RiskSeverity | "clean", number> = {
      critical: 3,
      high: 2,
      medium: 1,
      clean: 0,
    };
    return [...assessments].sort((a, b) => {
      const sa = a.overallSeverity ?? "clean";
      const sb = b.overallSeverity ?? "clean";
      const d = rank[sb] - rank[sa];
      if (d !== 0) return d;
      return a.ticker.localeCompare(b.ticker);
    });
  }, [assessments]);

  // Split assessments into: dismissed (user marked as false positive
  // for THIS signal set), risky (critical/high, not dismissed),
  // monitored (medium, not dismissed). A dismissal only applies when
  // the fingerprint still matches — if new signals fire, the ticker
  // returns to the "risky" bucket automatically.
  const isDismissed = React.useCallback(
    (a: RiskAssessment) =>
      dismissed[a.ticker] !== undefined &&
      dismissed[a.ticker] === a.fingerprint,
    [dismissed],
  );
  const dismissedList = sorted.filter(isDismissed);
  const risky = sorted.filter(
    (a) =>
      !isDismissed(a) &&
      (a.overallSeverity === "critical" || a.overallSeverity === "high"),
  );
  const monitored = sorted.filter(
    (a) => !isDismissed(a) && a.overallSeverity === "medium",
  );
  // How many holdings this analyser can actually reason about — the
  // total minus forex/skipped. Drives the "All clear (checked N)"
  // copy and the "Checked N" footer so the numbers agree with what
  // the user sees rendered.
  //
  // `skipped` is always uppercase (see the hook's sanitiser); raw
  // CSV symbols may be mixed-case, so both sides are uppercased for
  // the membership check.
  const analysableSymbols = React.useMemo(() => {
    const skippedSet = new Set(skipped.map((s) => s.toUpperCase()));
    return symbols.filter((s) => !skippedSet.has(s.toUpperCase()));
  }, [symbols, skipped]);
  const analysableCount = analysableSymbols.length;

  // No holdings at all — the parent already handles this, but guard
  // defensively so a stale state doesn't render an empty table.
  if (symbols.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {t("portfolioRisk.empty.noHoldings")}
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Top strip: notification switch + refresh + status.
          Pass the analysable subset (excluding forex/skipped) so
          the "Monitoring N symbols" count and the actual server-side
          sync agree. */}
      <RiskNotificationSwitch
        symbols={analysableSymbols}
        riskyCount={risky.length}
      />

      {/* Loading / error banners. */}
      {loading && assessments.length === 0 && (
        <div className="rounded-lg border border-border bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground">
          <Loader2 className="inline-block h-4 w-4 animate-spin mr-2" />
          {t("portfolioRisk.loading", { n: symbols.length })}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-xs text-danger">
          {t("portfolioRisk.error")}: {error}
        </div>
      )}

      {/* Main content — the blank-state IS the design when everything
          is fine. We only render the "all clear" card so the user
          knows the analyser did run and picked up their holdings;
          otherwise the tab body would feel empty in a confusing way
          (was it broken? is it loading?). Suppressed when EVERY
          holding was skipped (e.g. a pure-forex portfolio) so we
          don't lie about having "checked 0 holdings". */}
      {!loading &&
        risky.length === 0 &&
        monitored.length === 0 &&
        !error &&
        analysableCount > 0 && (
          <AllClearCard
            symbolCount={analysableCount}
            lastFetchedAt={lastFetchedAt}
            onRefresh={refresh}
          />
        )}

      {risky.length > 0 && (
        <div className="space-y-3">
          <SectionHeader
            label={t("portfolioRisk.section.needAction")}
            hint={t("portfolioRisk.section.needAction.hint")}
            severity="critical"
            count={risky.length}
          />
          {risky.map((a) => (
            <RiskCard key={a.ticker} assessment={a} onDismiss={dismiss} />
          ))}
        </div>
      )}

      {monitored.length > 0 && (
        <MonitorSection assessments={monitored} onDismiss={dismiss} />
      )}

      {dismissedList.length > 0 && (
        <DismissedSection
          assessments={dismissedList}
          onUndismiss={undismiss}
        />
      )}

      {/* Forex-skipped info line — non-alarming, just informational.
          Kept above the diagnostics footer so it's easy to spot when
          a user with mixed-asset portfolio wonders where their FX
          pairs went. Rendered as a subtle chip rather than an error
          so it doesn't look like something's broken. */}
      {skipped.length > 0 && (
        <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-[0.7rem] text-muted-foreground flex flex-wrap items-start gap-x-2 gap-y-1">
          <InfoIcon className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
          <span className="flex-1">
            {t("portfolioRisk.footer.skippedForex", { n: skipped.length })}
            <span className="ml-1 font-mono opacity-80">
              {skipped.join(", ")}
            </span>
          </span>
        </div>
      )}

      {/* Diagnostics footer. */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[0.7rem] text-muted-foreground">
        <span>
          {t("portfolioRisk.footer.checked", { n: symbols.length - skipped.length })}
          {skipped.length > 0 && (
            <>
              {" · "}
              {t("portfolioRisk.footer.skippedShort", { n: skipped.length })}
            </>
          )}
          {lastFetchedAt && (
            <>
              {" · "}
              {t("portfolioRisk.footer.updated", {
                time: new Date(lastFetchedAt).toLocaleTimeString(),
              })}
            </>
          )}
        </span>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 hover:border-primary/40 hover:text-primary disabled:opacity-60"
        >
          <RefreshCw
            className={cn("h-3 w-3", loading && "animate-spin")}
          />
          {t("common.refresh")}
        </button>
      </div>

      {/* Per-ticker fetch errors are non-fatal — surface them at the
          bottom so users know if a ticker failed to analyse. */}
      {errors.length > 0 && (
        <details className="text-[0.7rem] text-muted-foreground">
          <summary className="cursor-pointer">
            {t("portfolioRisk.footer.fetchErrors", { n: errors.length })}
          </summary>
          <ul className="mt-1 space-y-0.5 pl-4 list-disc">
            {errors.map((e) => (
              <li key={e.ticker}>
                <span className="font-mono">{e.ticker}</span>: {e.error}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notification switch
// ---------------------------------------------------------------------------

/**
 * One-click switch that keeps the server-side notification watch list
 * in sync with the user's open positions. When ON, an effect pushes
 * the symbol set whenever it changes; when OFF, the effect clears it.
 *
 * Kept as a separate component so it can re-render independently of
 * the risk cards below — a stale watch sync shouldn't block the UI.
 */
function RiskNotificationSwitch({
  symbols,
  riskyCount,
}: {
  symbols: string[];
  riskyCount: number;
}) {
  const t = useT();
  const {
    enabled,
    minSeverity,
    setEnabled,
    setMinSeverity,
    syncTickers,
    lastSyncedAt,
    lastReport,
    syncing,
    syncError,
  } = useRiskNotifications();

  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState<string | null>(null);
  const symbolsKey = React.useMemo(() => symbols.slice().sort().join(","), [symbols]);

  // When notifications are enabled, keep the server watchlist in sync
  // with the current open-symbols set. Debounced through `symbolsKey`
  // so the effect only fires when the identity of the set changes.
  //
  // We explicitly handle the "empty holdings" case (`symbolsKey ===
  // ""`) by pushing an empty list — otherwise the server would keep
  // the stale list from before the user cleared their portfolio and
  // continue paging on those symbols.
  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const list = symbolsKey === "" ? [] : symbolsKey.split(",");
        await syncTickers(list);
        if (!cancelled && list.length > 0) {
          setSaved(t("portfolioRisk.notify.synced"));
          setTimeout(() => !cancelled && setSaved(null), 2000);
        }
      } catch {
        /* surfaced via `syncError` */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately depending on `symbolsKey`, not `symbols`, so the
    // effect uses stable string identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, symbolsKey, minSeverity, syncTickers]);

  const onToggle = async () => {
    setBusy(true);
    try {
      await setEnabled(!enabled);
      if (!enabled) {
        await syncTickers(symbols);
        setSaved(t("portfolioRisk.notify.enabled"));
      } else {
        setSaved(t("portfolioRisk.notify.disabled"));
      }
      setTimeout(() => setSaved(null), 2500);
    } catch {
      /* surfaced via `syncError` */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-3 flex flex-col gap-2",
        enabled
          ? "border-primary/40 bg-primary/5"
          : "border-border bg-card/40",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
            enabled
              ? "bg-primary/15 text-primary"
              : "bg-muted/40 text-muted-foreground",
          )}
        >
          {enabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {t("portfolioRisk.notify.title")}
          </p>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? t("portfolioRisk.notify.enabledBody", { n: symbols.length })
              : t("portfolioRisk.notify.disabledBody")}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={busy || symbols.length === 0}
          onClick={onToggle}
          className={cn(
            "shrink-0 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
            enabled
              ? "border-primary/40 bg-primary text-primary-foreground hover:bg-primary/90"
              : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary",
            "disabled:opacity-60 disabled:cursor-not-allowed",
          )}
        >
          {busy || syncing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : enabled ? (
            <Check className="h-3 w-3" />
          ) : (
            <Bell className="h-3 w-3" />
          )}
          {enabled ? t("portfolioRisk.notify.on") : t("portfolioRisk.notify.off")}
        </button>
      </div>

      {/* Sensitivity picker — only relevant when notifications are on. */}
      {enabled && (
        <div className="flex flex-wrap items-center gap-2 pl-11">
          <span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
            {t("portfolioRisk.notify.severity")}
          </span>
          {(["high", "critical"] as MinRiskSeverity[]).map((s) => {
            const active = minSeverity === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setMinSeverity(s)}
                aria-pressed={active}
                className={cn(
                  "text-[0.65rem] px-2 py-0.5 rounded-md border transition-colors",
                  active
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground",
                )}
              >
                {t(`portfolioRisk.notify.severity.${s}`)}
              </button>
            );
          })}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                aria-label={t("portfolioRisk.notify.severityHelp")}
              >
                <InfoIcon className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-[0.7rem]">
              {t("portfolioRisk.notify.severityHelp")}
            </TooltipContent>
          </Tooltip>
        </div>
      )}

      {/* Sync status. */}
      {enabled && (lastSyncedAt || saved || syncError) && (
        <div className="pl-11 text-[0.65rem] text-muted-foreground flex items-center gap-2">
          {saved && (
            <span className="inline-flex items-center gap-1 text-primary">
              <Check className="h-3 w-3" />
              {saved}
            </span>
          )}
          {lastReport && (
            <span>
              {t("portfolioRisk.notify.report", {
                added: lastReport.added,
                removed: lastReport.removed,
                total: lastReport.total,
              })}
            </span>
          )}
          {lastSyncedAt && (
            <span>
              {t("portfolioRisk.notify.lastSync", {
                time: new Date(lastSyncedAt).toLocaleTimeString(),
              })}
            </span>
          )}
          {syncError && (
            <span className="text-danger">
              {t("portfolioRisk.notify.syncError")}: {syncError}
            </span>
          )}
        </div>
      )}

      {enabled && riskyCount > 0 && (
        <div className="pl-11 flex items-center gap-1.5 text-[0.7rem] text-warning">
          <AlertTriangle className="h-3 w-3" />
          {t("portfolioRisk.notify.currentlyRisky", { n: riskyCount })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({
  label,
  hint,
  severity,
  count,
}: {
  label: string;
  hint: string;
  severity: RiskSeverity;
  count: number;
}) {
  const s = SEVERITY_UI[severity];
  return (
    <div className="flex items-start gap-2">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[0.7rem] font-semibold",
          s.chip,
        )}
      >
        {s.emoji}
        {label}
        <span className="ml-1 rounded-full bg-current/10 px-1.5 text-[0.65rem]">
          {count}
        </span>
      </span>
      <p className="text-[0.7rem] text-muted-foreground mt-1 flex-1">
        {hint}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Risk card — one per at-risk holding
// ---------------------------------------------------------------------------

function RiskCard({
  assessment,
  onDismiss,
}: {
  assessment: RiskAssessment;
  onDismiss?: (ticker: string, fingerprint: string) => Promise<void>;
}) {
  const t = useT();
  const setTicker = useUi((s) => s.setTicker);
  const s = SEVERITY_UI[assessment.overallSeverity ?? "medium"];
  const [expanded, setExpanded] = React.useState(true);
  const [dismissing, setDismissing] = React.useState(false);
  const [dismissError, setDismissError] = React.useState<string | null>(null);

  const closeStr =
    assessment.latestClose === null
      ? "—"
      : `$${assessment.latestClose.toFixed(assessment.latestClose < 1 ? 3 : 2)}`;
  const drawdownStr =
    assessment.drawdown90d === null
      ? "—"
      : `${Math.round(assessment.drawdown90d * 100)}%`;

  const handleDismiss = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onDismiss || dismissing) return;
    setDismissing(true);
    setDismissError(null);
    try {
      await onDismiss(assessment.ticker, assessment.fingerprint);
    } catch (err) {
      setDismissError(err instanceof Error ? err.message : String(err));
    } finally {
      setDismissing(false);
    }
  };

  return (
    <Card
      className={cn(
        "ring-1 overflow-hidden",
        s.ring,
        assessment.overallSeverity === "critical" && s.bg,
      )}
    >
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
        >
          <span className={cn("mt-0.5 text-lg", s.text)}>{s.emoji}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-mono font-semibold text-base">
                {assessment.ticker}
              </span>
              <span
                className={cn(
                  "text-[0.65rem] font-semibold uppercase tracking-wide rounded-md border px-1.5 py-0.5",
                  s.chip,
                )}
              >
                {t(`portfolioRisk.severity.${assessment.overallSeverity}`)}
              </span>
              <span className="text-[0.7rem] text-muted-foreground">
                {t("portfolioRisk.card.signalCount", {
                  n: assessment.signals.length,
                })}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("portfolioRisk.card.snapshot", {
                close: closeStr,
                dd: drawdownStr,
              })}
            </p>
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
        </button>

        {expanded && (
          <div className="border-t border-border/60 px-4 py-3 space-y-3 animate-fade-in">
            {/* Signal list */}
            <ul className="space-y-2">
              {assessment.signals.map((sig) => (
                <SignalRow key={sig.id} signal={sig} />
              ))}
            </ul>

            {/* Quick actions */}
            <div className="flex flex-wrap gap-2 pt-1">
              <Link
                href="/signal"
                onClick={() => setTicker(assessment.ticker)}
                className="text-[0.7rem] inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 hover:border-primary/40 hover:text-primary transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                {t("portfolioRisk.card.openSignal")}
              </Link>
              <Link
                href="/news"
                onClick={() => setTicker(assessment.ticker)}
                className="text-[0.7rem] inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 hover:border-primary/40 hover:text-primary transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                {t("portfolioRisk.card.openNews")}
              </Link>
              <Link
                href="/charts"
                onClick={() => setTicker(assessment.ticker)}
                className="text-[0.7rem] inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 hover:border-primary/40 hover:text-primary transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                {t("portfolioRisk.card.openChart")}
              </Link>
              {onDismiss && (
                <>
                  <span className="ml-auto" />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={handleDismiss}
                        disabled={dismissing}
                        className="text-[0.7rem] inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-muted-foreground hover:border-danger/40 hover:text-danger transition-colors disabled:opacity-60"
                      >
                        {dismissing ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <X className="h-3 w-3" />
                        )}
                        {t("portfolioRisk.card.dismiss")}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-[0.7rem]">
                      {t("portfolioRisk.card.dismissHelp")}
                    </TooltipContent>
                  </Tooltip>
                </>
              )}
            </div>
            {dismissError && (
              <p className="text-[0.7rem] text-danger">
                {t("portfolioRisk.card.dismissError")}: {dismissError}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SignalRow({ signal }: { signal: RiskSignal }) {
  const t = useT();
  const s = SEVERITY_UI[signal.severity];
  return (
    <li className="flex items-start gap-2 text-xs">
      <span className={cn("shrink-0 pt-0.5", s.text)}>{s.emoji}</span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t(signal.labelKey)}</p>
        <p className="text-muted-foreground text-[0.7rem] leading-relaxed">
          {t(signal.detailKey, signal.params)}
        </p>
        {signal.sourceUrl && (
          <a
            href={signal.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 text-[0.65rem] text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            {signal.sourcePublishedAt
              ? new Date(signal.sourcePublishedAt).toLocaleDateString()
              : t("portfolioRisk.signal.source")}
          </a>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Monitor (medium-severity) section — collapsed by default
// ---------------------------------------------------------------------------

function MonitorSection({
  assessments,
  onDismiss,
}: {
  assessments: RiskAssessment[];
  onDismiss: (ticker: string, fingerprint: string) => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  // Cap the visible cards at 10 so a portfolio with 200 medium-risk
  // holdings doesn't render a 5000-pixel-tall collapsed panel. Anyone
  // who wants to scan the whole set can still page through — most
  // users just want the top of the pile.
  const pager = usePagination(assessments, 10);
  return (
    <details
      className="rounded-lg border border-border/60 bg-card/40 open:bg-card/60"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer list-none px-4 py-2.5 flex items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[0.65rem] font-semibold text-amber-500">
          🟡 {t("portfolioRisk.section.monitor")}
        </span>
        <span className="text-muted-foreground">
          {t("portfolioRisk.section.monitor.hint", { n: assessments.length })}
        </span>
        <span className="ml-auto text-muted-foreground">
          {open ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </span>
      </summary>
      <div className="px-4 pb-3 space-y-2">
        {pager.visibleItems.map((a) => (
          <RiskCard key={a.ticker} assessment={a} onDismiss={onDismiss} />
        ))}
        <Pagination
          page={pager.page}
          pageCount={pager.pageCount}
          total={pager.total}
          range={pager.range}
          onPageChange={pager.setPage}
          pageSize={pager.pageSize}
          onPageSizeChange={pager.setPageSize}
          pageSizeOptions={[10, 25, 50, 100]}
          pageSizeLabel={t("pager.pageSizeLabel")}
          allLabel={t("pager.all")}
          label={t("portfolioRisk.pager.label")}
          hideWhenSingle
          className="pt-2"
        />
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Dismissed (false-positive) section — collapsed by default
// ---------------------------------------------------------------------------

/**
 * A ticker only appears here while its current assessment fingerprint
 * still matches the dismissed one. If new signals fire (fingerprint
 * changes), the ticker automatically returns to the "Need action"
 * list — the dismissal is deliberately not "hide this ticker
 * forever", only "silence this exact signal set".
 */
function DismissedSection({
  assessments,
  onUndismiss,
}: {
  assessments: RiskAssessment[];
  onUndismiss: (ticker: string) => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  return (
    <details
      className="rounded-lg border border-border/60 bg-card/30 open:bg-card/50"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer list-none px-4 py-2.5 flex items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[0.65rem] font-semibold text-muted-foreground">
          {t("portfolioRisk.section.dismissed")}
        </span>
        <span className="text-muted-foreground">
          {t("portfolioRisk.section.dismissed.hint", {
            n: assessments.length,
          })}
        </span>
        <span className="ml-auto text-muted-foreground">
          {open ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </span>
      </summary>
      <div className="px-4 pb-3 space-y-2">
        {assessments.map((a) => (
          <DismissedCard
            key={a.ticker}
            assessment={a}
            onUndismiss={onUndismiss}
          />
        ))}
      </div>
    </details>
  );
}

function DismissedCard({
  assessment,
  onUndismiss,
}: {
  assessment: RiskAssessment;
  onUndismiss: (ticker: string) => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const s = SEVERITY_UI[assessment.overallSeverity ?? "medium"];

  const handleUndismiss = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onUndismiss(assessment.ticker);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-border/60 bg-muted/10 px-3 py-2 flex flex-wrap items-center gap-2 text-xs">
      <span className={cn("shrink-0", s.text)}>{s.emoji}</span>
      <span className="font-mono font-semibold">{assessment.ticker}</span>
      <span
        className={cn(
          "text-[0.6rem] font-semibold uppercase tracking-wide rounded-md border px-1 py-0.5",
          s.chip,
        )}
      >
        {t(`portfolioRisk.severity.${assessment.overallSeverity ?? "medium"}`)}
      </span>
      <span className="text-[0.7rem] text-muted-foreground truncate min-w-0 flex-1">
        {assessment.signals[0]
          ? t(assessment.signals[0].labelKey)
          : t("portfolioRisk.section.dismissed.stateOnly")}
        {assessment.signals.length > 1 &&
          ` · +${assessment.signals.length - 1}`}
      </span>
      <button
        type="button"
        onClick={handleUndismiss}
        disabled={busy}
        className="shrink-0 text-[0.7rem] inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <RotateCcw className="h-3 w-3" />
        )}
        {t("portfolioRisk.card.undismiss")}
      </button>
      {err && (
        <span className="basis-full text-[0.65rem] text-danger">{err}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// All-clear panel
// ---------------------------------------------------------------------------

function AllClearCard({
  symbolCount,
  lastFetchedAt,
  onRefresh,
}: {
  symbolCount: number;
  lastFetchedAt: string | null;
  onRefresh: () => void;
}) {
  const t = useT();
  return (
    <Card className="ring-1 ring-success/40 bg-success/5">
      <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-success/15 text-success shrink-0">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-success">
            {t("portfolioRisk.allClear.title")}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("portfolioRisk.allClear.body", { n: symbolCount })}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[0.7rem] hover:border-primary/40 hover:text-primary transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          {t("common.refresh")}
        </button>
      </CardContent>
    </Card>
  );
}
