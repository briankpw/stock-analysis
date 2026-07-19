/**
 * SQLite persistence for the Portfolios page snapshot cache.
 *
 * Every politician / fund / insider report the user opens is
 * upserted here as a JSON blob so the next visit — even after a
 * server restart, a Docker redeploy, or a browser hop from
 * desktop to phone — reads instantly instead of triggering a fresh
 * SEC EDGAR / House Clerk pipeline.
 *
 * The store is intentionally low-level: no fetching, no
 * scheduling, no serialization decisions beyond `JSON.stringify`.
 * The `coordinator.ts` layer on top decides *when* to refresh and
 * how long to keep a payload fresh; the `engine.ts` next to it
 * runs the periodic background refresh. Keeping those concerns in
 * separate files means the store is trivially reusable if we ever
 * add more report kinds.
 *
 * See migration v9 in `lib/db.ts` for the underlying schema.
 */

import { getDb } from "../db";

/**
 * Which "kind" of Portfolios entity a snapshot belongs to.
 * Matches the `preset_kind` CHECK constraint on the table.
 *
 *   politician — House Clerk PTR filings + parsed trades
 *   person     — SEC Form 3/4/5 insider filings for one individual
 *   fund       — SEC 13F-HR institutional holdings for one manager
 */
export type PortfolioSnapshotKind = "politician" | "person" | "fund";

export interface PortfolioSnapshotRecord<T = unknown> {
  kind: PortfolioSnapshotKind;
  id: string;
  /** Deserialized payload — parsed from `payload_json` on read. */
  payload: T;
  /** ISO timestamp of the last successful upstream fetch. */
  fetchedAt: string;
  /**
   * ISO timestamp — earliest time the bot worker (or coordinator's
   * stale-while-revalidate path) should try to refresh this row.
   */
  nextRefreshAt: string;
  /** Last refresh error message, or null when the row is healthy. */
  lastError: string | null;
  /** ISO timestamp of `lastError`, or null. */
  lastErrorAt: string | null;
  /**
   * How many times the user has fetched this snapshot via the API.
   * The background worker uses this to prioritize *visited* rows
   * over ones that were only ever populated defensively.
   */
  visitCount: number;
  /** ISO timestamp of the most recent read from the coordinator. */
  lastVisitedAt: string | null;
}

// ---------------------------------------------------------------------------
// Row shape as stored in SQLite. Kept private so downstream code deals only
// with the parsed `PortfolioSnapshotRecord`.
// ---------------------------------------------------------------------------
interface RawRow {
  preset_kind: PortfolioSnapshotKind;
  preset_id: string;
  payload_json: string;
  fetched_at: string;
  next_refresh_at: string;
  last_error: string | null;
  last_error_at: string | null;
  visit_count: number;
  last_visited_at: string | null;
}

function hydrate<T>(row: RawRow): PortfolioSnapshotRecord<T> {
  // JSON parsing is where corruption from prior migrations or a
  // half-flushed write would surface. Swallow the error and bubble
  // up as `null` to the coordinator so it treats the row as absent
  // and repopulates — always better than crashing the whole
  // request.
  const payload = JSON.parse(row.payload_json) as T;
  return {
    kind: row.preset_kind,
    id: row.preset_id,
    payload,
    fetchedAt: row.fetched_at,
    nextRefreshAt: row.next_refresh_at,
    lastError: row.last_error,
    lastErrorAt: row.last_error_at,
    visitCount: row.visit_count,
    lastVisitedAt: row.last_visited_at,
  };
}

/**
 * Read a single snapshot. Returns `null` when there is no row for
 * this key, OR when the stored payload can't be JSON-parsed
 * (implies a corrupt write; the coordinator will treat that as a
 * cache miss and repopulate).
 */
export function readSnapshot<T>(
  kind: PortfolioSnapshotKind,
  id: string,
): PortfolioSnapshotRecord<T> | null {
  const row = getDb()
    .prepare(
      `SELECT preset_kind, preset_id, payload_json, fetched_at, next_refresh_at,
              last_error, last_error_at, visit_count, last_visited_at
       FROM portfolio_snapshots
       WHERE preset_kind = ? AND preset_id = ?`,
    )
    .get(kind, id) as RawRow | undefined;
  if (!row) return null;
  try {
    return hydrate<T>(row);
  } catch {
    return null;
  }
}

/**
 * Persist a successful refresh. Clears any prior error state so a
 * previously-failing row goes green on the next read.
 *
 * `ttlSeconds` is the coordinator-decided freshness window — the
 * next refresh won't run until at least `now + ttlSeconds`. Kept
 * as a parameter (rather than baked into this module) so different
 * report kinds can pick different cadences.
 */
export function writeSnapshot<T>(
  kind: PortfolioSnapshotKind,
  id: string,
  payload: T,
  ttlSeconds: number,
): void {
  const now = new Date();
  const nextRefreshAt = new Date(now.getTime() + ttlSeconds * 1000);
  getDb()
    .prepare(
      `INSERT INTO portfolio_snapshots (
        preset_kind, preset_id, payload_json,
        fetched_at, next_refresh_at,
        last_error, last_error_at,
        visit_count, last_visited_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 0, NULL, ?, ?)
      ON CONFLICT(preset_kind, preset_id) DO UPDATE SET
        payload_json    = excluded.payload_json,
        fetched_at      = excluded.fetched_at,
        next_refresh_at = excluded.next_refresh_at,
        last_error      = NULL,
        last_error_at   = NULL,
        updated_at      = excluded.updated_at`,
    )
    .run(
      kind,
      id,
      JSON.stringify(payload),
      now.toISOString(),
      nextRefreshAt.toISOString(),
      now.toISOString(),
      now.toISOString(),
    );
}

/**
 * Record a refresh failure WITHOUT invalidating the stored
 * payload. The row's `fetched_at` stays put (so the UI still shows
 * "last updated 3h ago"), but `last_error` is populated and
 * `next_refresh_at` is bumped by the caller-supplied backoff so we
 * don't hammer a struggling upstream.
 *
 * If no snapshot exists yet this is a no-op — the coordinator
 * handles cold-fetch failures separately, we don't create an
 * error-only row (nothing sensible to show for it).
 */
export function markSnapshotError(
  kind: PortfolioSnapshotKind,
  id: string,
  message: string,
  backoffSeconds: number,
): void {
  const now = new Date();
  const nextRefreshAt = new Date(now.getTime() + backoffSeconds * 1000);
  getDb()
    .prepare(
      `UPDATE portfolio_snapshots
       SET last_error      = ?,
           last_error_at   = ?,
           next_refresh_at = ?,
           updated_at      = ?
       WHERE preset_kind = ? AND preset_id = ?`,
    )
    .run(message.slice(0, 500), now.toISOString(), nextRefreshAt.toISOString(), now.toISOString(), kind, id);
}

/**
 * Bump the visit counters. Called by the coordinator on every
 * successful read so the background refresh engine can prioritize
 * the "user actually opened this" rows over the (currently empty
 * — but reserved) idea of pre-warming the whole preset catalogue.
 */
export function touchSnapshotVisit(
  kind: PortfolioSnapshotKind,
  id: string,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE portfolio_snapshots
       SET visit_count = visit_count + 1,
           last_visited_at = ?,
           updated_at = ?
       WHERE preset_kind = ? AND preset_id = ?`,
    )
    .run(now, now, kind, id);
}

/**
 * All rows whose `next_refresh_at` is in the past. Sorted so the
 * background worker refreshes the *most-visited* rows first — if
 * we're rate-limited by SEC and only get through half the list in
 * one tick, the user-facing snapshots stay fresh.
 *
 * `onlyVisited` scopes to rows with `visit_count > 0`, matching
 * the user's stated preference of not slamming SEC for presets
 * nobody has opened.
 */
export function dueForRefresh(opts: {
  onlyVisited: boolean;
  limit?: number;
}): Array<{ kind: PortfolioSnapshotKind; id: string; visitCount: number; lastVisitedAt: string | null }> {
  const now = new Date().toISOString();
  const clause = opts.onlyVisited ? "AND visit_count > 0" : "";
  const limit = opts.limit ?? 100;
  const rows = getDb()
    .prepare(
      `SELECT preset_kind, preset_id, visit_count, last_visited_at
       FROM portfolio_snapshots
       WHERE next_refresh_at <= ? ${clause}
       ORDER BY visit_count DESC, last_visited_at DESC
       LIMIT ?`,
    )
    .all(now, limit) as Array<Pick<RawRow, "preset_kind" | "preset_id" | "visit_count" | "last_visited_at">>;
  return rows.map((r) => ({
    kind: r.preset_kind,
    id: r.preset_id,
    visitCount: r.visit_count,
    lastVisitedAt: r.last_visited_at,
  }));
}

/**
 * Diagnostic helper for the /bot page or CLI scripts — walks every
 * snapshot without hydrating payload JSON. Cheaper than
 * `readSnapshot` per-row when you only want counts and freshness.
 */
export function listSnapshotKeys(): Array<{
  kind: PortfolioSnapshotKind;
  id: string;
  fetchedAt: string;
  nextRefreshAt: string;
  lastError: string | null;
  visitCount: number;
  lastVisitedAt: string | null;
}> {
  const rows = getDb()
    .prepare(
      `SELECT preset_kind, preset_id, fetched_at, next_refresh_at,
              last_error, visit_count, last_visited_at
       FROM portfolio_snapshots
       ORDER BY last_visited_at DESC NULLS LAST, fetched_at DESC`,
    )
    .all() as Array<
      Pick<
        RawRow,
        | "preset_kind"
        | "preset_id"
        | "fetched_at"
        | "next_refresh_at"
        | "last_error"
        | "visit_count"
        | "last_visited_at"
      >
    >;
  return rows.map((r) => ({
    kind: r.preset_kind,
    id: r.preset_id,
    fetchedAt: r.fetched_at,
    nextRefreshAt: r.next_refresh_at,
    lastError: r.last_error,
    visitCount: r.visit_count,
    lastVisitedAt: r.last_visited_at,
  }));
}

/**
 * Remove a snapshot. Used when the user deletes a custom preset —
 * we don't want a stale row for a preset that no longer exists on
 * the index page.
 */
export function deleteSnapshot(kind: PortfolioSnapshotKind, id: string): void {
  getDb()
    .prepare(`DELETE FROM portfolio_snapshots WHERE preset_kind = ? AND preset_id = ?`)
    .run(kind, id);
}
