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

/**
 * When APP_URL is set, we accept it as an authoritative same-origin
 * baseline in addition to the request's Host header. This matters behind
 * a reverse proxy that terminates TLS and forwards to the container over
 * an internal hostname — the browser sends `Origin: https://public.tld`
 * but the container's `Host` header shows the internal name. Without
 * APP_URL, our CSRF check rejects a legitimate same-origin POST from
 * the UI. With it, we accept both.
 *
 * Parsed at module load and cached so the URL parser doesn't run per
 * request. Empty string means "no override; use Host header only".
 */
const APP_URL_HOST = (() => {
  const raw = process.env.APP_URL?.trim();
  if (!raw) return "";
  try {
    return new URL(raw).host; // strips scheme, port kept if non-default
  } catch {
    return "";
  }
})();

// Anonymous rate-limit budgets. Generous for a single-tenant dashboard
// while still catching runaway browser bugs or drive-by abuse.
const MUTATION_RATE = { capacity: 30, refillPerSec: 1 }; // ~1 rps sustained, 30 burst
const SEARCH_RATE = { capacity: 20, refillPerSec: 2 }; // ~2 rps sustained
const TICK_RATE = { capacity: 6, refillPerSec: 1 / 60 }; // ~1/min sustained
const RATE_LIMITED_MUTATION_PATHS = /^\/api\/(?!auth)/;

/**
 * True if the request's Origin (or Referer when Origin is missing) matches
 * one of the trusted hosts:
 *
 *   * The container's own `Host` header — normal same-origin case.
 *   * The host portion of `APP_URL` — needed when a reverse proxy rewrites
 *     `Host` to an internal name but the browser still sends `Origin:
 *     https://<public>` (which is what CSRF actually cares about anyway).
 *
 * Missing Origin AND Referer is treated as suspicious for mutations —
 * browsers include one of them for cross-origin fetches; server-to-server
 * callers can present the bearer token instead.
 */
function isSameOrigin(req: NextRequest): boolean {
  const hostHeader = req.headers.get("host");
  const trusted = new Set<string>();
  if (hostHeader) trusted.add(hostHeader);
  if (APP_URL_HOST) trusted.add(APP_URL_HOST);
  if (trusted.size === 0) return false;

  const check = (raw: string | null): boolean => {
    if (!raw) return false;
    try {
      return trusted.has(new URL(raw).host);
    } catch {
      return false;
    }
  };

  return check(req.headers.get("origin")) || check(req.headers.get("referer"));
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
const UNPROTECTED_PATHS = new Set([
  "/api/health",
  // Auth endpoints have to be reachable without an existing session,
  // otherwise a fresh browser can never obtain one.
  "/api/auth/login",
  "/api/auth/status",
]);

// Page routes that must render for an unauthenticated visitor — the
// login screen itself, obviously, plus any framework-managed system
// URLs that should never be redirected.
const UNPROTECTED_PAGES = new Set(["/login"]);

// Path prefixes we never touch: Next.js internals, static PWA assets,
// and anything under /_next/. Handled here (as opposed to via the
// matcher) so the config stays a single expression and the exclusion
// logic is testable.
const IGNORED_PREFIXES = [
  "/_next/",
  "/icons/",
  "/favicon.ico",
  "/service-worker.js",
  "/manifest.webmanifest",
  "/robots.txt",
];

function isPageRequest(req: NextRequest): boolean {
  // `sec-fetch-dest: document` is the most reliable browser signal for
  // "top-level navigation". Fallback to Accept: text/html for older UAs
  // and for curl -H 'Accept: text/html' style debugging.
  if (req.headers.get("sec-fetch-dest") === "document") return true;
  const accept = req.headers.get("accept") || "";
  return accept.includes("text/html");
}

function redirectToLogin(req: NextRequest): NextResponse {
  const url = req.nextUrl.clone();
  const original = req.nextUrl.pathname + req.nextUrl.search;
  url.pathname = "/login";
  url.search = original && original !== "/" ? `?next=${encodeURIComponent(original)}` : "";
  return NextResponse.redirect(url);
}

export function middleware(req: NextRequest): NextResponse | undefined {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  // ---- Ignored prefixes ---------------------------------------------
  // Cheap prefix check up front so we don't run any logic against
  // static assets. The matcher below already filters most of these,
  // but keeping the explicit list here makes the exclusion contract
  // grep-able and makes middleware-unit-testing straightforward.
  for (const prefix of IGNORED_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix)) return undefined;
  }

  // ---- 0. Unprotected probe / auth endpoints -------------------------
  // Healthcheck must succeed even when APP_TOKEN is set, otherwise
  // Docker marks the container unhealthy on boot and enters a restart
  // loop. The login endpoint must be reachable so users can obtain a
  // cookie in the first place; the status endpoint answers "is auth
  // needed?" for the login page without leaking any secret.
  if (UNPROTECTED_PATHS.has(pathname)) return undefined;
  if (UNPROTECTED_PAGES.has(pathname)) return undefined;

  // ---- 1. Optional bearer token (covers /api/* AND page routes) -----
  // When APP_TOKEN is set, we require it on every non-whitelisted
  // request. For API calls we still return JSON 401 (scripts / fetches
  // want a machine-readable error). For page navigations we redirect
  // to /login so the browser experience is "click link → type token →
  // land on the intended page".
  if (APP_TOKEN) {
    const token = extractToken(req);
    if (!token || token !== APP_TOKEN) {
      if (isPageRequest(req)) return redirectToLogin(req);
      return unauthorized(token ? "Invalid token" : "Missing token");
    }
  }

  // Below this point we only apply the CSRF + rate-limit guards to
  // /api/* — those don't make sense for regular page GETs.
  if (!pathname.startsWith("/api/")) return undefined;

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
  // Match everything except Next.js internals, static PWA assets, and
  // media types that never need auth. The excluded set mirrors
  // `IGNORED_PREFIXES` above (redundant on purpose — the matcher stops
  // the middleware from ever booting for these paths, while the
  // in-function check protects when the middleware IS invoked, e.g.
  // via a rewrite target).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|service-worker.js|manifest.webmanifest|robots.txt).*)",
  ],
};
