/**
 * Server-side storage for the user's imported portfolio.
 *
 * Historically this data lived in the browser's localStorage only —
 * uploading a CSV on one device meant the phone showed an empty
 * portfolio because there was nothing on the server. Since v7 the
 * server owns the data and every device syncs via `/api/holdings`.
 *
 * The persisted schema (defined in `lib/db.ts:MIGRATIONS[6]`):
 *
 *   `holdings`      — one row per unique trade (PK is `fingerprint`).
 *   `holdings_meta` — one-row table with import metadata (filename,
 *                     imported-at, last mode, added/skipped counts).
 *
 * `fingerprint` mirrors `fingerprintRow()` from `lib/portfolio-import.ts`
 * — the caller must compute it before writing so the client and server
 * agree on identity. We deliberately don't recompute it here: the
 * client already has to fingerprint for its own dedup, and duplicating
 * the algorithm on the server would double the maintenance surface
 * every time we change what counts as "the same trade".
 *
 * This module is pure server-side (uses `better-sqlite3` via `getDb`)
 * so it must not be imported from any file that runs in the browser
 * bundle. The API layer at `app/api/holdings/route.ts` is the sole
 * consumer.
 */

import { getDb } from "./db";
import type { HoldingRow } from "./portfolio-import";
import { fingerprintRow } from "./portfolio-import";

// ---------------------------------------------------------------------------
// Types (mirrored on the client)
// ---------------------------------------------------------------------------

export interface HoldingsMeta {
  sourceFilename: string;
  importedAt: string;
  rowCount: number;
  lastMode: "replace" | "merge" | null;
  lastAddedCount: number | null;
  lastSkippedCount: number | null;
  updatedAt: string;
}

export interface HoldingsSnapshot {
  rows: HoldingRow[];
  meta: HoldingsMeta | null;
}

/** Return value from `mergeHoldings` — matches the old client-side shape. */
export interface MergeReport {
  added: number;
  skipped: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Load the full portfolio + meta as a single snapshot.
 *
 * Rows are returned in insertion order (oldest first, matching the
 * CSV row order the user uploaded). The existing UI sorts / filters
 * client-side so we don't impose any other ordering here.
 */
export function listHoldingsSnapshot(): HoldingsSnapshot {
  const db = getDb();
  const rows = db
    .prepare("SELECT row_json FROM holdings ORDER BY created_at ASC, fingerprint ASC")
    .all() as Array<{ row_json: string }>;
  const parsed: HoldingRow[] = [];
  for (const r of rows) {
    try {
      parsed.push(JSON.parse(r.row_json) as HoldingRow);
    } catch {
      // A row that fails to deserialise means the JSON blob on disk
      // is corrupt (only reachable via manual DB tampering — the
      // API layer round-trips through Zod). Skip silently: dropping
      // one bad row is better than blanking the whole portfolio.
      continue;
    }
  }
  return { rows: parsed, meta: getHoldingsMeta() };
}

export function getHoldingsMeta(): HoldingsMeta | null {
  const row = getDb()
    .prepare(
      `SELECT source_filename, imported_at, row_count, last_mode,
              last_added_count, last_skipped_count, updated_at
         FROM holdings_meta WHERE id = 1`,
    )
    .get() as
    | {
        source_filename: string;
        imported_at: string;
        row_count: number;
        last_mode: string | null;
        last_added_count: number | null;
        last_skipped_count: number | null;
        updated_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    sourceFilename: row.source_filename,
    importedAt: row.imported_at,
    rowCount: row.row_count,
    lastMode:
      row.last_mode === "replace" || row.last_mode === "merge"
        ? row.last_mode
        : null,
    lastAddedCount: row.last_added_count,
    lastSkippedCount: row.last_skipped_count,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Write — always inside a single transaction so a partial failure
// can't leave the DB with rows that don't match the meta blob.
// ---------------------------------------------------------------------------

interface BaseMeta {
  sourceFilename: string;
  importedAt: string;
}

/**
 * Wholesale replace: delete every existing row + upsert the whole
 * incoming batch. Use for "the CSV is the sole source of truth" — the
 * user is telling us to forget what we had. Meta records `last_mode`
 * as "replace".
 */
export function replaceHoldings(
  rows: HoldingRow[],
  meta: BaseMeta,
): HoldingsSnapshot {
  const now = new Date().toISOString();
  const db = getDb();
  const insertRow = db.prepare(
    "INSERT INTO holdings (fingerprint, row_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
  );
  const upsertMeta = db.prepare(
    `INSERT INTO holdings_meta (
       id, source_filename, imported_at, row_count,
       last_mode, last_added_count, last_skipped_count, updated_at
     ) VALUES (1, ?, ?, ?, 'replace', 0, 0, ?)
     ON CONFLICT(id) DO UPDATE SET
       source_filename = excluded.source_filename,
       imported_at     = excluded.imported_at,
       row_count       = excluded.row_count,
       last_mode       = 'replace',
       last_added_count = 0,
       last_skipped_count = 0,
       updated_at      = excluded.updated_at`,
  );
  db.transaction(() => {
    db.prepare("DELETE FROM holdings").run();
    for (const row of rows) {
      insertRow.run(fingerprintRow(row), JSON.stringify(row), now, now);
    }
    upsertMeta.run(meta.sourceFilename, meta.importedAt, rows.length, now);
  })();
  return listHoldingsSnapshot();
}

/**
 * Additive merge: `INSERT OR IGNORE` every incoming row keyed by
 * fingerprint, so rows already present are skipped without an error.
 * Returns the count of rows actually added — the API surface matches
 * what the client's old localStorage-only path returned.
 *
 * `baseMeta` supplies the *incoming* upload's filename + timestamp;
 * we store the incoming values so the meta bar shows "last uploaded
 * FILE at TS" rather than sticking on the initial import.
 */
export function mergeHoldings(
  incoming: HoldingRow[],
  baseMeta: BaseMeta,
): { snapshot: HoldingsSnapshot; report: MergeReport } {
  const now = new Date().toISOString();
  const db = getDb();
  // INSERT OR IGNORE — the fingerprint PK collision is our dedup
  // signal. `changes()` after each `.run()` returns 1 for actual
  // inserts and 0 for skipped duplicates, which is how we compute
  // added vs. skipped without a pre-select round-trip.
  const insertRow = db.prepare(
    "INSERT OR IGNORE INTO holdings (fingerprint, row_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
  );
  const upsertMeta = db.prepare(
    `INSERT INTO holdings_meta (
       id, source_filename, imported_at, row_count,
       last_mode, last_added_count, last_skipped_count, updated_at
     ) VALUES (1, ?, ?, ?, 'merge', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       source_filename    = excluded.source_filename,
       imported_at        = excluded.imported_at,
       row_count          = excluded.row_count,
       last_mode          = 'merge',
       last_added_count   = excluded.last_added_count,
       last_skipped_count = excluded.last_skipped_count,
       updated_at         = excluded.updated_at`,
  );
  const countStmt = db.prepare("SELECT COUNT(*) AS n FROM holdings");
  const report = db.transaction((): MergeReport => {
    let added = 0;
    for (const row of incoming) {
      const info = insertRow.run(
        fingerprintRow(row),
        JSON.stringify(row),
        now,
        now,
      );
      if (info.changes > 0) added += 1;
    }
    const skipped = incoming.length - added;
    const total = (countStmt.get() as { n: number }).n;
    upsertMeta.run(
      baseMeta.sourceFilename,
      baseMeta.importedAt,
      total,
      added,
      skipped,
      now,
    );
    return { added, skipped, total };
  })();
  return { snapshot: listHoldingsSnapshot(), report };
}

/**
 * Wipe everything — both tables. Used by the meta-bar's "Clear" button.
 * Same-transaction so we can't end up with meta pointing at rows that
 * don't exist.
 */
export function clearHoldings(): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM holdings").run();
    db.prepare("DELETE FROM holdings_meta WHERE id = 1").run();
  })();
}
