"use client";

import * as React from "react";
import { useUi } from "@/lib/state";
import type { Bar, Enriched, LatestSignals, MacdResult, BollingerBands, NullableSeries, SupportResistance } from "@/lib/indicators";
import type { MetricGroup } from "@/lib/ratios";
import type { Analysis } from "@/lib/insights";
import type { Quote } from "@/lib/data";

/** JSON-safe subset of `Enriched` (what `/api/bundle` actually ships). */
export interface BundleIndicators {
  sma20: NullableSeries;
  sma50: NullableSeries;
  sma200: NullableSeries;
  ema20: NullableSeries;
  rsi14: NullableSeries;
  macd: MacdResult;
  bb20: BollingerBands;
  returns: NullableSeries;
  levels: SupportResistance;
}

export interface Bundle {
  ticker: string;
  period: string;
  interval: string;
  quote: Quote;
  bars: Bar[];
  indicators: BundleIndicators;
  signals: LatestSignals | null;
  groups: MetricGroup[];
  analysis: Analysis;
  rateLimited: boolean;
  fetchedAt: string;
  companyName: string;
  sector: string | null;
  industry: string | null;
}

export interface BundleState {
  data: Bundle | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const _cache = new Map<string, Bundle>();

/**
 * Client hook that pulls the aggregator payload for the current
 * (ticker, period, interval) triple. Uses a module-scoped Map as a
 * mini-cache so navigation between pages doesn't re-fetch every time.
 */
export function useBundle(): BundleState {
  const ticker = useUi((s) => s.ticker);
  const period = useUi((s) => s.period);
  const interval = useUi((s) => s.interval);

  const key = `${ticker}:${period}:${interval}`;
  const [data, setData] = React.useState<Bundle | null>(() => _cache.get(key) ?? null);
  const [loading, setLoading] = React.useState(!_cache.has(key));
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    const cached = _cache.get(key);
    if (cached && nonce === 0) {
      setData(cached);
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/bundle?ticker=${encodeURIComponent(ticker)}&period=${encodeURIComponent(period)}&interval=${encodeURIComponent(interval)}${nonce > 0 ? `&_=${nonce}` : ""}`,
          { cache: "no-store" },
        );
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.error ?? `HTTP ${res.status}`);
          setData(null);
        } else {
          _cache.set(key, body as Bundle);
          setData(body as Bundle);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [key, ticker, period, interval, nonce]);

  return { data, loading, error, reload };
}
