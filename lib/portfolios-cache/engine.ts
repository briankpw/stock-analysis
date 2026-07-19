/**
 * Background refresh engine for the Portfolios snapshot cache.
 *
 * Runs once per bot worker loop cycle. Walks every row in
 * `portfolio_snapshots` whose `next_refresh_at` has expired and
 * triggers an upstream refresh through the coordinator (so the
 * result is stored + the same dedup pool is used as the user-facing
 * requests).
 *
 * Scoped to *visited* rows only: a preset that appears in the
 * built-in catalogue but that no user has ever opened doesn't get
 * pre-fetched. That keeps our SEC EDGAR / House Clerk footprint
 * proportional to actual usage (per the user's stated preference)
 * — with 100+ built-in presets we'd otherwise be running a large
 * cold pipeline for no benefit.
 *
 * Concurrency is capped low (2) because:
 *   - the House Clerk PTR pipeline is PDF-heavy and single-threaded
 *     work inside pdfjs, so more parallelism just contends;
 *   - the SEC recommends staying well under their 10 req/sec ceiling,
 *     and each report fans out into ~30 sub-requests already.
 *
 * The tick is protected by `tryLockTick("portfolio-snapshots")` so
 * two overlapping schedules (e.g. worker restart during a slow
 * refresh) can't stack up.
 */

import { tryLockTick } from "../bot/store";
import { mapConcurrent } from "../utils";
import {
  DataSourceUnavailableError,
  refreshSnapshot,
} from "./coordinator";
import { dueForRefresh } from "./store";

/**
 * How many snapshots we're willing to refresh in a single tick.
 * The worker loops every ~60 seconds by default, and each
 * politician refresh can take 10+ seconds (dozen PDFs to parse),
 * so keeping the batch small lets us start the next kind's tick
 * quickly rather than blocking the whole loop.
 */
const BATCH_LIMIT = 8;

/**
 * How many refreshes run in parallel per batch. See file header
 * for the reasoning behind "2".
 */
const BATCH_CONCURRENCY = 2;

export interface PortfolioSnapshotTickResult {
  ranAt: string;
  /** Rows with `next_refresh_at <= now` at the start of this tick. */
  dueCount: number;
  /** Rows we actually attempted to refresh (capped by BATCH_LIMIT). */
  attempted: number;
  refreshed: number;
  /** Rows that failed with a `DataSourceUnavailableError`. */
  upstreamUnavailable: number;
  /** Any other refresh errors. */
  errors: string[];
  /** True when another tick was already running and we skipped this one. */
  skipped: boolean;
}

const EMPTY_SKIPPED: PortfolioSnapshotTickResult = {
  ranAt: "",
  dueCount: 0,
  attempted: 0,
  refreshed: 0,
  upstreamUnavailable: 0,
  errors: [],
  skipped: true,
};

export async function runPortfolioSnapshotTick(): Promise<PortfolioSnapshotTickResult> {
  const release = tryLockTick("portfolio-snapshots");
  if (!release) return { ...EMPTY_SKIPPED, ranAt: new Date().toISOString() };

  try {
    const ranAt = new Date().toISOString();
    // Only rows the user has actually visited at least once. See
    // the file header for why we skip the never-touched catalogue.
    const due = dueForRefresh({ onlyVisited: true, limit: BATCH_LIMIT });
    if (due.length === 0) {
      return {
        ranAt,
        dueCount: 0,
        attempted: 0,
        refreshed: 0,
        upstreamUnavailable: 0,
        errors: [],
        skipped: false,
      };
    }

    let refreshed = 0;
    let upstreamUnavailable = 0;
    const errors: string[] = [];

    await mapConcurrent(due, BATCH_CONCURRENCY, async ({ kind, id }) => {
      try {
        const payload = await refreshSnapshot(kind, id);
        if (payload !== null) {
          refreshed++;
        }
      } catch (err) {
        // `refreshSnapshot({throwOnCold: false})` (the default we
        // use here) already records the error to SQLite and
        // suppresses the rejection — so most failures land here
        // never. This catch is defensive against genuinely
        // unexpected throws (programmer error, DB write failure,
        // …).
        if (err instanceof DataSourceUnavailableError) {
          upstreamUnavailable++;
        } else {
          errors.push(
            `${kind}/${id}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200),
          );
        }
      }
    });

    return {
      ranAt,
      dueCount: due.length,
      attempted: due.length,
      refreshed,
      upstreamUnavailable,
      errors,
      skipped: false,
    };
  } finally {
    release();
  }
}
