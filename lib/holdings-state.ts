/**
 * Persisted client store for the user's imported portfolio.
 *
 * The full CSV is parsed in the browser and stored in `localStorage`
 * under `key-stock-my-portfolio` so it survives page reloads and is
 * kept **entirely on the user's device** — no server persistence, no
 * account, no sync. Users who want the data on another device re-upload
 * the CSV there.
 *
 * Two write paths:
 *
 *   • `setHoldings`   — **replace all** rows. Use when the user wants
 *                       the CSV to be the sole source of truth (e.g.
 *                       switching brokers, deleting bad rows in the
 *                       source app).
 *   • `mergeHoldings` — **add-only**. Uses `fingerprintRow` to skip
 *                       rows that are already stored, so a monthly
 *                       re-export only appends the *new* trades. This
 *                       is the common "I made 3 new trades since last
 *                       time" workflow.
 *
 * Both actions bump the `meta` block so the UI can show when the
 * last import happened and where it came from.
 */

"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { HoldingRow } from "./portfolio-import";
import { fingerprintRow } from "./portfolio-import";

// Bump when the persisted schema changes in a non-backward-compatible way.
const PERSIST_VERSION = 1;

interface ImportMeta {
  /** Original filename the user uploaded (informational only). */
  sourceFilename: string;
  /** ISO timestamp of when the CSV was parsed and stored. */
  importedAt: string;
  /** Total rows persisted — cached for quick display in the header. */
  rowCount: number;
  /**
   * How the last import was applied — `"replace"` overwrites the whole
   * store, `"merge"` adds only new rows. Shown in the imported-metadata
   * bar so the user has a hint about what happened last time.
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

interface HoldingsState {
  rows: HoldingRow[];
  meta: ImportMeta | null;

  /**
   * Replace the currently-stored rows wholesale. Wipes any existing
   * data — appropriate when the CSV is the sole source of truth.
   */
  setHoldings: (rows: HoldingRow[], meta: ImportMeta) => void;

  /**
   * Merge `incoming` into the current rows: any incoming row whose
   * `fingerprintRow(...)` matches a row already in the store is
   * silently skipped, everything else is appended. Returns a small
   * report so the UI can say "added X, skipped Y".
   */
  mergeHoldings: (
    incoming: HoldingRow[],
    baseMeta: Pick<ImportMeta, "sourceFilename" | "importedAt">,
  ) => MergeReport;

  /** Remove all imported data from the store + localStorage. */
  clearHoldings: () => void;
}

export const useHoldings = create<HoldingsState>()(
  persist(
    (set, get) => ({
      rows: [],
      meta: null,
      setHoldings: (rows, meta) => set({
        rows,
        meta: { ...meta, lastMode: "replace", lastAddedCount: 0, lastSkippedCount: 0 },
      }),
      mergeHoldings: (incoming, baseMeta) => {
        const existing = get().rows;
        const seen = new Set<string>();
        for (const r of existing) seen.add(fingerprintRow(r));

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
        const merged = [...existing, ...additions];
        const report: MergeReport = {
          added: additions.length,
          skipped,
          total: merged.length,
        };
        set({
          rows: merged,
          meta: {
            sourceFilename: baseMeta.sourceFilename,
            importedAt: baseMeta.importedAt,
            rowCount: merged.length,
            lastMode: "merge",
            lastAddedCount: additions.length,
            lastSkippedCount: skipped,
          },
        });
        return report;
      },
      clearHoldings: () => set({ rows: [], meta: null }),
    }),
    {
      name: "key-stock-my-portfolio",
      version: PERSIST_VERSION,
    },
  ),
);

/** Selector hook: true once the store has data (avoids flicker on hydrate). */
export const useHasHoldings = () =>
  useHoldings((s) => s.rows.length > 0 && s.meta !== null);
