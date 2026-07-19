"use client";

/**
 * Client hook for per-market-segment Technical Signal alerts.
 *
 * Structural mirror of `use-sector-resonance-alerts.ts` — same module-
 * scoped cache + subscriber-set pattern so every alert control
 * across the app stays in sync without a page reload. The only
 * difference is which backend table it hits (`sector_technical_alerts`
 * vs `sector_resonance_alerts`).
 */

import * as React from "react";
import type {
  SectorTechnicalAlertStrength,
  SectorTechnicalAlert,
} from "@/lib/sector-technical-watch/store";

type Listener = () => void;

const _listeners = new Set<Listener>();
let _entries: SectorTechnicalAlert[] | null = null;
let _error: string | null = null;
let _inflight: Promise<SectorTechnicalAlert[]> | null = null;

function _notify() {
  _listeners.forEach((l) => l());
}

async function _fetchOnce(): Promise<SectorTechnicalAlert[]> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await fetch("/api/sector-technical-alerts", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { alerts: SectorTechnicalAlert[] };
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

export interface UpsertSectorTechnicalAlertArgs {
  segmentId: string;
  dailyTime?: string | null;
  timezone?: string;
  notifyOnChange?: boolean;
  minStrength?: SectorTechnicalAlertStrength;
}

export interface UseSectorTechnicalAlerts {
  alerts: SectorTechnicalAlert[];
  loading: boolean;
  error: string | null;
  find: (segmentId: string) => SectorTechnicalAlert | undefined;
  upsert: (
    args: UpsertSectorTechnicalAlertArgs,
  ) => Promise<SectorTechnicalAlert>;
  remove: (segmentId: string) => Promise<void>;
  test: (segmentId: string) => Promise<{ ok: boolean; detail?: string }>;
  refresh: () => Promise<void>;
}

export function useSectorTechnicalAlerts(): UseSectorTechnicalAlerts {
  const [entries, setEntries] = React.useState<SectorTechnicalAlert[] | null>(
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
    (segmentId: string) => {
      const slug = String(segmentId).trim().toLowerCase();
      return (entries ?? []).find((a) => a.segmentId === slug);
    },
    [entries],
  );

  const upsert = React.useCallback(
    async (
      args: UpsertSectorTechnicalAlertArgs,
    ): Promise<SectorTechnicalAlert> => {
      const res = await fetch("/api/sector-technical-alerts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          segmentId: String(args.segmentId).trim().toLowerCase(),
          dailyTime: args.dailyTime,
          timezone: args.timezone,
          notifyOnChange: args.notifyOnChange,
          minStrength: args.minStrength,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as
        | { ok?: boolean; alert?: SectorTechnicalAlert; error?: string }
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
      return (body as { alert: SectorTechnicalAlert }).alert;
    },
    [],
  );

  const remove = React.useCallback(async (segmentId: string) => {
    const slug = String(segmentId).trim().toLowerCase();
    const params = new URLSearchParams({ segmentId: slug });
    const res = await fetch(
      `/api/sector-technical-alerts?${params.toString()}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(b?.error ?? `HTTP ${res.status}`);
    }
    await _refresh();
  }, []);

  const test = React.useCallback(
    async (
      segmentId: string,
    ): Promise<{ ok: boolean; detail?: string }> => {
      const res = await fetch("/api/sector-technical-alerts/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          segmentId: String(segmentId).trim().toLowerCase(),
        }),
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
