/**
 * App-wide edge middleware. Applies three layers of defense to `/api/*`:
 *
 *   1. Same-origin (CSRF) check on mutations — reject POST/PUT/PATCH/DELETE
 *      when the `Origin`/`Referer` doesn't match the server's own host.
 *      This is the primary line of defense against drive-by CSRF given the
 *      app has no per-user session model.
 *
 *   2. Per-IP token-bucket rate limit for anonymous mutations and the
 *      external-facing search endpoint. Prevents runaway abuse of the
 *      SEC / CNN / Yahoo quotas the app depends on.
 *
 *   3. Optional bearer token — when `APP_TOKEN` env is set, every /api/*
 *      call must present the same token via `Authorization: Bearer …`
 *      OR the `app_token` cookie. Absence of the env var keeps the app
 *      "open" for local development / single-tenant self-hosting.
 *
 * The middleware runs in Node runtime because `lib/http.ts` uses Node
 * globals. `matcher` restricts it to /api/* so page loads stay untouched.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getClientIp, rateLimit } from "@/lib/http";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const APP_TOKEN = process.env.APP_TOKEN?.trim() || "";

// Anonymous rate-limit budgets. Generous for a single-tenant dashboard
// while still catching runaway browser bugs or drive-by abuse.
const MUTATION_RATE = { capacity: 30, refillPerSec: 1 }; // ~1 rps sustained, 30 burst
const SEARCH_RATE = { capacity: 20, refillPerSec: 2 }; // ~2 rps sustained
const TICK_RATE = { capacity: 6, refillPerSec: 1 / 60 }; // ~1/min sustained
const RATE_LIMITED_MUTATION_PATHS = /^\/api\/(?!auth)/;

/**
 * True if the request's Origin (or Referer when Origin is missing) matches
 * the server's `Host` header. Missing Origin AND Referer is treated as
 * suspicious for mutations — browsers include one of them for cross-origin
 * fetches; server-to-server callers can present the bearer token instead.
 */
function isSameOrigin(req: NextRequest): boolean {
  const host = req.headers.get("host");
  if (!host) return false;
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }
  return false;
}

function unauthorized(reason: string): NextResponse {
  return NextResponse.json({ error: reason }, { status: 401 });
}

function forbidden(reason: string): NextResponse {
  return NextResponse.json({ error: reason }, { status: 403 });
}

function tooManyRequests(retryAfterMs: number): NextResponse {
  const res = NextResponse.json(
    { error: "Rate limit exceeded" },
    { status: 429 },
  );
  res.headers.set("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  return res;
}

/**
 * Read the caller-supplied token from either an `Authorization: Bearer …`
 * header or an `app_token` cookie. Cookies are convenient for the UI to
 * set once at login and forget; headers are convenient for CLI / scripts.
 */
function extractToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth);
    if (m && m[1]) return m[1].trim();
  }
  const cookie = req.cookies.get("app_token")?.value;
  return cookie ? cookie.trim() : null;
}

// Endpoints that must remain reachable without any auth/CSRF/rate-limit —
// container orchestrators (Docker, Portainer, k8s) probe these on a fixed
// interval and cannot present a bearer token. Keep the list minimal and
// GET-only; anything here is effectively public.
const UNPROTECTED_PATHS = new Set(["/api/health"]);

export function middleware(req: NextRequest): NextResponse | undefined {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  // ---- 0. Unprotected probe endpoints --------------------------------
  // Healthcheck must succeed even when APP_TOKEN is set, otherwise Docker
  // marks the container unhealthy on boot and enters a restart loop.
  if (UNPROTECTED_PATHS.has(pathname) && (method === "GET" || method === "HEAD")) {
    return undefined;
  }

  // ---- 1. Optional bearer token (covers every /api/* request) --------
  if (APP_TOKEN) {
    const token = extractToken(req);
    if (!token) return unauthorized("Missing token");
    if (token !== APP_TOKEN) return unauthorized("Invalid token");
  }

  // ---- 2. Same-origin CSRF check on mutations ------------------------
  if (MUTATION_METHODS.has(method)) {
    if (!isSameOrigin(req)) {
      return forbidden("Cross-origin request rejected");
    }
  }

  // ---- 3. Rate limiting (anonymous only — bearer-token callers get
  // implicit trust because they proved knowledge of the shared secret) --
  if (!APP_TOKEN) {
    const ip = getClientIp(req);

    // Broad mutation limit.
    if (MUTATION_METHODS.has(method) && RATE_LIMITED_MUTATION_PATHS.test(pathname)) {
      const r = rateLimit({
        bucket: "mutation",
        key: ip,
        capacity: MUTATION_RATE.capacity,
        refillPerSec: MUTATION_RATE.refillPerSec,
      });
      if (!r.ok) return tooManyRequests(r.retryAfterMs);
    }

    // Search endpoint fans out to SEC — tighter budget.
    if (pathname === "/api/portfolios/search") {
      const r = rateLimit({
        bucket: "search",
        key: ip,
        capacity: SEARCH_RATE.capacity,
        refillPerSec: SEARCH_RATE.refillPerSec,
      });
      if (!r.ok) return tooManyRequests(r.retryAfterMs);
    }

    // Manual "run tick" actions kick off expensive external work. Cap at
    // ~1/min. The body parse happens downstream — we only rate-limit the
    // POST here (the /api/bot GET/HEAD and other actions still pay the
    // broad `mutation` bucket cost, which is fine).
    const isTickTrigger =
      method === "POST" &&
      (pathname === "/api/portfolios/notifications" ||
        pathname === "/api/stock-watches/notifications" ||
        pathname === "/api/news-subscriptions/notifications");
    if (isTickTrigger) {
      const r = rateLimit({
        bucket: "tick",
        key: ip,
        capacity: TICK_RATE.capacity,
        refillPerSec: TICK_RATE.refillPerSec,
      });
      if (!r.ok) return tooManyRequests(r.retryAfterMs);
    }
  }

  return undefined;
}

export const config = {
  // Only intercept API traffic — page loads, static assets, and the
  // service-worker registration stay out of the middleware path.
  matcher: ["/api/:path*"],
};
