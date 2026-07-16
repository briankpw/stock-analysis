"use client";

/**
 * Watchlist state — a tiny module-scoped store on top of `/api/watchlist`.
 *
 * Every consumer (sidebar ticker picker, "Add to watchlist" buttons on the
 * Portfolios / Paper pages, …) reads and mutates through this hook so an
 * add on one page updates the sidebar instantly, without a page reload.
 *
 * Design notes:
 *   - `_entries` is the single source of truth cached in module scope.
 *   - A `Set<Listener>` fans changes out to every mounted `useWatchlist()`.
 *   - Mutations (`add` / `remove`) POST or DELETE against the API, refetch
 *     the canonical list, then notify subscribers.
 *   - A shared `_inflight` promise deduplicates concurrent initial fetches
 *     across many mounted consumers.
 */

import * as React from "react";

export interface WatchlistEntry {
  symbol: string;
  displayName: string;
}

type Listener = () => void;

const _listeners = new Set<Listener>();
let _entries: WatchlistEntry[] | null = null;
let _error: string | null = null;
let _inflight: Promise<WatchlistEntry[]> | null = null;

function _notify() {
  _listeners.forEach((l) => l());
}

async function _fetchOnce(): Promise<WatchlistEntry[]> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await fetch("/api/watchlist", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { entries: WatchlistEntry[] };
      _entries = body.entries;
      _error = null;
      return body.entries;
    } catch (e) {
      _error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

/** Force a re-fetch (bypasses the cache). Called after mutations. */
async function _refresh(): Promise<void> {
  _entries = null; // invalidate so `_fetchOnce` starts a new request
  try {
    await _fetchOnce();
  } finally {
    _notify();
  }
}

export interface UseWatchlist {
  entries: WatchlistEntry[];
  /** Set of symbols currently on the watchlist, for fast `has()` checks. */
  symbols: Set<string>;
  loading: boolean;
  error: string | null;
  /** Add a symbol. Idempotent — a repeat call is a no-op server-side. */
  add: (symbol: string, displayName?: string) => Promise<void>;
  remove: (symbol: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useWatchlist(): UseWatchlist {
  const [entries, setEntries] = React.useState<WatchlistEntry[] | null>(_entries);
  const [error, setError] = React.useState<string | null>(_error);
  const [loading, setLoading] = React.useState(_entries === null);

  React.useEffect(() => {
    let cancelled = false;
    const sync: Listener = () => {
      if (cancelled) return;
      setEntries(_entries);
      setError(_error);
    };
    _listeners.add(sync);

    if (_entries === null && !_inflight) {
      setLoading(true);
      _fetchOnce()
        .catch(() => { /* error captured on `_error` and fanned out via sync */ })
        .finally(() => {
          if (!cancelled) setLoading(false);
          _notify();
        });
    } else if (_inflight) {
      _inflight.finally(() => { if (!cancelled) setLoading(false); });
    } else {
      setLoading(false);
    }

    return () => {
      cancelled = true;
      _listeners.delete(sync);
    };
  }, []);

  const symbols = React.useMemo(
    () => new Set((entries ?? []).map((e) => e.symbol.toUpperCase())),
    [entries],
  );

  const add = React.useCallback(async (symbol: string, displayName?: string) => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol: sym, displayName }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error ?? `HTTP ${res.status}`);
    }
    await _refresh();
  }, []);

  const remove = React.useCallback(async (symbol: string) => {
    const sym = symbol.trim().toUpperCase();
    const res = await fetch(`/api/watchlist?symbol=${encodeURIComponent(sym)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error ?? `HTTP ${res.status}`);
    }
    await _refresh();
  }, []);

  const refresh = React.useCallback(() => _refresh(), []);

  return {
    entries: entries ?? [],
    symbols,
    loading,
    error,
    add,
    remove,
    refresh,
  };
}
