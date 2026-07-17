"use client";

/**
 * Client hook for per-ticker news subscriptions.
 *
 * Same pattern as `hooks/use-stock-watches.ts`: module-scoped cache
 * + subscriber set so every "Subscribe to news" toggle across the app
 * stays in sync without page reloads.
 */

import * as React from "react";
import type { NewsSubscription } from "@/lib/news-watch/store";

type Listener = () => void;

const _listeners = new Set<Listener>();
let _entries: NewsSubscription[] | null = null;
let _error: string | null = null;
let _inflight: Promise<NewsSubscription[]> | null = null;

function _notify() {
  _listeners.forEach((l) => l());
}

async function _fetchOnce(): Promise<NewsSubscription[]> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await fetch("/api/news-subscriptions", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { subscriptions: NewsSubscription[] };
      _entries = body.subscriptions;
      _error = null;
      return body.subscriptions;
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

export interface UseNewsSubscriptions {
  subscriptions: NewsSubscription[];
  loading: boolean;
  error: string | null;
  isSubscribed: (ticker: string) => boolean;
  findSubscription: (ticker: string) => NewsSubscription | undefined;
  subscribe: (ticker: string) => Promise<void>;
  unsubscribe: (ticker: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useNewsSubscriptions(): UseNewsSubscriptions {
  const [entries, setEntries] = React.useState<NewsSubscription[] | null>(_entries);
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

  const isSubscribed = React.useCallback(
    (ticker: string) => {
      const upper = ticker.trim().toUpperCase();
      return (entries ?? []).some((s) => s.ticker === upper);
    },
    [entries],
  );

  const findSubscription = React.useCallback(
    (ticker: string) => {
      const upper = ticker.trim().toUpperCase();
      return (entries ?? []).find((s) => s.ticker === upper);
    },
    [entries],
  );

  const subscribe = React.useCallback(async (ticker: string) => {
    const sym = ticker.trim().toUpperCase();
    if (!sym) return;
    const res = await fetch("/api/news-subscriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticker: sym }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error(b?.error ?? `HTTP ${res.status}`);
    }
    await _refresh();
  }, []);

  const unsubscribe = React.useCallback(async (ticker: string) => {
    const sym = ticker.trim().toUpperCase();
    const params = new URLSearchParams({ ticker: sym });
    const res = await fetch(`/api/news-subscriptions?${params.toString()}`, {
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
    subscriptions: entries ?? [],
    loading,
    error,
    isSubscribed,
    findSubscription,
    subscribe,
    unsubscribe,
    refresh,
  };
}
