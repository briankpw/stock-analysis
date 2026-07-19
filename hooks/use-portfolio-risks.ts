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

// ---------------------------------------------------------------------------
// Module-scoped shared cache for risk assessments
// ---------------------------------------------------------------------------
//
// Multiple components can (and do) mount `usePortfolioRiskAnalysis`
// with the same ticker list — most notably the Risks tab BODY and
// the Risks tab BADGE render simultaneously on `/my-portfolio`. Each
// mount used to run its own POST + its own 5-minute interval, so a
// typical page load actually fired the analyser TWICE and both fanned
// out to Yahoo+news APIs. Sharing state at module level collapses
// that to one fetch, one interval, and one identical result vended
// to every subscriber.
//
// Key = the sorted valid tickers joined by comma. Sorting is what
// makes "same portfolio in different UI order" hit the same cache
// entry.

interface RiskCacheEntry {
  assessments: RiskAssessment[];
  serverErrors: Array<{ ticker: string; error: string }>;
  fetchedAtMs: number;
  fetchedAtIso: string;
}

const _riskCache = new Map<string, RiskCacheEntry>();
const _riskInflight = new Map<
  string,
  Promise<{
    assessments: RiskAssessment[];
    errors: Array<{ ticker: string; error: string }>;
  }>
>();
// Per-key subscriber sets so we can notify every mounted hook when a
// fresh result lands. The value is a plain Set of callbacks; each
// hook registers on mount and unregisters on unmount.
const _riskSubscribers = new Map<string, Set<() => void>>();
// Per-key interval handle so we run AT MOST one auto-refresh timer
// per (portfolio, minSeverity) — no matter how many components ask
// for the same data. Started when the first subscriber for a key
// arrives, torn down when the last one leaves.
const _riskIntervals = new Map<
  string,
  { handle: ReturnType<typeof setInterval>; visListener: () => void }
>();

function _emitRiskChange(key: string): void {
  const subs = _riskSubscribers.get(key);
  if (subs) for (const cb of subs) cb();
}

/**
 * Do the POST once for a given ticker key and cache the result.
 * Concurrent callers for the same key await the same in-flight
 * promise; sequential callers within `refreshMs` are served from
 * cache without hitting the network.
 */
async function _fetchRiskAnalysis(
  key: string,
  validTickers: readonly string[],
  refreshMs: number,
  forceRefresh: boolean,
): Promise<RiskCacheEntry> {
  const cached = _riskCache.get(key);
  if (!forceRefresh && cached && Date.now() - cached.fetchedAtMs < refreshMs) {
    return cached;
  }
  const existing = _riskInflight.get(key);
  if (existing) {
    // Something else already asked; piggyback on its promise, then
    // read whatever landed in the cache.
    await existing;
    return _riskCache.get(key) ?? cached ?? {
      assessments: [],
      serverErrors: [],
      fetchedAtMs: 0,
      fetchedAtIso: "",
    };
  }
  const p = (async () => {
    const res = await fetch("/api/portfolio/risks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tickers: validTickers }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body?.error ?? `HTTP ${res.status}`);
    }
    return (await res.json()) as {
      assessments: RiskAssessment[];
      errors: Array<{ ticker: string; error: string }>;
    };
  })();
  _riskInflight.set(key, p);
  try {
    const body = await p;
    const entry: RiskCacheEntry = {
      assessments: body.assessments,
      serverErrors: body.errors ?? [],
      fetchedAtMs: Date.now(),
      fetchedAtIso: new Date().toISOString(),
    };
    _riskCache.set(key, entry);
    _emitRiskChange(key);
    return entry;
  } finally {
    // Drop the in-flight slot only if it's still us — protects
    // against a stale settle racing a fresh request that has
    // already replaced the slot.
    if (_riskInflight.get(key) === p) _riskInflight.delete(key);
  }
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
 *
 * Multiple mounts of this hook for the same ticker set share ONE
 * cache entry and ONE auto-refresh interval — see the module-scoped
 * `_riskCache` / `_riskInflight` / `_riskIntervals` above.
 */
export function usePortfolioRiskAnalysis(
  tickers: readonly string[],
  { refreshMs = 5 * 60 * 1000 }: { refreshMs?: number } = {},
): UsePortfolioRiskAnalysis {
  // Normalise + memoise the ticker list so identity is stable across
  // re-renders — otherwise the effect refires on every parent tick.
  // The sanitiser also splits out invalid tickers so we can surface
  // them without failing the entire batch.
  const sanitized = React.useMemo(() => sanitizeTickers(tickers), [tickers]);
  // Sort so "AAPL,MSFT" and "MSFT,AAPL" collide on the same cache
  // entry — the API response is order-independent (a per-ticker map)
  // so this is safe.
  const key = React.useMemo(
    () => [...sanitized.valid].sort().join(","),
    [sanitized.valid],
  );
  const invalidKey = sanitized.invalid.join(",");

  // Local mirror of the shared cache entry. Updated via subscription
  // whenever `_riskCache.get(key)` changes; also seeded from cache on
  // first mount so a re-mount of the same page shows data instantly
  // instead of blank-and-loading.
  const initialCached = _riskCache.get(key);
  const [entry, setEntry] = React.useState<RiskCacheEntry | null>(
    initialCached ?? null,
  );
  const [error, setError] = React.useState<string | null>(null);
  // `loading` is TRUE when there's no cached entry yet AND a fetch is
  // in progress (the classic "spinner on first paint" state). After
  // the first successful fetch, subsequent auto-refreshes happen
  // silently in the background — the stale data stays on screen so
  // the UI doesn't flicker.
  const [loading, setLoading] = React.useState(!initialCached && !!key);

  const localErrors: Array<{ ticker: string; error: string }> =
    React.useMemo(
      () =>
        sanitized.invalid.map((t) => ({
          ticker: t,
          error: "Ticker symbol format not recognised — skipped.",
        })),
      [sanitized.invalid],
    );

  // Subscription — every hook instance re-reads the shared cache
  // when a fetch lands.
  React.useEffect(() => {
    if (!key) {
      setEntry(null);
      setLoading(false);
      return;
    }
    const cb = () => {
      setEntry(_riskCache.get(key) ?? null);
      setError(null);
      setLoading(false);
    };
    let subs = _riskSubscribers.get(key);
    if (!subs) {
      subs = new Set();
      _riskSubscribers.set(key, subs);
    }
    subs.add(cb);
    return () => {
      subs?.delete(cb);
      if (subs && subs.size === 0) {
        _riskSubscribers.delete(key);
        // Tear down the shared interval when the last subscriber
        // leaves. Keeps the browser from running a timer for a
        // portfolio nobody's looking at.
        const iv = _riskIntervals.get(key);
        if (iv) {
          clearInterval(iv.handle);
          document.removeEventListener("visibilitychange", iv.visListener);
          _riskIntervals.delete(key);
        }
      }
    };
  }, [key]);

  // Initial fetch + shared interval bootstrap.
  React.useEffect(() => {
    if (!key) return;
    let cancelled = false;
    (async () => {
      try {
        // If a fresh cache entry already exists, this returns
        // instantly; otherwise it runs (or joins) the shared fetch.
        await _fetchRiskAnalysis(key, sanitized.valid, refreshMs, false);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();

    // Bootstrap ONE interval per key. If another mount already
    // started one for this key, we piggyback.
    if (!_riskIntervals.get(key)) {
      const tick = () => {
        void _fetchRiskAnalysis(key, sanitized.valid, refreshMs, true).catch(
          () => {
            /* individual failures are surfaced via next successful fetch */
          },
        );
      };
      const handle = setInterval(tick, refreshMs);
      const visListener = () => {
        // Bring the cache up to date the moment the tab comes back
        // to the foreground — same "wake and refresh" UX as
        // `useLiveQuotes` in the positions table.
        if (document.visibilityState === "visible") tick();
      };
      document.addEventListener("visibilitychange", visListener);
      _riskIntervals.set(key, { handle, visListener });
    }

    return () => {
      cancelled = true;
    };
    // `invalidKey` participates so a CSV fix that renames symbols
    // re-runs the effect. `sanitized.valid` is stable per `key`.
  }, [key, refreshMs, invalidKey, sanitized.valid]);

  const refresh = React.useCallback(() => {
    if (!key) return;
    setLoading(true);
    void _fetchRiskAnalysis(key, sanitized.valid, refreshMs, true).catch(
      (e) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      },
    );
  }, [key, refreshMs, sanitized.valid]);

  const assessments = entry?.assessments ?? [];
  const serverErrors = entry?.serverErrors ?? [];
  return {
    assessments,
    loading,
    error,
    errors: [...localErrors, ...serverErrors],
    skipped: sanitized.skipped,
    lastFetchedAt: entry?.fetchedAtIso ?? null,
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

  // Re-entrancy guards for `syncTickers`. Without them:
  //   * A user toggling holdings quickly can queue up 3+ overlapping
  //     `POST /api/portfolio/risks/watches` calls. The server does
  //     an atomic `sync` (add+remove) per request, so 3 partial
  //     "should be" states race — final state is whichever request's
  //     Yahoo write lands last, not necessarily the user's latest
  //     intent.
  //   * On slow networks, `setSyncing(true)` from an earlier call
  //     can be overwritten by `setSyncing(false)` from a later,
  //     faster-completing call — leaving the UI saying "synced" while
  //     the older POST is still in flight.
  //
  // Strategy = last-request-wins with coalescing:
  //   * `_syncInflight` tracks the currently-running POST.
  //   * `_syncPending` holds the ticker list the caller *would* have
  //     wanted to send if there hadn't been one in flight.
  //   * When the in-flight POST settles, if a pending list has since
  //     been recorded, we immediately fire a follow-up POST for it —
  //     ensuring the server ends up with the latest asked-for state,
  //     but never fanning out N concurrent writers.
  const _syncInflightRef = React.useRef<Promise<void> | null>(null);
  const _syncPendingRef = React.useRef<readonly string[] | null>(null);

  const syncTickers = React.useCallback(
    async (tickers: readonly string[]): Promise<void> => {
      // If a POST is in flight, park the new request as "the state
      // we'll flush when the current one finishes" and return
      // immediately. The parked request completes when the trailing
      // POST does.
      if (_syncInflightRef.current) {
        _syncPendingRef.current = tickers;
        return _syncInflightRef.current;
      }

      const runOnce = async (list: readonly string[]): Promise<void> => {
        setSyncing(true);
        setSyncError(null);
        try {
          // Same sanitiser as the analysis hook — any ticker with an
          // unusual character is dropped from the sync so a single
          // bad CSV row can't blow up the whole subscription.
          const { valid } = sanitizeTickers(list);
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
        }
      };

      const drive = async (): Promise<void> => {
        let list: readonly string[] = tickers;
        try {
          while (true) {
            await runOnce(list);
            // Drain any request that landed while `runOnce` was
            // running. If none, we're done.
            const pending = _syncPendingRef.current;
            if (pending === null) break;
            _syncPendingRef.current = null;
            list = pending;
          }
        } finally {
          setSyncing(false);
          _syncInflightRef.current = null;
        }
      };

      const p = drive();
      _syncInflightRef.current = p;
      return p;
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
      // Turning OFF is the one case that needs a server round-trip
      // BEFORE we flip the local pref: if the delete-all-watches call
      // fails, we absolutely must not leave the UI saying "off" while
      // the server keeps pinging the user. Historically we wrote the
      // pref first and then swallowed the network error — so the
      // client and server would silently diverge and the user got
      // "phantom notifications after I turned them off".
      //
      // Turning ON is safe to write locally first because it's
      // *inert* from the server's perspective until the caller
      // follows up with `syncTickers(currentHoldings)`. The tab
      // component owns that call because it has the holding list;
      // there's no useful failure mode at this layer to roll back.
      if (!v) {
        const previous = prefs.enabled;
        try {
          await syncTickers([]);
          prefs.setEnabled(false);
        } catch (err) {
          // Server-side clear failed — surface the error and keep
          // the local pref where it was. `syncError` is already
          // populated by `syncTickers` for the components that read
          // it, but we also rethrow so a caller awaiting this
          // promise (e.g. a save-button handler) can show a toast
          // instead of silently swallowing.
          prefs.setEnabled(previous);
          throw err;
        }
      } else {
        prefs.setEnabled(true);
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
