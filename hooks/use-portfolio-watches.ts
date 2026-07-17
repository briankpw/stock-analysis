"use client";

/**
 * Client hook for portfolio-watch rules.
 *
 * Mirrors the design of `hooks/use-watchlist.ts` — module-scoped cache
 * + subscriber pattern so every "Watch trades" toggle across the app
 * stays in sync without a page reload.
 *
 * State backing the hook is one flat list of `PortfolioWatch` rows
 * fetched from `/api/portfolios/watches`. Consumers usually only need
 * `isPersonWatched(...)` or `isTickerWatched(...)` — both O(N) but N is
 * small (a couple dozen at most).
 */

import * as React from "react";
import type {
  PortfolioWatch,
  WatchKind,
} from "@/lib/portfolio-watch/store";
import type {
  EventAction,
  EventCategory,
} from "@/lib/portfolio-watch/events";

type Listener = () => void;

const _listeners = new Set<Listener>();
let _entries: PortfolioWatch[] | null = null;
let _error: string | null = null;
let _inflight: Promise<PortfolioWatch[]> | null = null;

function _notify() {
  _listeners.forEach((l) => l());
}

async function _fetchOnce(): Promise<PortfolioWatch[]> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await fetch("/api/portfolios/watches", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { watches: PortfolioWatch[] };
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

export interface UsePortfolioWatches {
  watches: PortfolioWatch[];
  loading: boolean;
  error: string | null;
  isPersonWatched: (category: EventCategory, presetId: string) => boolean;
  isTickerWatched: (ticker: string) => boolean;
  addPerson: (category: EventCategory, presetId: string, actions?: EventAction[]) => Promise<void>;
  addTicker: (ticker: string, actions?: EventAction[]) => Promise<void>;
  removePerson: (category: EventCategory, presetId: string) => Promise<void>;
  removeTicker: (ticker: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function usePortfolioWatches(): UsePortfolioWatches {
  const [entries, setEntries] = React.useState<PortfolioWatch[] | null>(_entries);
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
        .catch(() => { /* fanned out via sync */ })
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

  const isPersonWatched = React.useCallback(
    (category: EventCategory, presetId: string) =>
      (entries ?? []).some(
        (w) => w.kind === "person" && w.category === category && w.presetId === presetId,
      ),
    [entries],
  );

  const isTickerWatched = React.useCallback(
    (ticker: string) => {
      const upper = ticker.toUpperCase();
      return (entries ?? []).some(
        (w) => w.kind === "ticker" && w.ticker === upper,
      );
    },
    [entries],
  );

  const addPerson = React.useCallback(
    async (category: EventCategory, presetId: string, actions?: EventAction[]) => {
      await _post({ kind: "person", category, presetId, actions });
      await _refresh();
    },
    [],
  );

  const addTicker = React.useCallback(
    async (ticker: string, actions?: EventAction[]) => {
      const sym = ticker.trim().toUpperCase();
      if (!sym) return;
      await _post({ kind: "ticker", ticker: sym, actions });
      await _refresh();
    },
    [],
  );

  const removePerson = React.useCallback(
    async (category: EventCategory, presetId: string) => {
      const params = new URLSearchParams({
        kind: "person",
        category,
        presetId,
      });
      const res = await fetch(`/api/portfolios/watches?${params.toString()}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      await _refresh();
    },
    [],
  );

  const removeTicker = React.useCallback(async (ticker: string) => {
    const sym = ticker.trim().toUpperCase();
    const params = new URLSearchParams({ kind: "ticker", ticker: sym });
    const res = await fetch(`/api/portfolios/watches?${params.toString()}`, {
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
    watches: entries ?? [],
    loading,
    error,
    isPersonWatched,
    isTickerWatched,
    addPerson,
    addTicker,
    removePerson,
    removeTicker,
    refresh,
  };
}

async function _post(body: {
  kind: WatchKind;
  category?: EventCategory;
  presetId?: string;
  ticker?: string;
  actions?: EventAction[];
}): Promise<void> {
  const res = await fetch("/api/portfolios/watches", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b?.error ?? `HTTP ${res.status}`);
  }
}
