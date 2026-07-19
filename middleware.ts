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
import { authRequired, validatePresentedSecret } from "@/lib/auth";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const AUTH_ENABLED = authRequired();
const IS_DEV = process.env.NODE_ENV !== "production";

/**
 * Build the per-request Content-Security-Policy header value.
 *
 * Modern browsers use `'strict-dynamic'` + per-request nonce and
 * ignore `'unsafe-inline'` / `'unsafe-eval'` when strict-dynamic is
 * present, so the policy is strict on evergreen browsers while still
 * degrading gracefully on old ones. The nonce is required for every
 * inline `<script>` the app emits (currently just the
 * `next-themes` FOUC guard).
 *
 * In development we deliberately keep `'unsafe-inline'` +
 * `'unsafe-eval'` active for the whole `script-src` — Next.js's
 * Fast Refresh runtime uses `eval()` and its dev-only HMR
 * bootstrap contains inline scripts without a nonce we can inject.
 * Without those relaxations, `npm run dev` renders a blank page
 * and every network request silently fails (see the retro in
 * `next.config.mjs`). Production strips React Refresh, so neither
 * concession applies there.
 */
function buildCsp(nonce: string): string {
  const scriptSrc = IS_DEV
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : // Strict CSP pattern: strict-dynamic + nonce is honoured by
      // modern browsers, which then ignore 'unsafe-inline'; older
      // browsers fall back to unsafe-inline and still work.
      // 'unsafe-eval' is intentionally NOT included in prod — no
      // library the app ships uses eval() in production builds.
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline' https:`;
  const connectSrc = IS_DEV
    ? "connect-src 'self' ws: wss:"
    : "connect-src 'self'";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    connectSrc,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    // `frame-ancestors 'self'` (not `'none'`) so the app's own
    // pages can iframe the PDF proxy at /api/portfolios/ptr-pdf.
    // See next.config.mjs for the full rationale.
    "frame-ancestors 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/**
 * Cryptographically random base64 nonce (16 bytes → 22 base64 chars).
 * Uses the Web Crypto API which is available in Next.js edge/Node
 * runtimes without extra imports.
 */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Convert to base64 without padding.
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/=+$/, "");
}

/**
 * Attach the security headers we set per-request (CSP + HSTS) to
 * `res`. Called at every return path in `middleware()` so no page
 * navigation escapes the policy — the previous static-config
 * approach in next.config.mjs couldn't participate in a per-request
 * nonce, so it's been consolidated here.
 *
 * `nonce` is embedded in the CSP header so browsers can enforce it,
 * and mirrored to `x-nonce` on the *request* headers we pass
 * downstream. Server Components read `x-nonce` via `headers()` and
 * forward it to `<Script>` / `<ThemeProvider nonce>` so their
 * inline scripts execute under strict-dynamic.
 */
function applySecurityHeaders(
  res: NextResponse,
  nonce: string,
): NextResponse {
  res.headers.set("Content-Security-Policy", buildCsp(nonce));
  // HSTS: 6 months, all subdomains, preload-eligible. Only meaningful
  // when the site is served over HTTPS — a browser that first sees
  // HSTS over HTTP will ignore it, and containers reachable only via
  // a reverse proxy (nginx / Caddy / Cloudflare) inherit the proxy's
  // TLS. Kept short of a full year while operators verify TLS is
  // stable end-to-end; extend to 63072000 (2y) with `preload` after a
  // clean rollout if you plan to submit to hstspreload.org.
  res.headers.set(
    "Strict-Transport-Security",
    "max-age=15552000; includeSubDomains",
  );
  return res;
}

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
 * Dedicated brute-force budget for /api/auth/login.
 *
 * Runs on **every** request, not just when auth is disabled — the whole
 * point is to make password guessing against `APP_PASSWORD` infeasible
 * for anyone who *hasn't* authenticated yet, which is precisely the
 * traffic the broader rate-limiter skips (see #5 in the security audit).
 *
 * 5 attempts of burst, refilling at 5/min sustained: at ~12s between
 * attempts a 100M-word wordlist would take ~38 years per IP, which
 * pushes the attacker onto distributed infrastructure and gives
 * operators time to notice the 429 storm in their logs. If a legit
 * user typos their password 5 times in a minute they wait 12s and try
 * again — that's the price of stopping the brute-force path entirely.
 */
const LOGIN_RATE = { capacity: 5, refillPerSec: 5 / 60 }; // 5/min sustained, burst 5

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

function unauthorized(reason: string, nonce: string): NextResponse {
  const res = NextResponse.json({ error: reason }, { status: 401 });
  return applySecurityHeaders(res, nonce);
}

function forbidden(reason: string, nonce: string): NextResponse {
  const res = NextResponse.json({ error: reason }, { status: 403 });
  return applySecurityHeaders(res, nonce);
}

function tooManyRequests(retryAfterMs: number, nonce: string): NextResponse {
  const res = NextResponse.json(
    { error: "Rate limit exceeded" },
    { status: 429 },
  );
  res.headers.set("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  return applySecurityHeaders(res, nonce);
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

function redirectToLogin(req: NextRequest, nonce: string): NextResponse {
  const url = req.nextUrl.clone();
  const original = req.nextUrl.pathname + req.nextUrl.search;
  url.pathname = "/login";
  url.search = original && original !== "/" ? `?next=${encodeURIComponent(original)}` : "";
  const res = NextResponse.redirect(url);
  return applySecurityHeaders(res, nonce);
}

/**
 * Attach the CSP+HSTS headers to a pass-through response. Used at
 * every "request looks fine, forward it" branch of `middleware()`
 * so no navigation escapes the security-header layer.
 *
 * The nonce is copied onto the *request* headers alongside a
 * `Content-Security-Policy` mirror so:
 *   * Server Components can pick the nonce up via `headers()`.
 *   * Next.js's framework renderer can parse the `'nonce-<n>'` out
 *     of the CSP directive and auto-attach it to its own hydration
 *     inline scripts (`__next_f.push(...)`, etc.). Without the CSP
 *     header on the *request*, Next.js falls back to nonce-less
 *     framework scripts, strict-dynamic blocks them in production,
 *     hydration silently fails, and every `<Link>` click degrades to
 *     a full-page anchor navigation — which on some Android Chrome
 *     PWAs then opens the destination in a new browser tab because
 *     the router-controlled scope handoff never happened. Setting
 *     the header on both sides matches the pattern documented in
 *     the Next.js CSP guide and is the only reliable way to keep
 *     client-side navigation working under a strict CSP.
 */
function passThrough(req: NextRequest, nonce: string): NextResponse {
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  // `applySecurityHeaders` sets the CSP on the response too — same
  // policy value, so browser and Next.js renderer agree.
  return applySecurityHeaders(res, nonce);
}

export function middleware(req: NextRequest): NextResponse | undefined {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();
  const nonce = generateNonce();

  // ---- Ignored prefixes ---------------------------------------------
  // Cheap prefix check up front so we don't run any logic against
  // static assets. The matcher below already filters most of these,
  // but keeping the explicit list here makes the exclusion contract
  // grep-able and makes middleware-unit-testing straightforward.
  //
  // Ignored assets bypass CSP too — a font/image/service-worker
  // response doesn't render script and therefore doesn't need a
  // per-request nonce; leaving the static header from next.config.mjs
  // is fine.
  for (const prefix of IGNORED_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix)) return undefined;
  }

  // ---- 0a. Login brute-force throttle --------------------------------
  // /api/auth/login is unauthenticated by definition, which means the
  // general rate-limit block further down (gated on `!AUTH_ENABLED`)
  // never runs on the request path that most needs one. Apply a
  // dedicated per-IP budget here, before the UNPROTECTED_PATHS
  // early-exit, so unlimited password guessing against APP_PASSWORD is
  // impossible regardless of the app's auth mode.
  //
  // Only POSTs consume tokens; the GET-shaped preflight the browser
  // sometimes issues (or a curl -I probe) shouldn't count as a
  // credential attempt.
  if (pathname === "/api/auth/login" && method === "POST") {
    const r = rateLimit({
      bucket: "auth-login",
      key: getClientIp(req),
      capacity: LOGIN_RATE.capacity,
      refillPerSec: LOGIN_RATE.refillPerSec,
    });
    if (!r.ok) return tooManyRequests(r.retryAfterMs, nonce);
  }

  // ---- 0. Unprotected probe / auth endpoints -------------------------
  // Healthcheck must succeed even when APP_TOKEN is set, otherwise
  // Docker marks the container unhealthy on boot and enters a restart
  // loop. The login endpoint must be reachable so users can obtain a
  // cookie in the first place; the status endpoint answers "is auth
  // needed?" for the login page without leaking any secret.
  //
  // These still get the CSP+HSTS layer (login page renders inline
  // scripts too).
  if (UNPROTECTED_PATHS.has(pathname)) return passThrough(req, nonce);
  if (UNPROTECTED_PAGES.has(pathname)) return passThrough(req, nonce);

  // ---- 1. Optional session check (covers /api/* AND page routes) ----
  // When APP_TOKEN (or APP_USERNAME+APP_PASSWORD) is configured, we
  // require every non-whitelisted request to present a matching cookie
  // or Authorization: Bearer header. For API calls we still return
  // JSON 401 (scripts / fetches want a machine-readable error). For
  // page navigations we redirect to /login so the browser experience
  // is "click link → sign in → land on the intended page".
  //
  // `validatePresentedSecret` is the same primitive used by the login
  // endpoint to gate cookie issuance, so there is exactly one place in
  // the codebase that decides what "signed in" means.
  if (AUTH_ENABLED) {
    const presented = extractToken(req);
    if (!presented || !validatePresentedSecret(presented)) {
      if (isPageRequest(req)) return redirectToLogin(req, nonce);
      return unauthorized(
        presented ? "Invalid credentials" : "Missing credentials",
        nonce,
      );
    }
  }

  // Below this point we only apply the CSRF + rate-limit guards to
  // /api/* — those don't make sense for regular page GETs. Pages
  // still get the security-headers layer.
  if (!pathname.startsWith("/api/")) return passThrough(req, nonce);

  // ---- 2. Same-origin CSRF check on mutations ------------------------
  if (MUTATION_METHODS.has(method)) {
    if (!isSameOrigin(req)) {
      return forbidden("Cross-origin request rejected", nonce);
    }
  }

  // ---- 3. Rate limiting (anonymous only — authenticated callers get
  // implicit trust because they proved knowledge of the shared secret) --
  if (!AUTH_ENABLED) {
    const ip = getClientIp(req);

    // Broad mutation limit.
    if (MUTATION_METHODS.has(method) && RATE_LIMITED_MUTATION_PATHS.test(pathname)) {
      const r = rateLimit({
        bucket: "mutation",
        key: ip,
        capacity: MUTATION_RATE.capacity,
        refillPerSec: MUTATION_RATE.refillPerSec,
      });
      if (!r.ok) return tooManyRequests(r.retryAfterMs, nonce);
    }

    // Search endpoint fans out to SEC — tighter budget.
    if (pathname === "/api/portfolios/search") {
      const r = rateLimit({
        bucket: "search",
        key: ip,
        capacity: SEARCH_RATE.capacity,
        refillPerSec: SEARCH_RATE.refillPerSec,
      });
      if (!r.ok) return tooManyRequests(r.retryAfterMs, nonce);
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
      if (!r.ok) return tooManyRequests(r.retryAfterMs, nonce);
    }
  }

  return passThrough(req, nonce);
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
