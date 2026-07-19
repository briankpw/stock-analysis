/**
 * Client store for the user's imported portfolio.
 *
 * As of v7 the data lives on the server (SQLite via `/api/holdings`)
 * so a CSV uploaded on the desktop is visible on the phone without a
 * re-upload. The Zustand store here is a *client-side cache* of the
 * server state — every mutation writes through to the server via
 * `PUT /api/holdings`, and the initial mount hydrates via `GET`.
 *
 * Two write paths, preserved from the pre-sync API so existing
 * consumers keep working:
 *
 *   • `setHoldings`   — **replace all** rows. Server-side wipes the
 *                       `holdings` table + writes the incoming batch
 *                       in one transaction.
 *   • `mergeHoldings` — **add-only**. Server-side `INSERT OR IGNORE`
 *                       keyed by fingerprint, so already-present rows
 *                       are silently skipped. Returns `{added, skipped,
 *                       total}` for the toast — awaitable because the
 *                       server counts changes as it inserts.
 *
 * Hydration lifecycle:
 *
 *   1. Store starts with `rows: [], meta: null, hydrated: false`.
 *   2. `useHydrateHoldings()` (a hook consumers mount once on the page)
 *      GETs `/api/holdings`.
 *   3. Legacy-migration step — if the server response is empty AND
 *      the browser still holds a `key-stock-my-portfolio` localStorage
 *      blob from before this migration, we upload that blob first,
 *      then clear it. This means users upgrading from the offline-only
 *      version get their data synced up automatically without a manual
 *      re-upload.
 *   4. `hydrated` flips to true. Consumers can start rendering.
 *
 * Optimistic updates: every write mutates local state immediately for
 * snappy UI, then fires the server PUT. On PUT failure we roll back
 * to the pre-mutation snapshot and surface `error` for the UI to
 * toast about.
 */

"use client";

import * as React from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { HoldingRow } from "./portfolio-import";
import { fingerprintRow, isForexSymbol } from "./portfolio-import";

// ---------------------------------------------------------------------------
// Types — mirror the server-side shapes in `lib/holdings-store.ts`
// ---------------------------------------------------------------------------

interface ImportMeta {
  /** Original filename the user uploaded (informational only). */
  sourceFilename: string;
  /** ISO timestamp of when the CSV was parsed and uploaded. */
  importedAt: string;
  /** Total rows persisted server-side — cached for quick display. */
  rowCount: number;
  /**
   * How the last import was applied — `"replace"` overwrote the whole
   * table, `"merge"` added only new rows. Shown in the imported-
   * metadata bar so the user has a hint about what happened last time.
   */
  lastMode?: "replace" | "merge";
  /** Only meaningful when `lastMode === "merge"`. Zero for replaces. */
  lastAddedCount?: number;
  /** Only meaningful when `lastMode === "merge"`. Zero for replaces. */
  lastSkippedCount?: number;
}

/** Return value from `mergeHoldings` — lets the caller pop a toast. */
export interface MergeReport {
  added: number;
  skipped: number;
  total: number;
}

interface ServerSnapshot {
  rows: HoldingRow[];
  meta: {
    sourceFilename: string;
    importedAt: string;
    rowCount: number;
    lastMode: "replace" | "merge" | null;
    lastAddedCount: number | null;
    lastSkippedCount: number | null;
    updatedAt: string;
  } | null;
}

interface BaseMeta {
  sourceFilename: string;
  importedAt: string;
}

interface HoldingsState {
  rows: HoldingRow[];
  meta: ImportMeta | null;

  /**
   * True once the client has completed its first `GET /api/holdings`.
   * Consumers should render a loading placeholder while `hydrated` is
   * false — otherwise a device with a slow server would flash "empty
   * portfolio" for a beat and then suddenly fill in the rows.
   */
  hydrated: boolean;

  /**
   * Last sync error, if any. Cleared automatically on the next
   * successful mutation or hydration. Consumers can subscribe and
   * render a toast when it flips non-null.
   */
  syncError: string | null;

  /** Replace the currently-stored rows wholesale (server-side + local). */
  setHoldings: (rows: HoldingRow[], meta: ImportMeta) => Promise<void>;

  /**
   * Merge `incoming` into the current rows: any incoming row whose
   * fingerprint matches a row already stored is silently skipped,
   * everything else is appended. Returns a small report so the UI
   * can say "added X, skipped Y".
   */
  mergeHoldings: (
    incoming: HoldingRow[],
    baseMeta: BaseMeta,
  ) => Promise<MergeReport>;

  /** Remove all imported data — server + local. */
  clearHoldings: () => Promise<void>;

  /**
   * Called by `useHydrateHoldings()` on first mount. Idempotent — a
   * subsequent call while `hydrated` is already true is a no-op so
   * consumers can safely re-mount the hook.
   */
  hydrateFromServer: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Legacy localStorage key — read once during migration then removed.
// ---------------------------------------------------------------------------

const LEGACY_LOCALSTORAGE_KEY = "key-stock-my-portfolio";

/**
 * Read the pre-v7 localStorage-persisted portfolio if the browser
 * still has it. Returns null on any parse error or when the store is
 * empty — legacy data with corrupt shape is discarded silently
 * rather than blocking the user's upgrade path.
 */
function readLegacyLocalStorage(): { rows: HoldingRow[]; meta: ImportMeta } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_LOCALSTORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      state?: { rows?: HoldingRow[]; meta?: ImportMeta | null };
    };
    const rows = parsed?.state?.rows;
    const meta = parsed?.state?.meta;
    if (!Array.isArray(rows) || rows.length === 0 || !meta) return null;
    return { rows, meta };
  } catch {
    return null;
  }
}

function clearLegacyLocalStorage(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY);
  } catch {
    // Non-fatal — even if removal fails the server data is now the
    // source of truth. Next hydration will just skip the legacy path.
  }
}

// ---------------------------------------------------------------------------
// Server helpers — thin fetch wrappers with typed responses.
// ---------------------------------------------------------------------------

function metaFromSnapshot(meta: ServerSnapshot["meta"]): ImportMeta | null {
  if (!meta) return null;
  return {
    sourceFilename: meta.sourceFilename,
    importedAt: meta.importedAt,
    rowCount: meta.rowCount,
    ...(meta.lastMode ? { lastMode: meta.lastMode } : {}),
    ...(meta.lastAddedCount !== null && meta.lastAddedCount !== undefined
      ? { lastAddedCount: meta.lastAddedCount }
      : {}),
    ...(meta.lastSkippedCount !== null && meta.lastSkippedCount !== undefined
      ? { lastSkippedCount: meta.lastSkippedCount }
      : {}),
  };
}

async function apiGet(): Promise<ServerSnapshot> {
  const res = await fetch("/api/holdings", { cache: "no-store" });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as ServerSnapshot;
}

async function apiPut(payload: {
  action: "replace" | "merge";
  rows: HoldingRow[];
  meta: BaseMeta;
}): Promise<{ snapshot: ServerSnapshot; report?: MergeReport }> {
  const res = await fetch("/api/holdings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as { snapshot: ServerSnapshot; report?: MergeReport };
}

async function apiDelete(): Promise<void> {
  const res = await fetch("/api/holdings", { method: "DELETE" });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
}

// ---------------------------------------------------------------------------
// Zustand store — no `persist` middleware; server is the source of truth.
// ---------------------------------------------------------------------------

export const useHoldings = create<HoldingsState>()((set, get) => ({
  rows: [],
  meta: null,
  hydrated: false,
  syncError: null,

  setHoldings: async (rows, meta) => {
    // Snapshot for rollback on server failure. React updates run
    // batched, so we capture BEFORE `set()` mutates.
    const prev = { rows: get().rows, meta: get().meta };
    set({
      rows,
      meta: { ...meta, lastMode: "replace", lastAddedCount: 0, lastSkippedCount: 0 },
      syncError: null,
    });
    try {
      const { snapshot } = await apiPut({
        action: "replace",
        rows,
        meta: {
          sourceFilename: meta.sourceFilename,
          importedAt: meta.importedAt,
        },
      });
      // Adopt the server's canonical result (identical to what we
      // sent, but keeps our local view exactly in sync with the DB
      // in case a concurrent write from another device raced us).
      set({ rows: snapshot.rows, meta: metaFromSnapshot(snapshot.meta) });
    } catch (e) {
      set({
        rows: prev.rows,
        meta: prev.meta,
        syncError: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  },

  mergeHoldings: async (incoming, baseMeta) => {
    // Optimistic local merge — compute the dedup locally so the UI
    // doesn't wait for the server round-trip to show the new rows.
    const prev = { rows: get().rows, meta: get().meta };
    const seen = new Set<string>();
    for (const r of prev.rows) seen.add(fingerprintRow(r));
    const additions: HoldingRow[] = [];
    let skipped = 0;
    for (const r of incoming) {
      const fp = fingerprintRow(r);
      if (seen.has(fp)) {
        skipped++;
        continue;
      }
      seen.add(fp);
      additions.push(r);
    }
    const optimisticRows = [...prev.rows, ...additions];
    const optimisticReport: MergeReport = {
      added: additions.length,
      skipped,
      total: optimisticRows.length,
    };
    set({
      rows: optimisticRows,
      meta: {
        sourceFilename: baseMeta.sourceFilename,
        importedAt: baseMeta.importedAt,
        rowCount: optimisticRows.length,
        lastMode: "merge",
        lastAddedCount: additions.length,
        lastSkippedCount: skipped,
      },
      syncError: null,
    });
    try {
      const { snapshot, report } = await apiPut({
        action: "merge",
        rows: incoming,
        meta: baseMeta,
      });
      set({ rows: snapshot.rows, meta: metaFromSnapshot(snapshot.meta) });
      // Prefer the server's report because it accounts for rows that
      // *another device* uploaded between our optimistic dedup and
      // our PUT. Falls back to local if the server omitted it.
      return report ?? optimisticReport;
    } catch (e) {
      set({
        rows: prev.rows,
        meta: prev.meta,
        syncError: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  },

  clearHoldings: async () => {
    const prev = { rows: get().rows, meta: get().meta };
    set({ rows: [], meta: null, syncError: null });
    try {
      await apiDelete();
    } catch (e) {
      set({
        rows: prev.rows,
        meta: prev.meta,
        syncError: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  },

  hydrateFromServer: async () => {
    if (get().hydrated) return;
    try {
      const snapshot = await apiGet();
      // ---- Legacy migration ------------------------------------------
      // If the server has nothing but the browser still holds a
      // pre-v7 offline blob, upload it exactly once, then wipe the
      // legacy entry. This is what makes upgrading users' data
      // "just appear" on their other devices — no manual re-upload.
      if (snapshot.rows.length === 0) {
        const legacy = readLegacyLocalStorage();
        if (legacy) {
          try {
            const { snapshot: uploaded } = await apiPut({
              action: "replace",
              rows: legacy.rows,
              meta: {
                sourceFilename: legacy.meta.sourceFilename,
                importedAt: legacy.meta.importedAt,
              },
            });
            clearLegacyLocalStorage();
            set({
              rows: uploaded.rows,
              meta: metaFromSnapshot(uploaded.meta),
              hydrated: true,
              syncError: null,
            });
            return;
          } catch {
            // Legacy upload failed — leave the local blob alone so
            // the next hydration can retry, and fall through to the
            // (empty) server state.
          }
        }
      }
      set({
        rows: snapshot.rows,
        meta: metaFromSnapshot(snapshot.meta),
        hydrated: true,
        syncError: null,
      });
    } catch (e) {
      // Hydration failure leaves the store empty + `hydrated=false`
      // so consumers keep showing the loading state instead of
      // silently flipping to "you have no portfolio". `syncError`
      // gives them a way to surface the failure.
      set({
        syncError: e instanceof Error ? e.message : String(e),
      });
    }
  },
}));

// ---------------------------------------------------------------------------
// Convenience hooks
// ---------------------------------------------------------------------------

/**
 * Selector hook: true once the store has data (avoids flicker on
 * hydrate). Consumers wanting to distinguish "still loading" from
 * "hydrated but empty" should use `useHoldings((s) => s.hydrated)`
 * instead.
 */
export const useHasHoldings = () =>
  useHoldings((s) => s.rows.length > 0 && s.meta !== null);

/**
 * Fires the initial `GET /api/holdings` exactly once for the whole
 * app session — mount from the top of any page that reads holdings
 * data, or from the app shell if you'd rather warm the cache
 * regardless of route.
 *
 * Safe to mount multiple times; internal `hydrated` flag makes
 * repeated calls a no-op.
 */
export function useHydrateHoldings(): void {
  const hydrateFromServer = useHoldings((s) => s.hydrateFromServer);
  const hydrated = useHoldings((s) => s.hydrated);
  React.useEffect(() => {
    if (hydrated) return;
    void hydrateFromServer();
  }, [hydrated, hydrateFromServer]);
}

// ---------------------------------------------------------------------------
// UI preferences for the my-portfolio view — persisted per browser
// ---------------------------------------------------------------------------
//
// Kept separate from the main `useHoldings` store because these are
// *display preferences* (not data), and separating them makes it easy
// to migrate/version each concern independently. Persisted so a user's
// "hide forex" choice sticks across reloads.

interface HoldingsPrefsState {
  /**
   * Whether Yahoo `=X` forex pairs are hidden from the positions +
   * transactions views. Default `true` — forex has no cost basis /
   * dividends / risk story in the equity model, and users rarely
   * want it mixed into "how much am I making today". Toggling this
   * off restores every hidden row *without* re-uploading the CSV.
   */
  hideForex: boolean;
  setHideForex: (v: boolean) => void;
  toggleHideForex: () => void;
}

export const useHoldingsPrefs = create<HoldingsPrefsState>()(
  persist(
    (set) => ({
      hideForex: true,
      setHideForex: (v) => set({ hideForex: v }),
      toggleHideForex: () => set((s) => ({ hideForex: !s.hideForex })),
    }),
    { name: "key-stock-holdings-prefs", version: 1 },
  ),
);

/**
 * Filtered view over the raw holdings store, plus stats about what was
 * hidden. Consumers should prefer this to `useHoldings((s) => s.rows)`
 * unless they specifically need every row (e.g. the uploader, which
 * has to dedupe against the *full* set — hidden or not — to avoid
 * re-inserting forex that the user's preference is currently hiding).
 */
export interface HoldingsView {
  /** Rows that should appear in the UI given the current preferences. */
  rows: HoldingRow[];
  /** Number of forex rows in the underlying store — always counted,
   *  even when `hideForex` is false, so the UI can render an accurate
   *  "N forex rows shown/hidden" chip regardless of toggle state. */
  forexRowCount: number;
  /** Distinct forex symbols in the underlying store, e.g.
   *  `["EURUSD=X", "USDJPY=X"]`. Handy for tooltips. */
  forexSymbols: string[];
  /** Total rows in the underlying store, before any filtering. */
  totalRowCount: number;
  /** Current setting — mirrors `useHoldingsPrefs.hideForex` for
   *  consumer convenience so they don't have to subscribe twice. */
  hideForex: boolean;
}

export function useHoldingsView(): HoldingsView {
  const rows = useHoldings((s) => s.rows);
  const hideForex = useHoldingsPrefs((s) => s.hideForex);
  return React.useMemo(() => {
    const kept: HoldingRow[] = [];
    const forexSymbolSet = new Set<string>();
    let forexRowCount = 0;
    for (const r of rows) {
      if (isForexSymbol(r.symbol)) {
        forexSymbolSet.add(r.symbol);
        forexRowCount++;
        // When the preference is OFF (show forex), we still count
        // them above for the chip, but keep them in the visible set.
        if (!hideForex) kept.push(r);
      } else {
        kept.push(r);
      }
    }
    return {
      rows: kept,
      forexRowCount,
      forexSymbols: [...forexSymbolSet].sort(),
      totalRowCount: rows.length,
      hideForex,
    };
  }, [rows, hideForex]);
}
