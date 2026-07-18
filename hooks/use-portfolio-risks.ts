"use client";

/**
 * Client hooks for the portfolio delisting / bankruptcy risk feature.
 *
 * Two independent concerns share this module:
 *
 *   1. `usePortfolioRiskAnalysis(tickers)` — on-demand analysis for
 *      the "Risks" tab. Fetches every time the ticker list changes,
 *      then again on an interval (auto-refresh) so open-tab users see
 *      fresh assessments without hitting F5.
 *
 *   2. `useRiskNotifications()` — the persistent "email me if any of
 *      my holdings starts looking like a delisting candidate"
 *      subscription. Persisted in localStorage. When enabled, the
 *      caller (typically the tab component) uses `syncTickers()` to
 *      push the current open-symbol set to the server so the worker
 *      can walk it every tick.
 *
 * The two hooks are decoupled: opening the Risks tab shows the
 * analysis regardless of whether notifications are on, and toggling
 * notifications doesn't affect what's on screen.
 */

import * as React from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RiskAssessment } from "@/lib/portfolio-risk/signals";
import type {
  MinRiskSeverity,
  RiskWatch,
} from "@/lib/portfolio-risk/store";

// ---------------------------------------------------------------------------
// Ticker sanitisation
//
// Portfolio CSVs come from a wide variety of brokerages (MSP, MooMoo,
// Webull, Interactive Brokers, custom exports…) and their ticker
// conventions vary: some emit `BRK-B`, others `BRK B`; some prefix
// exchange codes; some pad with whitespace. We normalise upstream of
// the API call so the strict server-side regex isn't the first thing
// to blow up. Any row we can't rescue gets bubbled back to the tab as
// a fetch error so the user knows something was skipped rather than
// silently ignored.
//
// The regex matches the server-side schema — see
// `/api/portfolio/risks/route.ts` for the full character rationale.
// Anything outside `[A-Za-z0-9.\-^=]` is either an invalid ticker or
// a data-entry artefact.
// ---------------------------------------------------------------------------

const VALID_TICKER_RE = /^[A-Za-z0-9.\-^=]{1,16}$/;

/**
 * Yahoo Finance forex pairs use the `=X` suffix (e.g. `EURUSD=X`,
 * `USDJPY=X`). Currency pairs don't have the concepts this analyser
 * checks — there's no bankruptcy filing, no delisting notice, no
 * $1 minimum-price rule, no going-concern audit — so running them
 * through the risk pipeline is pure waste and would produce
 * meaningless "no bars" false positives for any pair Yahoo doesn't
 * carry.
 *
 * `=F` (futures) has the same property in principle, but leave them
 * alone unless a user reports needing the exclusion — some brokers
 * do report futures P&L via a ticker Yahoo also serves, and the
 * price-collapse signal is still meaningful there.
 */
function isForex(ticker: string): boolean {
  return /=X$/i.test(ticker);
}

interface SanitizedTickers {
  /** Passed the regex AND applicable to the risk framework. */
  valid: string[];
  /** Failed the regex — unusual characters, empty, etc. */
  invalid: string[];
  /** Passed the regex but explicitly skipped (e.g. forex pairs). */
  skipped: string[];
}

function sanitizeTickers(tickers: readonly string[]): SanitizedTickers {
  const valid = new Set<string>();
  const invalid = new Set<string>();
  const skipped = new Set<string>();
  for (const raw of tickers) {
    if (raw === null || raw === undefined) continue;
    // Uppercase, trim outer whitespace, and collapse the common "BRK B"
    // → "BRK-B" pattern some brokerages use. Anything with internal
    // whitespace that ISN'T a class-share separator falls through to
    // the invalid bucket.
    const cleaned = String(raw).trim().toUpperCase().replace(/\s+/g, "-");
    if (!cleaned) continue;
    if (!VALID_TICKER_RE.test(cleaned)) {
      invalid.add(String(raw).trim() || "(empty)");
      continue;
    }
    if (isForex(cleaned)) {
      skipped.add(cleaned);
      continue;
    }
    valid.add(cleaned);
  }
  return {
    valid: [...valid].sort(),
    invalid: [...invalid].sort(),
    skipped: [...skipped].sort(),
  };
}

// ---------------------------------------------------------------------------
// Persisted notification preference
// ---------------------------------------------------------------------------

interface RiskNotificationPrefs {
  enabled: boolean;
  minSeverity: MinRiskSeverity;
  /** ISO timestamp of the last successful sync — surfaces "monitoring N since HH:MM". */
  lastSyncedAt: string | null;
  lastReport: { added: number; removed: number; kept: number; total: number } | null;
}

interface RiskNotificationState extends RiskNotificationPrefs {
  setEnabled: (v: boolean) => void;
  setMinSeverity: (v: MinRiskSeverity) => void;
  recordSync: (report: RiskNotificationPrefs["lastReport"]) => void;
}

const useRiskPrefs = create<RiskNotificationState>()(
  persist(
    (set) => ({
      enabled: false,
      minSeverity: "high",
      lastSyncedAt: null,
      lastReport: null,
      setEnabled: (v) => set({ enabled: v }),
      setMinSeverity: (v) => set({ minSeverity: v }),
      recordSync: (report) =>
        set({
          lastSyncedAt: new Date().toISOString(),
          lastReport: report,
        }),
    }),
    { name: "key-stock-portfolio-risk-prefs", version: 1 },
  ),
);

// ---------------------------------------------------------------------------
// Analysis hook
// ---------------------------------------------------------------------------

export interface UsePortfolioRiskAnalysis {
  assessments: RiskAssessment[];
  loading: boolean;
  error: string | null;
  errors: Array<{ ticker: string; error: string }>;
  /** Tickers we deliberately did not analyse (e.g. forex pairs).
   *  Surface as an info line, not an error, so the user knows we
   *  didn't silently drop them. */
  skipped: string[];
  lastFetchedAt: string | null;
  refresh: () => void;
}

/**
 * Fetches risk assessments for the given tickers.
 *
 * The auto-refresh interval is intentionally slow (5 min). Risk
 * signals move on the timescale of hours (news breaks) or days
 * (price collapses); refreshing every 15s would be pointless load on
 * Yahoo and confuse users into thinking the analyser is flaky when a
 * transient news feed hiccup shows a signal appearing then
 * disappearing.
 */
export function usePortfolioRiskAnalysis(
  tickers: readonly string[],
  { refreshMs = 5 * 60 * 1000 }: { refreshMs?: number } = {},
): UsePortfolioRiskAnalysis {
  const [assessments, setAssessments] = React.useState<RiskAssessment[]>([]);
  const [errors, setErrors] = React.useState<
    Array<{ ticker: string; error: string }>
  >([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [lastFetchedAt, setLastFetchedAt] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);

  // Normalise + memoise the ticker list so identity is stable across
  // re-renders — otherwise the effect refires on every parent tick.
  // The sanitiser also splits out invalid tickers so we can surface
  // them without failing the entire batch.
  const sanitized = React.useMemo(
    () => sanitizeTickers(tickers),
    [tickers],
  );
  const key = sanitized.valid.join(",");
  const invalidKey = sanitized.invalid.join(",");

  React.useEffect(() => {
    let cancelled = false;
    // Pre-populate `errors[]` with any locally-skipped tickers so the
    // "N ticker(s) failed to analyse" footer accounts for them even
    // when the batch itself succeeds. Rebuilt on every fetch so a
    // fixed CSV column no longer looks broken.
    const localErrors: Array<{ ticker: string; error: string }> =
      sanitized.invalid.map((t) => ({
        ticker: t,
        error: "Ticker symbol format not recognised — skipped.",
      }));

    if (!key) {
      setAssessments([]);
      setErrors(localErrors);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch("/api/portfolio/risks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tickers: sanitized.valid }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        const body = (await res.json()) as {
          assessments: RiskAssessment[];
          errors: Array<{ ticker: string; error: string }>;
        };
        if (cancelled) return;
        setAssessments(body.assessments);
        setErrors([...localErrors, ...(body.errors ?? [])]);
        setLastFetchedAt(new Date().toISOString());
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `invalidKey` participates as a dep so a portfolio import that
    // fixes previously-invalid symbols re-runs the effect and clears
    // the stale skip notices.
  }, [key, invalidKey, sanitized.invalid, sanitized.valid, tick]);

  // Auto-refresh: `tick` is incremented every `refreshMs` when the
  // window is visible. Skipping when hidden keeps the analyser off
  // Yahoo when the user has the tab in the background — same
  // behaviour as the positions table's `useLiveQuotes` hook.
  React.useEffect(() => {
    if (!key) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      id = setInterval(() => setTick((n) => n + 1), refreshMs);
    };
    const stop = () => {
      if (id) clearInterval(id);
      id = null;
    };
    const onVis = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [key, refreshMs]);

  const refresh = React.useCallback(() => setTick((n) => n + 1), []);
  return {
    assessments,
    loading,
    error,
    errors,
    skipped: sanitized.skipped,
    lastFetchedAt,
    refresh,
  };
}

// ---------------------------------------------------------------------------
// Notification-subscription hook
// ---------------------------------------------------------------------------

export interface UseRiskNotifications {
  enabled: boolean;
  minSeverity: MinRiskSeverity;
  setEnabled: (v: boolean) => Promise<void>;
  setMinSeverity: (v: MinRiskSeverity) => void;
  /** Push the given ticker list to the server (idempotent). */
  syncTickers: (tickers: readonly string[]) => Promise<void>;
  /** Fetch the currently-monitored watches from the server. */
  fetchWatches: () => Promise<RiskWatch[]>;
  lastSyncedAt: string | null;
  lastReport: RiskNotificationPrefs["lastReport"];
  syncing: boolean;
  syncError: string | null;
}

export function useRiskNotifications(): UseRiskNotifications {
  const prefs = useRiskPrefs();
  const [syncing, setSyncing] = React.useState(false);
  const [syncError, setSyncError] = React.useState<string | null>(null);

  const syncTickers = React.useCallback(
    async (tickers: readonly string[]) => {
      setSyncing(true);
      setSyncError(null);
      try {
        // Same sanitiser as the analysis hook — any ticker with an
        // unusual character is dropped from the sync so a single bad
        // CSV row can't blow up the whole subscription.
        const { valid } = sanitizeTickers(tickers);
        const res = await fetch("/api/portfolio/risks/watches", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            tickers: valid,
            minSeverity: prefs.minSeverity,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          report?: {
            added: number;
            removed: number;
            kept: number;
            total: number;
          };
          error?: string;
        };
        if (!res.ok || !body?.ok) {
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        prefs.recordSync(body.report ?? null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setSyncError(msg);
        throw e;
      } finally {
        setSyncing(false);
      }
    },
    [prefs],
  );

  const fetchWatches = React.useCallback(async (): Promise<RiskWatch[]> => {
    const res = await fetch("/api/portfolio/risks/watches", {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { watches: RiskWatch[] };
    return body.watches;
  }, []);

  const setEnabled = React.useCallback(
    async (v: boolean) => {
      prefs.setEnabled(v);
      // Turning OFF: clear the server-side watches so the worker
      // stops pinging. Turning ON: caller is responsible for calling
      // `syncTickers()` with the current holding list — done from
      // the tab component where the list is available.
      if (!v) {
        try {
          await syncTickers([]);
        } catch {
          /* surfaced via syncError */
        }
      }
    },
    [prefs, syncTickers],
  );

  return {
    enabled: prefs.enabled,
    minSeverity: prefs.minSeverity,
    setEnabled,
    setMinSeverity: prefs.setMinSeverity,
    syncTickers,
    fetchWatches,
    lastSyncedAt: prefs.lastSyncedAt,
    lastReport: prefs.lastReport,
    syncing,
    syncError,
  };
}
