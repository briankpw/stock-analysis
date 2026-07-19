"use client";

/**
 * Client hook for per-market-segment 6-Signal Resonance alerts.
 *
 * Structural mirror of `use-resonance-alerts.ts` — same module-
 * scoped cache + subscriber-set pattern so every alert control
 * across the app stays in sync without a page reload. The only
 * difference is the primary key: `segmentId` (a `SEGMENTS[]` slug)
 * rather than `ticker`.
 */

import * as React from "react";
import type {
  SectorResonanceAlertStrength,
  SectorResonanceAlert,
} from "@/lib/sector-resonance-watch/store";

type Listener = () => void;

const _listeners = new Set<Listener>();
let _entries: SectorResonanceAlert[] | null = null;
let _error: string | null = null;
let _inflight: Promise<SectorResonanceAlert[]> | null = null;

function _notify() {
  _listeners.forEach((l) => l());
}

async function _fetchOnce(): Promise<SectorResonanceAlert[]> {
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const res = await fetch("/api/sector-resonance-alerts", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { alerts: SectorResonanceAlert[] };
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

export interface UpsertSectorResonanceAlertArgs {
  segmentId: string;
  dailyTime?: string | null;
  timezone?: string;
  notifyOnChange?: boolean;
  minStrength?: SectorResonanceAlertStrength;
}

export interface UseSectorResonanceAlerts {
  alerts: SectorResonanceAlert[];
  loading: boolean;
  error: string | null;
  find: (segmentId: string) => SectorResonanceAlert | undefined;
  upsert: (
    args: UpsertSectorResonanceAlertArgs,
  ) => Promise<SectorResonanceAlert>;
  remove: (segmentId: string) => Promise<void>;
  test: (segmentId: string) => Promise<{ ok: boolean; detail?: string }>;
  refresh: () => Promise<void>;
}

export function useSectorResonanceAlerts(): UseSectorResonanceAlerts {
  const [entries, setEntries] = React.useState<SectorResonanceAlert[] | null>(
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
      args: UpsertSectorResonanceAlertArgs,
    ): Promise<SectorResonanceAlert> => {
      const res = await fetch("/api/sector-resonance-alerts", {
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
        | { ok?: boolean; alert?: SectorResonanceAlert; error?: string }
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
      return (body as { alert: SectorResonanceAlert }).alert;
    },
    [],
  );

  const remove = React.useCallback(async (segmentId: string) => {
    const slug = String(segmentId).trim().toLowerCase();
    const params = new URLSearchParams({ segmentId: slug });
    const res = await fetch(
      `/api/sector-resonance-alerts?${params.toString()}`,
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
      const res = await fetch("/api/sector-resonance-alerts/test", {
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
