/**
 * Stale-while-revalidate wrapper around the raw Portfolios
 * fetchers in `lib/portfolios.ts`.
 *
 * The API route (`/api/portfolios`) used to call the raw fetchers
 * directly, which meant every process restart, cache eviction, or
 * cold browser triggered a live SEC EDGAR / House Clerk PDF
 * pipeline — 5-30 seconds of user-visible loading spinner.
 *
 * This module fixes that by adding a persistent, per-preset
 * snapshot cache on top:
 *
 *   1.  Look up the SQLite snapshot for `(kind, id)`.
 *   2a. If present, return the payload immediately. If
 *       `next_refresh_at <= now`, ALSO kick off a background
 *       refresh (fire-and-forget) so the next visit gets fresh
 *       data. The current caller does NOT wait.
 *   2b. If absent, do a blocking fetch, upsert the result, and
 *       return it. This is the "first ever visit to this preset"
 *       cold path.
 *   3.  In-flight requests are deduplicated inside this module so
 *       a burst of concurrent visits (React strict-mode double
 *       mount, worker + UI hitting the same key) only fires one
 *       upstream fetch.
 *
 * Failures are handled defensively: a refresh error never nukes
 * the cached payload. The user keeps seeing the last-known-good
 * snapshot with an "as of X" timestamp; the coordinator records
 * the error and pushes the retry horizon out with a short
 * backoff.
 *
 * The `waitForFreshOnCold` parameter controls whether a totally
 * cold call waits for the network. Default `true` — matches the
 * old behavior. The background worker calls with
 * `waitForFreshOnCold: false` since it can happily produce cache
 * misses without a caller waiting.
 */

import {
  DataSourceUnavailableError,
  fetchFund13F,
  fetchPersonInsiderReport,
  fetchPoliticianTrades,
  type FundReport,
  type PersonReport,
  type PoliticianReport,
} from "../portfolios";
import {
  markSnapshotError,
  readSnapshot,
  touchSnapshotVisit,
  writeSnapshot,
  type PortfolioSnapshotKind,
} from "./store";

// ---------------------------------------------------------------------------
// TTL policy
// ---------------------------------------------------------------------------
//
// Politician PTRs are dropped daily but the House Clerk ZIP is
// rebuilt only at intervals — 6h keeps us close to the daily
// cadence without hammering the download.
//
// Insider Form 3/4/5 filings hit EDGAR throughout the trading
// day. 2h refresh is a good compromise between freshness and
// SEC's 10-req/sec ceiling — even 100 tracked people at 2h each
// is well below the ceiling.
//
// 13F filings are quarterly. There's very little value in
// re-fetching more often than once a day (a single manager's
// 13F changes 4 times a year), but 24h keeps things simple and
// still handles the deadline-day rush where new filings drop.

const REFRESH_TTL_SECONDS: Record<PortfolioSnapshotKind, number> = {
  politician: 6 * 60 * 60,
  person: 2 * 60 * 60,
  fund: 24 * 60 * 60,
};

/**
 * Cooldown applied after a failed refresh — deliberately short so
 * a transient 429/5xx doesn't lock a snapshot as stale for hours.
 * Long enough that a hard-down upstream can't be pounded into
 * amplifying the outage.
 */
const REFRESH_ERROR_BACKOFF_SECONDS = 15 * 60;

// ---------------------------------------------------------------------------
// Concurrency dedup
// ---------------------------------------------------------------------------

/**
 * Coalesces in-flight upstream fetches. If the UI request hits
 * the coordinator while the worker's tick is already fetching
 * `(politician, pelosi)`, both callers await the same promise
 * instead of firing two duplicate SEC pipelines.
 */
const _inflight = new Map<string, Promise<unknown>>();

function inflightKey(kind: PortfolioSnapshotKind, id: string): string {
  return `${kind}:${id}`;
}

async function withInflight<T>(
  kind: PortfolioSnapshotKind,
  id: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = inflightKey(kind, id);
  const existing = _inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = fn().finally(() => {
    _inflight.delete(key);
  });
  _inflight.set(key, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// Raw upstream fetch (no caching layer). Each kind wraps its own
// `lib/portfolios.ts` entry point; the coordinator picks the right
// one based on `kind`.
// ---------------------------------------------------------------------------

async function fetchUpstream<T>(
  kind: PortfolioSnapshotKind,
  id: string,
  limit?: number,
): Promise<T> {
  switch (kind) {
    case "politician":
      return (await fetchPoliticianTrades(id, limit ?? 200)) as T;
    case "person":
      return (await fetchPersonInsiderReport(id, limit ?? 30)) as T;
    case "fund":
      return (await fetchFund13F(id)) as T;
  }
}

// ---------------------------------------------------------------------------
// Refresh — runs upstream, upserts on success, records on failure.
// Never throws when there's a stale payload to fall back on.
// ---------------------------------------------------------------------------

/**
 * Runs a fresh upstream fetch for `(kind, id)` and upserts the
 * result. If it fails with a known cache-warming candidate error
 * (`DataSourceUnavailableError`, rate-limit, generic network) we
 * mark the row with the error, bump `next_refresh_at`, and DO NOT
 * rethrow — the caller (usually the background worker or the
 * fire-and-forget path) doesn't want a rejection.
 *
 * Set `throwOnCold: true` to force rethrow — used by the initial
 * blocking cold path so the API route can surface the error to
 * the user when there's no cached payload to fall back on.
 */
export async function refreshSnapshot<T>(
  kind: PortfolioSnapshotKind,
  id: string,
  opts: { limit?: number; throwOnCold?: boolean } = {},
): Promise<T | null> {
  return withInflight(kind, id, async () => {
    try {
      const payload = await fetchUpstream<T>(kind, id, opts.limit);
      writeSnapshot(kind, id, payload, REFRESH_TTL_SECONDS[kind]);
      return payload;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      markSnapshotError(kind, id, message, REFRESH_ERROR_BACKOFF_SECONDS);
      if (opts.throwOnCold) {
        // Preserve the original error type where possible so the
        // route handler can still emit a 503 for
        // `DataSourceUnavailableError`.
        throw err;
      }
      return null;
    }
  });
}

// ---------------------------------------------------------------------------
// Read path
// ---------------------------------------------------------------------------

export interface CachedPayload<T> {
  payload: T;
  /** Snapshot metadata; useful for "as of X" / "cached, refresh pending" UI. */
  meta: {
    fetchedAt: string;
    nextRefreshAt: string;
    stale: boolean;
    lastError: string | null;
    lastErrorAt: string | null;
  };
}

/**
 * The main read entry point. Serves the SQLite snapshot when one
 * exists, kicking off a background refresh if the freshness window
 * has expired. Only blocks on the upstream when NOTHING is cached
 * and `waitForFreshOnCold` is true (the default).
 */
async function getCached<T>(
  kind: PortfolioSnapshotKind,
  id: string,
  limit?: number,
): Promise<CachedPayload<T>> {
  const now = Date.now();
  const cached = readSnapshot<T>(kind, id);
  if (cached) {
    touchSnapshotVisit(kind, id);
    const stale = new Date(cached.nextRefreshAt).getTime() <= now;
    if (stale) {
      // Fire-and-forget refresh. Errors go to console.error via
      // `refreshSnapshot`'s internal handling — the current caller
      // has already been served.
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      refreshSnapshot(kind, id, { limit }).catch((err) => {
        // eslint-disable-next-line no-console
        console.error(
          `[portfolios-cache] background refresh failed for ${kind}/${id}:`,
          err,
        );
      });
    }
    return {
      payload: cached.payload,
      meta: {
        fetchedAt: cached.fetchedAt,
        nextRefreshAt: cached.nextRefreshAt,
        stale,
        lastError: cached.lastError,
        lastErrorAt: cached.lastErrorAt,
      },
    };
  }

  // Cold path — nothing cached at all. Block on the upstream and
  // let its errors bubble so the API route can surface them.
  const fresh = await refreshSnapshot<T>(kind, id, { limit, throwOnCold: true });
  if (fresh === null) {
    // `throwOnCold: true` should ensure this branch is unreachable
    // (any upstream error re-throws), but the type system doesn't
    // know that. Bail with a stable error message rather than an
    // implicit `null` slipping into the UI.
    throw new Error(
      `Portfolio snapshot for ${kind}/${id} was unavailable and no cached copy exists.`,
    );
  }
  const now2 = new Date().toISOString();
  const nextRefreshAt = new Date(Date.now() + REFRESH_TTL_SECONDS[kind] * 1000).toISOString();
  // Bump visit count for the newly-written row so the background
  // engine treats it as user-visited on future ticks. We can call
  // `touchSnapshotVisit` unconditionally now because `writeSnapshot`
  // inside `refreshSnapshot` already created the row.
  touchSnapshotVisit(kind, id);
  return {
    payload: fresh,
    meta: {
      fetchedAt: now2,
      nextRefreshAt,
      stale: false,
      lastError: null,
      lastErrorAt: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Public typed entry points — one per report kind. These are what
// the API route (`/api/portfolios`) imports; keeping them separate
// per kind means callers can't accidentally cast a `PoliticianReport`
// to a `FundReport` (which would nuke type safety since we store
// everything as an opaque JSON blob).
// ---------------------------------------------------------------------------

export async function getCachedPolitician(
  id: string,
  limit = 200,
): Promise<CachedPayload<PoliticianReport>> {
  return getCached<PoliticianReport>("politician", id, limit);
}

export async function getCachedPerson(
  id: string,
  limit = 30,
): Promise<CachedPayload<PersonReport>> {
  return getCached<PersonReport>("person", id, limit);
}

/**
 * Set of preset ids whose "empty-with-accession" snapshot has already
 * been heal-attempted in this process. Prevents an unbounded loop of
 * SEC round-trips for funds that legitimately filed a 13F with zero
 * holdings (rare but real — e.g. a manager who unwound every position
 * before the reporting period ended). Reset on process restart, which
 * is the right cadence: if the heal returned another empty payload,
 * we don't want to keep hammering SEC every visit, but we do want to
 * try again after a restart in case the empty was a symptom of a
 * previously-mis-configured env (bad `SEC_USER_AGENT` etc.).
 */
const _fundHealAttempted = new Set<string>();

export async function getCachedFund(
  id: string,
): Promise<CachedPayload<FundReport>> {
  const cached = await getCached<FundReport>("fund", id);

  // Schema-migration guard: fund reports gained `resolvedTicker` /
  // `resolvedExchange` / `resolvedConfidence` fields on `FundHolding`
  // when the SEC name→ticker resolver landed (see
  // `lib/sec-ticker-map.ts`). Snapshots written before that change
  // don't carry those fields, so serving them from the SQLite cache
  // would leave the fund manager UI stuck with the old "manual
  // popover" fallback until the natural 24h TTL expired.
  //
  // We detect old-shape payloads by checking whether the very first
  // holding has the `resolvedTicker` KEY present (regardless of
  // value — a `null` is a resolver miss, which IS the new shape).
  // On a hit, we fire a blocking refresh so the caller sees the
  // enriched payload immediately. This runs at most once per preset
  // per process restart; subsequent visits see the new-shape row and
  // fall straight through.
  const first = cached.payload.holdings[0];
  const needsUpgrade =
    first !== undefined && !Object.prototype.hasOwnProperty.call(first, "resolvedTicker");

  // Poisoned-cache heal: a snapshot with `accessionNumber` set but
  // `positionCount === 0` means an earlier fetch DID locate a 13F
  // filing on EDGAR but couldn't extract any holdings from it. Before
  // the SEC-error path in `fetchFund13F` was hardened, that shape was
  // silently produced by any 403/429/5xx from the SEC archive (User-Agent
  // rejected, IP throttled, etc.) — and the empty payload then got
  // cached for a full 24h, so the fund page displayed the misleading
  // "manager doesn't file 13Fs" message for the rest of the day.
  //
  // Post-fix, `fetchFund13F` throws `DataSourceUnavailableError` on
  // those errors instead of returning an empty report, but existing
  // production installations may still be sitting on a poisoned row
  // written before the fix landed. This guard forces a blocking
  // refresh on read when we detect that shape — the refresh will either
  // succeed (and write a real payload) or throw (letting the API return
  // a proper 503 so the UI can render the "SEC unreachable" banner
  // instead of the misleading empty-state one).
  //
  // We don't fire the heal for `accessionNumber === null` because that
  // legitimately means the manager doesn't file 13Fs; the empty payload
  // is the correct answer and re-fetching wouldn't change it.
  const looksPoisoned =
    cached.payload.accessionNumber !== null &&
    cached.payload.positionCount === 0 &&
    !_fundHealAttempted.has(id);

  if (looksPoisoned) {
    // Record the attempt BEFORE awaiting the refresh so a burst of
    // concurrent requests can't all queue their own refresh (the
    // `withInflight` dedup inside `refreshSnapshot` already coalesces
    // in-flight fetches, but that state clears the moment the fetch
    // resolves — this flag stays set for the life of the process).
    _fundHealAttempted.add(id);
    // `throwOnCold: true` deliberately propagates DataSourceUnavailableError
    // so the API returns a 503 and the fund page renders the "SEC EDGAR
    // is throttling us" banner instead of the misleading empty-state
    // ("manager doesn't file 13Fs"). This is the actionable UX: the user
    // knows to try again, and the operator can check server logs to see
    // whether it's a User-Agent issue, an IP throttle, or a network egress
    // problem.
    const fresh = await refreshSnapshot<FundReport>("fund", id, {
      throwOnCold: true,
    });
    if (fresh) {
      return {
        payload: fresh,
        meta: {
          fetchedAt: new Date().toISOString(),
          nextRefreshAt: new Date(
            Date.now() + REFRESH_TTL_SECONDS.fund * 1000,
          ).toISOString(),
          stale: false,
          lastError: null,
          lastErrorAt: null,
        },
      };
    }
    // `throwOnCold: true` should make `fresh === null` unreachable, but
    // fall through to the stale payload just in case — better to render
    // the empty state than 500 the caller.
  } else if (needsUpgrade) {
    try {
      const fresh = await refreshSnapshot<FundReport>("fund", id, {
        throwOnCold: false,
      });
      if (fresh) {
        return {
          payload: fresh,
          meta: {
            fetchedAt: new Date().toISOString(),
            nextRefreshAt: new Date(
              Date.now() + REFRESH_TTL_SECONDS.fund * 1000,
            ).toISOString(),
            stale: false,
            lastError: null,
            lastErrorAt: null,
          },
        };
      }
      // Refresh failed (network / rate-limit). Fall through to the
      // stale payload — better to render without tickers than to
      // 500 the user, and the next visit will try again.
    } catch {
      // Same rationale — swallow and serve stale.
    }
  }

  return cached;
}

// Re-export `DataSourceUnavailableError` so callers importing the
// cached wrappers don't have to reach back into `lib/portfolios.ts`
// just for the error class.
export { DataSourceUnavailableError };

// Re-export `REFRESH_TTL_SECONDS` so the /bot debug surface can
// show the same TTLs the coordinator is using, without importing
// hardcoded numbers.
export { REFRESH_TTL_SECONDS };
