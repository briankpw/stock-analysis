"use client";

import * as React from "react";
import { useUi } from "@/lib/state";
import type { Aggregate, SentimentLabel, ImpactLabel } from "@/lib/sentiment";

export interface NewsItem {
  title: string;
  publisher: string;
  link: string;
  publishedAt: string;
  summary: string;
  score: number;
  label: SentimentLabel;
  impact: ImpactLabel;
  /** ISO timestamp of when this row was first added to the local DB. */
  firstSeenAt?: string;
}

export interface NewsResponse {
  ticker: string;
  items: NewsItem[];
  aggregate: Aggregate;
  fetchedAt: string;
  /** Number of items newly inserted on this fetch (i.e. links not in DB before). */
  newlyInserted?: number;
  /** Total headlines the local DB has accumulated for this ticker. */
  totalStored?: number;
  /** True when Yahoo blocked us but we still returned cached history. */
  rateLimited?: boolean;
}

export interface NewsState {
  data: NewsResponse | null;
  loading: boolean;
  error: string | null;
  rateLimited: boolean;
  reload: () => void;
}

export function useNews(): NewsState {
  const ticker = useUi((s) => s.ticker);
  const [data, setData] = React.useState<NewsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [rateLimited, setRateLimited] = React.useState(false);
  const [nonce, setNonce] = React.useState(0);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRateLimited(false);
    (async () => {
      try {
        const res = await fetch(
          `/api/news?ticker=${encodeURIComponent(ticker)}${nonce > 0 ? `&_=${nonce}` : ""}`,
          { cache: "no-store" },
        );
        const body = await res.json();
        if (cancelled) return;
        if (res.status === 429 && !Array.isArray(body?.items)) {
          // Yahoo blocked us AND we had no cached history — hard fail.
          setRateLimited(true);
          setData(null);
        } else if (!res.ok) {
          setError(body?.error ?? `HTTP ${res.status}`);
        } else {
          // status 200 — data always includes DB history. If Yahoo was
          // blocked but we had cache, `body.rateLimited` is true; the
          // page renders both a soft banner and the accumulated list.
          setRateLimited(Boolean(body?.rateLimited));
          setData(body as NewsResponse);
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
