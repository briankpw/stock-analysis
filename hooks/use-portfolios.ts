"use client";

import * as React from "react";
import type {
  FundPreset,
  FundReport,
  PersonPreset,
  PersonReport,
  PoliticianPreset,
  PoliticianReport,
  PortfolioIndex,
} from "@/lib/portfolios";

// ---------------------------------------------------------------------------
// Index (preset list) — fetched once per session.
// ---------------------------------------------------------------------------

interface IndexState {
  data: PortfolioIndex | null;
  loading: boolean;
  error: string | null;
}

let _indexCache: PortfolioIndex | null = null;

export function usePortfolioIndex(): IndexState {
  const [data, setData] = React.useState<PortfolioIndex | null>(_indexCache);
  const [loading, setLoading] = React.useState(_indexCache === null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (_indexCache) {
      setData(_indexCache);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/portfolios", { cache: "no-store" });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.error ?? `HTTP ${res.status}`);
        } else {
          _indexCache = body as PortfolioIndex;
          setData(_indexCache);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { data, loading, error };
}

// ---------------------------------------------------------------------------
// Detail fetchers (politician + fund) — one per selected preset.
// ---------------------------------------------------------------------------

type Detail<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  sourceUnavailable: boolean;
  reload: () => void;
};

function useDetail<T>(
  kind: "politician" | "fund" | "person",
  preset: PoliticianPreset | FundPreset | PersonPreset | null,
): Detail<T> {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sourceUnavailable, setSourceUnavailable] = React.useState(false);
  const [nonce, setNonce] = React.useState(0);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    if (!preset) {
      setData(null);
      setSourceUnavailable(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSourceUnavailable(false);
    (async () => {
      try {
        const params = new URLSearchParams({ type: kind, id: preset.id });
        if (nonce > 0) params.set("_", String(nonce));
        const res = await fetch(`/api/portfolios?${params}`, { cache: "no-store" });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          if (body?.sourceUnavailable) {
            setSourceUnavailable(true);
          } else {
            setError(body?.error ?? `HTTP ${res.status}`);
          }
          setData(null);
        } else {
          setData(body as T);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [kind, preset, nonce]);

  return { data, loading, error, sourceUnavailable, reload };
}

export function usePoliticianReport(preset: PoliticianPreset | null): Detail<PoliticianReport> {
  return useDetail<PoliticianReport>("politician", preset);
}

export function useFundReport(preset: FundPreset | null): Detail<FundReport> {
  return useDetail<FundReport>("fund", preset);
}

export function usePersonReport(preset: PersonPreset | null): Detail<PersonReport> {
  return useDetail<PersonReport>("person", preset);
}
