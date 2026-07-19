/**
 * Global SEC EDGAR request pacer + circuit breaker.
 *
 * SEC's fair-access policy caps callers at 10 req/s per source IP.
 * Historically the app relied on each caller's own concurrency limit
 * (technical/insider/fund fetchers each capped at 2 in-flight) to stay
 * under that ceiling, but the background worker (`lib/bot/engine.ts`)
 * fans out 11 ticks in parallel every 60s — three of them (portfolio,
 * stock, portfolio-snapshot) hit SEC — and their INTERNAL concurrency
 * limits stack when they run simultaneously. Peak burst can exceed
 * 10 req/s, at which point SEC starts returning 429 and keeps the IP
 * throttled for **minutes** after the burst subsides.
 *
 * This module fixes that by making every SEC request in the whole
 * process wait for a shared "slot" first. Slots are handed out at a
 * minimum interval of `MIN_INTERVAL_MS` (default 150 ms → ~6.6 req/s
 * ceiling, comfortably below SEC's 10 req/s cap), so no matter how
 * many callers race, aggregate SEC traffic is paced.
 *
 * Layered on top is a circuit breaker: on the first 429 we've seen
 * recently, all SEC calls short-circuit for `COOLDOWN_MS` (default 60s)
 * with a synthetic 429 response. Two benefits:
 *
 *   1. We stop piling on SEC while they're already throttling us — SEC's
 *      throttle counter is stateful and even rejected requests can extend
 *      the window.
 *   2. The user-facing timeout is much shorter — instead of every request
 *      waiting for a real SEC round-trip that will 429 anyway, they get
 *      the same 429 immediately from the local breaker.
 *
 * Both knobs are env-tunable so operators can loosen them if SEC's
 * policy changes or their egress IP has different characteristics:
 *
 *   * `SEC_MIN_INTERVAL_MS` — min gap between outbound SEC requests.
 *   * `SEC_COOLDOWN_MS`     — how long the breaker stays open after
 *                             a 429.
 *
 * The pacer and breaker are process-local. That's fine: the bot worker
 * and the Next.js UI run in the same Node process (worker.ts calls into
 * the same modules the API routes do), so a single shared state covers
 * every SEC call the app makes.
 */

import { timedFetch } from "./http";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MIN_INTERVAL_MS = (() => {
  const raw = Number(process.env.SEC_MIN_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 150;
})();

const COOLDOWN_MS = (() => {
  const raw = Number(process.env.SEC_COOLDOWN_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 60_000;
})();

// ---------------------------------------------------------------------------
// Pacer — serialized minimum-interval scheduler
// ---------------------------------------------------------------------------
//
// Implemented as a promise chain so N concurrent callers queue behind
// one another and each waits `MIN_INTERVAL_MS` after the previous slot
// completes. This is O(1) space per waiter and doesn't spin — the
// `setTimeout` sleep releases the event loop while waiting.

let _lastCallAt = 0;
let _mutex: Promise<void> = Promise.resolve();

async function acquireSlot(): Promise<void> {
  const prev = _mutex;
  let release: () => void = () => {};
  _mutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await prev;
    const now = Date.now();
    const wait = Math.max(0, _lastCallAt + MIN_INTERVAL_MS - now);
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    _lastCallAt = Date.now();
  } finally {
    release();
  }
}

// ---------------------------------------------------------------------------
// Circuit breaker — opens on 429, auto-recloses after cooldown
// ---------------------------------------------------------------------------

let _openUntil = 0;
let _openReason = "";

function isBreakerOpen(): boolean {
  return Date.now() < _openUntil;
}

function tripBreaker(reason: string): void {
  const wasOpen = isBreakerOpen();
  _openUntil = Date.now() + COOLDOWN_MS;
  _openReason = reason;
  if (!wasOpen) {
    // eslint-disable-next-line no-console
    console.warn(
      `[sec-limiter] circuit breaker OPEN for ${Math.round(COOLDOWN_MS / 1000)}s ` +
        `(reason: ${reason}). Outbound SEC calls will be short-circuited ` +
        `with a synthetic 429 until the cooldown expires.`,
    );
  }
}

/**
 * Read-only breaker state. Exposed for the diagnostic probe endpoint
 * so operators can see whether the local breaker is currently open
 * (and why) without cracking open logs.
 */
export function getBreakerState(): {
  open: boolean;
  openUntil: string | null;
  reason: string;
  cooldownMs: number;
  minIntervalMs: number;
} {
  const open = isBreakerOpen();
  return {
    open,
    openUntil: open ? new Date(_openUntil).toISOString() : null,
    reason: open ? _openReason : "",
    cooldownMs: COOLDOWN_MS,
    minIntervalMs: MIN_INTERVAL_MS,
  };
}

/**
 * Reset breaker state. Used by the diagnostic probe endpoint's
 * `force=1` mode so an operator can manually clear the local
 * throttle without waiting for the cooldown — useful when they've
 * verified SEC is reachable again from the container shell.
 */
export function resetBreaker(): void {
  if (isBreakerOpen()) {
    // eslint-disable-next-line no-console
    console.log("[sec-limiter] circuit breaker manually reset via probe endpoint");
  }
  _openUntil = 0;
  _openReason = "";
}

// ---------------------------------------------------------------------------
// Public wrapper — replaces `timedFetch(secUrl, { headers: secHeaders(), … })`
// call sites everywhere in the codebase.
// ---------------------------------------------------------------------------

/**
 * Synthesizes a Response that mimics a real SEC 429 so callers don't
 * need a separate error branch for "short-circuited by the local
 * breaker". `res.ok` is false, `res.status` is 429, and the body
 * decodes to a diagnostic string.
 */
function shortCircuitResponse(reason: string): Response {
  return new Response(
    `[sec-limiter] short-circuited: breaker open (${reason})`,
    { status: 429, statusText: "Local circuit breaker open" },
  );
}

/**
 * Drop-in replacement for `timedFetch(url, { headers: secHeaders(), … })`
 * that adds SEC-specific pacing and breaker semantics. Callers should
 * pass the SEC User-Agent headers themselves via `init.headers` — this
 * wrapper does NOT inject `secHeaders()` because doing so would create
 * a circular import back into `lib/portfolios.ts` where `secHeaders`
 * lives.
 */
export async function secTimedFetch(
  input: RequestInfo | URL,
  init: (RequestInit & { timeoutMs?: number }) = {},
): Promise<Response> {
  if (isBreakerOpen()) {
    return shortCircuitResponse(_openReason);
  }
  await acquireSlot();
  // Re-check after pacer wait — a concurrent caller may have received
  // a 429 while we were queued and tripped the breaker in the
  // meantime. Short-circuiting here saves one real SEC round-trip.
  if (isBreakerOpen()) {
    return shortCircuitResponse(_openReason);
  }
  const res = await timedFetch(input, init);
  if (res.status === 429) {
    tripBreaker(`HTTP 429 from ${describeUrl(input)}`);
  } else if (res.status === 503) {
    // 503 from SEC usually means their edge is offloading load
    // temporarily — same "back off" signal as 429 for our purposes.
    tripBreaker(`HTTP 503 from ${describeUrl(input)}`);
  }
  return res;
}

function describeUrl(input: RequestInfo | URL): string {
  try {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    if (typeof (input as Request).url === "string") return (input as Request).url;
  } catch {
    // fall through
  }
  return "<unknown>";
}
