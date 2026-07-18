"use client";

/**
 * Client hook for per-ticker technical-signal alerts.
 *
 * Mirrors the pattern used by `use-news-subscriptions.ts` and
 * `use-stock-watches.ts`: a module-scoped cache plus a subscriber set
 * so every alert control across the app stays in sync without page
 * reloads. Updating the daily-time picker on the signal card
 * immediately reflects in the "You have 1 alert" chip elsewhere.
 */

import * as React from "react";
import type {
  AlertStrength,
  TechnicalAlert,
} from "@/lib/technical-watch/store";

type Listener = () => void;

const _listeners = new Set<Listener>();
let _entries: TechnicalAlert[] | null = null;
let _error: string | null = null;
let _inflight: Promise<TechnicalAlert[]> | null = null;

function _notify() {
  _listeners.forEach((l) => l());
}

async function _fetchOnce(): Promise<TechnicalAlert[]> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await fetch("/api/technical-alerts", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { alerts: TechnicalAlert[] };
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

export interface UpsertAlertArgs {
  ticker: string;
  dailyTime?: string | null;
  timezone?: string;
  notifyOnChange?: boolean;
  minStrength?: AlertStrength;
}

export interface UseTechnicalAlerts {
  alerts: TechnicalAlert[];
  loading: boolean;
  error: string | null;
  find: (ticker: string) => TechnicalAlert | undefined;
  upsert: (args: UpsertAlertArgs) => Promise<TechnicalAlert>;
  remove: (ticker: string) => Promise<void>;
  test: (ticker: string) => Promise<{ ok: boolean; detail?: string }>;
  refresh: () => Promise<void>;
}

export function useTechnicalAlerts(): UseTechnicalAlerts {
  const [entries, setEntries] = React.useState<TechnicalAlert[] | null>(
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
    async (args: UpsertAlertArgs): Promise<TechnicalAlert> => {
      const res = await fetch("/api/technical-alerts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ticker: args.ticker.trim().toUpperCase(),
          dailyTime: args.dailyTime,
          timezone: args.timezone,
          notifyOnChange: args.notifyOnChange,
          minStrength: args.minStrength,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as
        | { ok?: boolean; alert?: TechnicalAlert; error?: string }
        | Record<string, unknown>;
      if (!res.ok || !("ok" in body) || !body.ok || !("alert" in body) || !body.alert) {
        const msg =
          (body as { error?: string }).error ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      await _refresh();
      return (body as { alert: TechnicalAlert }).alert;
    },
    [],
  );

  const remove = React.useCallback(async (ticker: string) => {
    const sym = ticker.trim().toUpperCase();
    const params = new URLSearchParams({ ticker: sym });
    const res = await fetch(`/api/technical-alerts?${params.toString()}`, {
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
      const res = await fetch("/api/technical-alerts/test", {
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
