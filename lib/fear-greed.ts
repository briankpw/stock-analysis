/**
 * CNN Fear & Greed Index fetch + in-process cache.
 *
 * Extracted from `app/api/fear-greed/route.ts` so the master-verdict
 * watch engine (running in the worker process) can consume the same
 * data without going through the Next.js HTTP layer. The two runtimes
 * each keep their own module-scope cache; that's fine because CNN
 * only updates the index once per US-market business day, so an
 * occasional duplicate fetch is inexpensive.
 *
 * The route module continues to be the *sole* public HTTP surface —
 * it now just imports from here and adapts the response shape. Any
 * server-side caller (worker, batch job, other route) should import
 * `getFearGreedScore()` directly rather than round-tripping through
 * `fetch("/api/fear-greed")`.
 */

import { timedFetch } from "@/lib/http";
import { getState, setState } from "@/lib/bot/store";

const CNN_URL =
  "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * DB key under which we persist the most recent VALID CNN payload
 * (schema-validated by `_validatePayload`). Serves two purposes:
 *
 *   1. Fallback for the /market page — if CNN is down, the client
 *      still gets *yesterday's* score with `stale: true` set instead
 *      of a 502.
 *   2. Baseline for the endpoint-changed alarm — if the schema shifts
 *      out from under us we log once (with a fingerprint) so ops
 *      notice before every downstream consumer starts reporting `null`.
 *
 * Kept in the shared `bot_state` table via `getState/setState` — the
 * key namespace is deliberately dotted so a future consolidation
 * script can grep by prefix.
 */
const LAST_GOOD_KEY = "feargreed.last_good";

/**
 * Fingerprint of the last "unexpected shape" we saw so the schema-
 * changed warning fires ONCE per structural change, not on every
 * poll. `null` sentinel means "no unexpected shape seen recently";
 * a change in fingerprint re-arms the warning.
 */
let _lastSchemaWarnFingerprint: string | null = null;

// Chrome-ish. The CNN endpoint gates on User-Agent shape more than
// the exact value, but sending a plausible browser string keeps us
// from getting the "I'm a teapot" bot response.
const HEADERS: HeadersInit = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://edition.cnn.com",
  Referer: "https://edition.cnn.com/",
};

export type FearGreedRating =
  | "extreme fear"
  | "fear"
  | "neutral"
  | "greed"
  | "extreme greed";

interface CnnIndicator {
  score: number;
  rating: FearGreedRating;
  timestamp?: string;
}

/**
 * Raw CNN payload — the endpoint publishes far more data than we
 * expose. Only the fields we surface are typed here; the rest is
 * ignored.
 */
export interface CnnPayload {
  fear_and_greed: {
    score: number;
    rating: FearGreedRating;
    timestamp: string;
    previous_close: number;
    previous_1_week: number;
    previous_1_month: number;
    previous_1_year: number;
  };
  market_momentum_sp500: CnnIndicator;
  market_momentum_sp125: CnnIndicator;
  stock_price_strength: CnnIndicator;
  stock_price_breadth: CnnIndicator;
  put_call_options: CnnIndicator;
  market_volatility_vix: CnnIndicator;
  market_volatility_vix_50: CnnIndicator;
  junk_bond_demand: CnnIndicator;
  safe_haven_demand: CnnIndicator;
}

let _cache: { payload: CnnPayload; expiresAt: number } | null = null;

/**
 * Structural validation of the CNN payload. We don't try to be
 * strict about every field — just the ones we actually surface. If
 * any of them is missing or the wrong type, the payload is treated
 * as "schema drift" and we fall back to the last-known-good.
 *
 * Returning a fingerprint on failure lets us dedupe the schema-
 * changed warning: same fingerprint → same drift, log once; new
 * fingerprint → new drift, log again.
 */
function _validatePayload(
  raw: unknown,
): { ok: true; payload: CnnPayload } | { ok: false; fingerprint: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, fingerprint: "not-an-object" };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = raw as any;
  const fg = p.fear_and_greed;
  const requiredIndicators = [
    "market_momentum_sp500",
    "stock_price_strength",
    "stock_price_breadth",
    "put_call_options",
    "market_volatility_vix",
    "junk_bond_demand",
    "safe_haven_demand",
  ] as const;
  const missing: string[] = [];
  if (!fg || typeof fg !== "object") missing.push("fear_and_greed");
  else {
    if (typeof fg.score !== "number") missing.push("fear_and_greed.score");
    if (typeof fg.rating !== "string") missing.push("fear_and_greed.rating");
  }
  for (const key of requiredIndicators) {
    const ind = p[key];
    if (!ind || typeof ind !== "object" || typeof ind.score !== "number") {
      missing.push(key);
    }
  }
  if (missing.length === 0) {
    return { ok: true, payload: raw as CnnPayload };
  }
  // Fingerprint = sorted list of missing keys so drifts of the same
  // shape share an alarm and truly new drifts re-arm it.
  return { ok: false, fingerprint: missing.sort().join(",") };
}

function _warnOnSchemaDrift(fingerprint: string): void {
  if (_lastSchemaWarnFingerprint === fingerprint) return;
  _lastSchemaWarnFingerprint = fingerprint;
  // eslint-disable-next-line no-console
  console.warn(
    `[fear-greed] CNN payload missing expected fields: ${fingerprint}. ` +
      `Serving last-known-good from bot_state instead. If this keeps firing, ` +
      `the CNN endpoint (${CNN_URL}) may have changed shape and lib/fear-greed.ts ` +
      `needs an update.`,
  );
}

/**
 * Fetch the raw CNN payload with in-process caching plus a
 * persistent last-known-good fallback in `bot_state`.
 *
 * On the happy path we hit CNN, structurally validate the response,
 * cache it in-memory (30 min) AND write it to SQLite for the
 * fallback tier. On failure (network error, HTTP 5xx, schema drift)
 * we return the persisted copy so the /market page and master
 * verdict still have data. If nothing has ever been persisted, the
 * caller sees the underlying error and can render an empty state.
 *
 * When the caller doesn't need to distinguish live vs. cached (the
 * old contract) they can `await fetchFearGreedPayload()` and treat
 * whatever comes back as authoritative. When they DO care —
 * specifically the /market page's yellow "stale" badge — they call
 * `fetchFearGreedWithProvenance()` below and read the `stale` flag.
 */
export async function fetchFearGreedPayload(): Promise<CnnPayload> {
  const { payload } = await fetchFearGreedWithProvenance();
  return payload;
}

export interface FearGreedWithProvenance {
  payload: CnnPayload;
  /**
   * True when the payload came from the persistent last-known-good
   * store rather than a fresh CNN response. Consumers should render
   * a "stale" badge and note the `fetchedAt` from the payload.
   */
  stale: boolean;
  /**
   * Reason we fell back, if we did. `null` on the happy path.
   * Populated with a short machine-readable tag ("network",
   * "http_5xx", "schema_drift") so log lines / metrics can group
   * failures by cause.
   */
  fallbackReason: "network" | "http_error" | "schema_drift" | null;
}

/**
 * Rich variant of `fetchFearGreedPayload` that exposes whether the
 * result is stale and, if so, why. See `FearGreedWithProvenance`.
 *
 * Never throws for transport-level failures as long as *some*
 * previously-good payload exists in `bot_state`. Only throws when
 * both the live fetch AND the fallback are unavailable.
 */
export async function fetchFearGreedWithProvenance(): Promise<FearGreedWithProvenance> {
  const now = Date.now();
  if (_cache && _cache.expiresAt > now) {
    return { payload: _cache.payload, stale: false, fallbackReason: null };
  }

  const fallback = (
    reason: "network" | "http_error" | "schema_drift",
    liveError: unknown,
  ): FearGreedWithProvenance => {
    const lastGood = _loadLastGood();
    if (lastGood) {
      // Keep the in-memory cache pointed at the stale copy for the
      // TTL window so subsequent callers within this process don't
      // re-attempt CNN on every request while CNN is down. The
      // background bot tick still refreshes on its own cadence.
      _cache = { payload: lastGood, expiresAt: now + CACHE_TTL_MS };
      return { payload: lastGood, stale: true, fallbackReason: reason };
    }
    // No fallback → propagate original error so the API route can
    // still return 502 and the master verdict can score as `null`.
    if (liveError instanceof Error) throw liveError;
    throw new Error(`CNN Fear & Greed unavailable (${reason})`);
  };

  let res: Response;
  try {
    res = await timedFetch(CNN_URL, {
      headers: HEADERS,
      cache: "no-store",
      timeoutMs: 15_000,
    });
  } catch (err) {
    return fallback("network", err);
  }

  if (!res.ok) {
    return fallback("http_error", new Error(`CNN responded ${res.status}`));
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch (err) {
    return fallback("network", err);
  }

  const validated = _validatePayload(raw);
  if (!validated.ok) {
    _warnOnSchemaDrift(validated.fingerprint);
    return fallback(
      "schema_drift",
      new Error(
        `CNN payload missing expected fields: ${validated.fingerprint}`,
      ),
    );
  }

  // Happy path: freshen both caches. If we had previously flagged a
  // schema drift, clear the fingerprint so a *new* drift will alarm
  // again. This also serves as an implicit "recovered" signal in
  // the logs (no more warnings after the endpoint stabilises).
  _lastSchemaWarnFingerprint = null;
  _cache = { payload: validated.payload, expiresAt: now + CACHE_TTL_MS };
  _saveLastGood(validated.payload);
  return {
    payload: validated.payload,
    stale: false,
    fallbackReason: null,
  };
}

interface StoredLastGood {
  payload: CnnPayload;
  savedAt: string;
}

function _loadLastGood(): CnnPayload | null {
  try {
    const stored = getState<StoredLastGood | null>(LAST_GOOD_KEY, null);
    if (!stored || !stored.payload) return null;
    // Defensive re-validate — the DB could contain an older shape
    // written by a previous version of this file with looser
    // validation. If it fails today's check, treat as no fallback.
    const check = _validatePayload(stored.payload);
    return check.ok ? check.payload : null;
  } catch {
    return null;
  }
}

function _saveLastGood(payload: CnnPayload): void {
  try {
    setState<StoredLastGood>(LAST_GOOD_KEY, {
      payload,
      savedAt: new Date().toISOString(),
    });
  } catch (err) {
    // Persistence is best-effort — a locked/full DB shouldn't
    // block the live response. Log so ops can investigate.
    // eslint-disable-next-line no-console
    console.warn("[fear-greed] failed to persist last-known-good:", err);
  }
}

/**
 * The score is the only thing the master verdict needs, so we expose
 * a convenience wrapper that returns `null` on failure. Anything
 * that wants the full payload should call `fetchFearGreedPayload()`
 * and handle its own errors.
 */
export async function getFearGreedScore(): Promise<number | null> {
  try {
    const raw = await fetchFearGreedPayload();
    const s = raw.fear_and_greed.score;
    return Number.isFinite(s) ? s : null;
  } catch {
    return null;
  }
}
