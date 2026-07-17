"use client";

/**
 * Client hook for per-ticker insider-transaction watches.
 *
 * Same pattern as `hooks/use-portfolio-watches.ts`: module-scoped cache
 * + subscriber set so every "Alert on insider trades" toggle across the
 * app stays in sync without page reloads.
 */

import * as React from "react";
import type {
  StockWatch,
  WatchAction,
} from "@/lib/stock-watch/store";

type Listener = () => void;

const _listeners = new Set<Listener>();
let _entries: StockWatch[] | null = null;
let _error: string | null = null;
let _inflight: Promise<StockWatch[]> | null = null;

function _notify() {
  _listeners.forEach((l) => l());
}

async function _fetchOnce(): Promise<StockWatch[]> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await fetch("/api/stock-watches", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { watches: StockWatch[] };
      _entries = body.watches;
      _error = null;
      return body.watches;
    } catch (e) {
      _error = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

async function _refresh(): Promise<void> {
  _entries = null;
  try {
    await _fetchOnce();
  } finally {
    _notify();
  }
}

export interface UseStockWatches {
  watches: StockWatch[];
  loading: boolean;
  error: string | null;
  isTickerWatched: (ticker: string) => boolean;
  addTicker: (ticker: string, actions?: WatchAction[]) => Promise<void>;
  removeTicker: (ticker: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useStockWatches(): UseStockWatches {
  const [entries, setEntries] = React.useState<StockWatch[] | null>(_entries);
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
        .catch(() => { /* surfaced via sync */ })
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

  const isTickerWatched = React.useCallback(
    (ticker: string) => {
      const upper = ticker.trim().toUpperCase();
      return (entries ?? []).some((w) => w.ticker === upper);
    },
    [entries],
  );

  const addTicker = React.useCallback(
    async (ticker: string, actions?: WatchAction[]) => {
      const sym = ticker.trim().toUpperCase();
      if (!sym) return;
      const res = await fetch("/api/stock-watches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticker: sym, actions }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error ?? `HTTP ${res.status}`);
      }
      await _refresh();
    },
    [],
  );

  const removeTicker = React.useCallback(async (ticker: string) => {
    const sym = ticker.trim().toUpperCase();
    const params = new URLSearchParams({ ticker: sym });
    const res = await fetch(`/api/stock-watches?${params.toString()}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error(b?.error ?? `HTTP ${res.status}`);
    }
    await _refresh();
  }, []);

  const refresh = React.useCallback(() => _refresh(), []);

  return {
    watches: entries ?? [],
    loading,
    error,
    isTickerWatched,
    addTicker,
    removeTicker,
    refresh,
  };
}
