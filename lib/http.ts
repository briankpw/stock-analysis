/**
 * Small server-side HTTP helpers shared by every API route:
 *
 *   - `redactError`  — trims internal error detail before it's returned
 *                       to a browser; full detail still hits the console.
 *   - `timedFetch`   — `fetch` with an `AbortSignal.timeout(...)` default
 *                       so a hung upstream never wedges the worker or a
 *                       route handler forever.
 *   - `getClientIp`  — best-effort client-IP extractor for rate limiting.
 *   - `rateLimit`    — in-process token-bucket keyed by IP + bucket name.
 *
 * All are pure functions with a module-level state; nothing is exported to
 * the client bundle (this module imports Node-only APIs indirectly through
 * its use of `process.env` and never touches the DOM).
 */

const IS_PROD = process.env.NODE_ENV === "production";

// ---------------------------------------------------------------------------
// Error redaction
// ---------------------------------------------------------------------------

/**
 * Convert an unknown error into a `{ message, status }` pair that is safe to
 * ship to a browser. In production we return a generic message per class of
 * error and log the full detail server-side; in development we pass the
 * message through so it's easy to debug.
 *
 * Callers should pass a `fallbackStatus` matching the domain: 400 for
 * validation failures, 502 for upstream failures, 500 as a catch-all.
 */
export interface RedactedError {
  message: string;
  status: number;
}

export function redactError(
  err: unknown,
  fallbackStatus = 500,
  publicMessage?: string,
): RedactedError {
  const raw = err instanceof Error ? err.message : String(err);

  // Zod errors have a `.issues` array; surface a compact summary in dev.
  // Preserve 400 for these because they're always caller-side.
  const zodIssues =
    err && typeof err === "object" && "issues" in err
      ? (err as { issues: Array<{ path?: unknown[]; message: string }> }).issues
      : null;
  if (zodIssues && Array.isArray(zodIssues)) {
    const summary = zodIssues
      .slice(0, 3)
      .map((i) => `${(i.path ?? []).join(".") || "body"}: ${i.message}`)
      .join("; ");
    return {
      message: `Invalid request${summary ? `: ${summary}` : ""}`,
      status: 400,
    };
  }

  if (IS_PROD) {
    // eslint-disable-next-line no-console
    console.error("[api]", raw);
    return { message: publicMessage ?? "Internal error", status: fallbackStatus };
  }
  return { message: raw, status: fallbackStatus };
}

// ---------------------------------------------------------------------------
// Timed fetch
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * `fetch` with a hard timeout. Merges any caller-supplied `AbortSignal`
 * with the timeout signal so external abort still works.
 *
 * Throws a native `DOMException("... aborted", "TimeoutError")` on timeout,
 * which downstream code can detect via `err.name === "TimeoutError"` if it
 * wants to distinguish transient vs. permanent failures.
 */
export async function timedFetch(
  input: RequestInfo | URL,
  init: (RequestInit & { timeoutMs?: number }) = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal, ...rest } = init;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal =
    callerSignal
      ? anySignal([callerSignal, timeoutSignal])
      : timeoutSignal;
  return fetch(input, { ...rest, signal });
}

/**
 * Merge multiple AbortSignals into one that fires when any input aborts.
 * `AbortSignal.any(...)` is standard as of Node 20 but not always available
 * on older TS lib targets — this shim is trivial and portable.
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

// ---------------------------------------------------------------------------
// Client IP extraction
// ---------------------------------------------------------------------------

/**
 * Best-effort client IP from a `Request`. Trusts `x-forwarded-for` because
 * the app is meant to sit behind a reverse proxy (Portainer / Traefik).
 * Falls back to a placeholder so rate-limit keys are stable when the
 * header is missing (e.g. direct localhost hits during dev).
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

// ---------------------------------------------------------------------------
// Rate limiter (token bucket, per (bucket, key) tuple)
// ---------------------------------------------------------------------------

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const _buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  /**
   * Symbolic bucket name so different routes can have independent budgets.
   * E.g. "mutation", "search".
   */
  bucket: string;
  /** Unique key for the caller (typically their IP). */
  key: string;
  /** Bucket capacity (max burst). */
  capacity: number;
  /** Steady-state refill rate in tokens/sec. */
  refillPerSec: number;
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterMs: number;
  remaining: number;
}

/**
 * Consume one token from the caller's bucket. Returns `ok=false` when the
 * bucket is empty. Retry-after is a hint clients can use for backoff.
 */
export function rateLimit(opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const cacheKey = `${opts.bucket}:${opts.key}`;
  let b = _buckets.get(cacheKey);
  if (!b) {
    b = { tokens: opts.capacity, updatedAt: now };
    _buckets.set(cacheKey, b);
  } else {
    const elapsedMs = now - b.updatedAt;
    if (elapsedMs > 0) {
      const refill = (elapsedMs / 1000) * opts.refillPerSec;
      b.tokens = Math.min(opts.capacity, b.tokens + refill);
      b.updatedAt = now;
    }
  }

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { ok: true, retryAfterMs: 0, remaining: Math.floor(b.tokens) };
  }

  const needed = 1 - b.tokens;
  const retryAfterMs = Math.ceil((needed / opts.refillPerSec) * 1000);
  return { ok: false, retryAfterMs, remaining: 0 };
}

/**
 * Test helper to reset the in-memory limiter state (vitest).
 */
export function _resetRateLimitForTests(): void {
  _buckets.clear();
}
