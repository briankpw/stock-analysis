"use client";

import * as React from "react";
import type { FearGreedResponse } from "@/app/api/fear-greed/route";

export interface FearGreedState {
  data: FearGreedResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

let _cache: FearGreedResponse | null = null;

/**
 * Client hook that fetches the CNN Fear & Greed Index once per session
 * (or on-demand via `reload`). The value updates roughly once per US
 * business day; the server-side route caches for 30 minutes on top so
 * repeated page loads within a session don't hit CNN again.
 */
export function useFearGreed(): FearGreedState {
  const [data, setData] = React.useState<FearGreedResponse | null>(_cache);
  const [loading, setLoading] = React.useState(_cache === null);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    if (_cache && nonce === 0) {
      setData(_cache);
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/fear-greed${nonce > 0 ? `?_=${nonce}` : ""}`, {
          cache: "no-store",
        });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.error ?? `HTTP ${res.status}`);
          setData(null);
        } else {
          _cache = body as FearGreedResponse;
          setData(body as FearGreedResponse);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [nonce]);

  return { data, loading, error, reload };
}
