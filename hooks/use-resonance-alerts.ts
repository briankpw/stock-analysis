"use client";

/**
 * Client hook for per-ticker 6-Signal Resonance alerts.
 *
 * Structural mirror of `use-technical-alerts.ts`. A module-scoped
 * cache plus a subscriber set keeps every alert control across the
 * app in sync without page reloads — updating the config on the
 * resonance card immediately reflects everywhere else.
 */

import * as React from "react";
import type { NotifyFrequency } from "@/lib/alert-frequency";
import type {
  ResonanceAlertStrength,
  ResonanceAlert,
} from "@/lib/resonance-watch/store";

type Listener = () => void;

const _listeners = new Set<Listener>();
let _entries: ResonanceAlert[] | null = null;
let _error: string | null = null;
let _inflight: Promise<ResonanceAlert[]> | null = null;

function _notify() {
  _listeners.forEach((l) => l());
}

async function _fetchOnce(): Promise<ResonanceAlert[]> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await fetch("/api/resonance-alerts", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { alerts: ResonanceAlert[] };
      _entries = body.alerts;
      _error = null;
      return body.alerts;
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

export interface UpsertResonanceAlertArgs {
  ticker: string;
  dailyTime?: string | null;
  timezone?: string;
  notifyOnChange?: boolean;
  minStrength?: ResonanceAlertStrength;
  frequency?: NotifyFrequency;
}

export interface UseResonanceAlerts {
  alerts: ResonanceAlert[];
  loading: boolean;
  error: string | null;
  find: (ticker: string) => ResonanceAlert | undefined;
  upsert: (args: UpsertResonanceAlertArgs) => Promise<ResonanceAlert>;
  remove: (ticker: string) => Promise<void>;
  test: (ticker: string) => Promise<{ ok: boolean; detail?: string }>;
  refresh: () => Promise<void>;
}

export function useResonanceAlerts(): UseResonanceAlerts {
  const [entries, setEntries] = React.useState<ResonanceAlert[] | null>(
    _entries,
  );
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
        .catch(() => {
          /* surfaced via sync */
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
          _notify();
        });
    } else if (_inflight) {
      _inflight.finally(() => {
        if (!cancelled) setLoading(false);
      });
    } else {
      setLoading(false);
    }

    return () => {
      cancelled = true;
      _listeners.delete(sync);
    };
  }, []);

  const find = React.useCallback(
    (ticker: string) => {
      const upper = ticker.trim().toUpperCase();
      return (entries ?? []).find((a) => a.ticker === upper);
    },
    [entries],
  );

  const upsert = React.useCallback(
    async (args: UpsertResonanceAlertArgs): Promise<ResonanceAlert> => {
      const res = await fetch("/api/resonance-alerts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ticker: args.ticker.trim().toUpperCase(),
          dailyTime: args.dailyTime,
          timezone: args.timezone,
          notifyOnChange: args.notifyOnChange,
          minStrength: args.minStrength,
          frequency: args.frequency,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as
        | { ok?: boolean; alert?: ResonanceAlert; error?: string }
        | Record<string, unknown>;
      if (!res.ok || !("ok" in body) || !body.ok || !("alert" in body) || !body.alert) {
        const msg =
          (body as { error?: string }).error ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      await _refresh();
      return (body as { alert: ResonanceAlert }).alert;
    },
    [],
  );

  const remove = React.useCallback(async (ticker: string) => {
    const sym = ticker.trim().toUpperCase();
    const params = new URLSearchParams({ ticker: sym });
    const res = await fetch(`/api/resonance-alerts?${params.toString()}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(b?.error ?? `HTTP ${res.status}`);
    }
    await _refresh();
  }, []);

  const test = React.useCallback(
    async (ticker: string): Promise<{ ok: boolean; detail?: string }> => {
      const res = await fetch("/api/resonance-alerts/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticker: ticker.trim().toUpperCase() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        detail?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      return { ok: Boolean(body.ok), detail: body.detail ?? body.error };
    },
    [],
  );

  const refresh = React.useCallback(() => _refresh(), []);

  return {
    alerts: entries ?? [],
    loading,
    error,
    find,
    upsert,
    remove,
    test,
    refresh,
  };
}
