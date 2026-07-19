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
// Index (preset list) — merged built-in + custom presets. Kept in a
// module-scoped cache with a listener fan-out so an add/remove in one
// component instantly updates every other consumer (same pattern as
// `useWatchlist`).
// ---------------------------------------------------------------------------

interface IndexState {
  data: PortfolioIndex | null;
  loading: boolean;
  error: string | null;
  addPreset: (
    category: "politician" | "fund" | "person",
    preset: PoliticianPreset | FundPreset | PersonPreset,
  ) => Promise<void>;
  removePreset: (
    category: "politician" | "fund" | "person",
    id: string,
  ) => Promise<void>;
}

type Listener = () => void;
const _listeners = new Set<Listener>();
let _indexCache: PortfolioIndex | null = null;
let _indexError: string | null = null;
let _inflight: Promise<PortfolioIndex> | null = null;

function _notify() {
  _listeners.forEach((l) => l());
}

async function _fetchIndex(): Promise<PortfolioIndex> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await fetch("/api/portfolios", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      _indexCache = body as PortfolioIndex;
      _indexError = null;
      return _indexCache;
    } catch (e) {
      _indexError = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

async function _refreshIndex(): Promise<void> {
  _indexCache = null;
  try {
    await _fetchIndex();
  } finally {
    _notify();
  }
}

export function usePortfolioIndex(): IndexState {
  const [data, setData] = React.useState<PortfolioIndex | null>(_indexCache);
  const [loading, setLoading] = React.useState(_indexCache === null);
  const [error, setError] = React.useState<string | null>(_indexError);

  React.useEffect(() => {
    let cancelled = false;
    const sync: Listener = () => {
      if (cancelled) return;
      setData(_indexCache);
      setError(_indexError);
    };
    _listeners.add(sync);

    if (_indexCache === null && !_inflight) {
      setLoading(true);
      _fetchIndex()
        .catch(() => { /* error captured on _indexError and fanned via sync */ })
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

  const addPreset = React.useCallback(
    async (
      category: "politician" | "fund" | "person",
      preset: PoliticianPreset | FundPreset | PersonPreset,
    ) => {
      const res = await fetch("/api/portfolios/presets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category, preset }),
      });
      const body = await res.json();
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      _indexCache = body.index as PortfolioIndex;
      _indexError = null;
      _notify();
    },
    [],
  );

  const removePreset = React.useCallback(
    async (category: "politician" | "fund" | "person", id: string) => {
      const params = new URLSearchParams({ category, id });
      const res = await fetch(`/api/portfolios/presets?${params}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      _indexCache = body.index as PortfolioIndex;
      _indexError = null;
      _notify();
    },
    [],
  );

  return { data, loading, error, addPreset, removePreset };
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

// ---------------------------------------------------------------------------
// Module-scoped detail cache. The server already keeps a persistent
// SQLite snapshot per preset (see `lib/portfolios-cache/`), so the
// network round-trip is fast — but re-mounts of the same preset
// were still triggering a fetch + spinner + re-layout. Caching the
// last successful payload in-module means the second visit to the
// same preset renders instantly and does a silent re-fetch in the
// background, matching the server-side stale-while-revalidate
// story end-to-end.
// ---------------------------------------------------------------------------

type CacheKey = string; // `${kind}:${id}`
const _detailCache = new Map<CacheKey, unknown>();

function cacheKey(kind: string, id: string): CacheKey {
  return `${kind}:${id}`;
}

function useDetail<T>(
  kind: "politician" | "fund" | "person",
  preset: PoliticianPreset | FundPreset | PersonPreset | null,
): Detail<T> {
  const initial = preset
    ? (_detailCache.get(cacheKey(kind, preset.id)) as T | undefined) ?? null
    : null;
  const [data, setData] = React.useState<T | null>(initial);
  // Cache hits skip the loading state entirely — the previous
  // payload is displayed while a background refresh happens. Only
  // cold fetches (no cache) show a spinner.
  const [loading, setLoading] = React.useState(initial === null);
  const [error, setError] = React.useState<string | null>(null);
  const [sourceUnavailable, setSourceUnavailable] = React.useState(false);
  const [nonce, setNonce] = React.useState(0);

  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    if (!preset) {
      setData(null);
      setSourceUnavailable(false);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const key = cacheKey(kind, preset.id);
    // Seed with any prior payload for this preset so switching
    // between politicians never blanks the screen.
    const seeded = _detailCache.get(key) as T | undefined;
    if (seeded !== undefined) {
      setData(seeded);
      setLoading(false);
    } else {
      setData(null);
      setLoading(true);
    }
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
          // Only clear the payload on cold errors — if we already
          // had a cached value we'd rather keep showing it.
          if (seeded === undefined) setData(null);
        } else {
          _detailCache.set(key, body);
          setData(body as T);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // `preset` is a stable-per-selection object from the parent's
    // preset picker — safe to depend on the reference. `preset.id`
    // is included in the fetch, so switching presets triggers a
    // new effect naturally.
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
