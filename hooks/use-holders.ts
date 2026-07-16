"use client";

import * as React from "react";
import { useUi } from "@/lib/state";
import type { Holders } from "@/lib/data";

export interface HoldersState {
  data: Holders | null;
  loading: boolean;
  error: string | null;
  rateLimited: boolean;
  reload: () => void;
}

const _cache = new Map<string, Holders>();

/**
 * Client hook that pulls the ownership payload for the current ticker.
 * Mirrors `useNews` in shape — module-scoped Map cache keeps re-renders
 * cheap when swapping between pages.
 */
export function useHolders(): HoldersState {
  const ticker = useUi((s) => s.ticker);
  const [data, setData] = React.useState<Holders | null>(() => _cache.get(ticker) ?? null);
  const [loading, setLoading] = React.useState(!_cache.has(ticker));
  const [error, setError] = React.useState<string | null>(null);
  const [rateLimited, setRateLimited] = React.useState(false);
  const [nonce, setNonce] = React.useState(0);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    const cached = _cache.get(ticker);
    if (cached && nonce === 0) {
      setData(cached);
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    setError(null);
    setRateLimited(false);
    (async () => {
      try {
        const res = await fetch(
          `/api/holders?ticker=${encodeURIComponent(ticker)}${nonce > 0 ? `&_=${nonce}` : ""}`,
          { cache: "no-store" },
        );
        const body = await res.json();
        if (cancelled) return;
        if (res.status === 429 || body?.rateLimited) {
          setRateLimited(true);
          setData(null);
        } else if (!res.ok) {
          setError(body?.error ?? `HTTP ${res.status}`);
        } else {
          _cache.set(ticker, body as Holders);
          setData(body as Holders);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ticker, nonce]);

  return { data, loading, error, rateLimited, reload };
}
