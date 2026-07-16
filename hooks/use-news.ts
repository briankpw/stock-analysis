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
}

export interface NewsResponse {
  ticker: string;
  items: NewsItem[];
  aggregate: Aggregate;
  fetchedAt: string;
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
        if (res.status === 429 || body?.rateLimited) {
          setRateLimited(true);
          setData(null);
        } else if (!res.ok) {
          setError(body?.error ?? `HTTP ${res.status}`);
        } else {
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
