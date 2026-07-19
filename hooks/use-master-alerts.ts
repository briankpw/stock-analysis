"use client";

/**
 * Client hook for per-ticker Master Verdict alerts.
 *
 * Mirrors `use-technical-alerts.ts` — same module-scoped cache +
 * subscriber-set pattern so every alert control across the app stays
 * in sync without page reloads. Updating the daily-time picker on the
 * master card immediately reflects everywhere else the hook is used
 * (e.g. sidebar chip, bot page).
 *
 * The two `use-*-alerts` hooks look nearly identical on purpose;
 * factoring them into a generic would add abstraction cost without
 * saving much code and would couple the two subsystems in a way we
 * explicitly avoided at the DB + API layer.
 */

import * as React from "react";
import type {
  AlertStrength,
  MasterAlert,
} from "@/lib/master-watch/store";

type Listener = () => void;

const _listeners = new Set<Listener>();
let _entries: MasterAlert[] | null = null;
let _error: string | null = null;
let _inflight: Promise<MasterAlert[]> | null = null;

function _notify() {
  _listeners.forEach((l) => l());
}

async function _fetchOnce(): Promise<MasterAlert[]> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await fetch("/api/master-alerts", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { alerts: MasterAlert[] };
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

export interface UpsertMasterAlertArgs {
  ticker: string;
  dailyTime?: string | null;
  timezone?: string;
  notifyOnChange?: boolean;
  minStrength?: AlertStrength;
}

export interface UseMasterAlerts {
  alerts: MasterAlert[];
  loading: boolean;
  error: string | null;
  find: (ticker: string) => MasterAlert | undefined;
  upsert: (args: UpsertMasterAlertArgs) => Promise<MasterAlert>;
  remove: (ticker: string) => Promise<void>;
  test: (ticker: string) => Promise<{ ok: boolean; detail?: string }>;
  refresh: () => Promise<void>;
}

export function useMasterAlerts(): UseMasterAlerts {
  const [entries, setEntries] = React.useState<MasterAlert[] | null>(
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
    async (args: UpsertMasterAlertArgs): Promise<MasterAlert> => {
      const res = await fetch("/api/master-alerts", {
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
        | { ok?: boolean; alert?: MasterAlert; error?: string }
        | Record<string, unknown>;
      if (
        !res.ok ||
        !("ok" in body) ||
        !body.ok ||
        !("alert" in body) ||
        !body.alert
      ) {
        const msg =
          (body as { error?: string }).error ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      await _refresh();
      return (body as { alert: MasterAlert }).alert;
    },
    [],
  );

  const remove = React.useCallback(async (ticker: string) => {
    const sym = ticker.trim().toUpperCase();
    const params = new URLSearchParams({ ticker: sym });
    const res = await fetch(`/api/master-alerts?${params.toString()}`, {
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
      const res = await fetch("/api/master-alerts/test", {
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
