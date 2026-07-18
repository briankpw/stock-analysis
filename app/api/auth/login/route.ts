/**
 * POST /api/auth/login
 *
 * Exchanges caller-supplied credentials for an httpOnly `app_token`
 * session cookie. Two flavours of body payload are accepted, keyed by
 * the server's `authMode()`:
 *
 *   * credentials mode: `{ username, password }` — validated against
 *                       APP_USERNAME / APP_PASSWORD.
 *   * token mode:       `{ token }` — validated against APP_TOKEN.
 *
 * The cookie always carries `expectedSecret()`, which is the same
 * string the middleware compares presented tokens against. So the
 * decision of "what counts as a valid session" lives in exactly one
 * module (`lib/auth.ts`).
 *
 * Whitelisted by middleware.ts so callers can hit it without already
 * being authenticated (otherwise we'd have a chicken-and-egg problem).
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { redactError } from "@/lib/http";
import {
  authMode,
  expectedSecret,
  validateCredentials,
  validateToken,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CREDENTIALS_SCHEMA = z.object({
  username: z.string().min(1).max(120),
  password: z.string().min(1).max(512),
});

const TOKEN_SCHEMA = z.object({
  token: z.string().min(1).max(512),
});

// Two weeks of validity — long enough that the operator isn't retyping
// credentials every day, short enough that a stolen cookie has a
// natural expiry. Operators wanting anything else can override in a
// reverse proxy (Traefik forward-auth, nginx `proxy_cookie_flags`, …).
const COOKIE_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

export async function POST(req: Request) {
  try {
    const mode = authMode();
    if (mode === "none") {
      return NextResponse.json(
        { ok: false, error: "Authentication is not configured on this server" },
        { status: 400 },
      );
    }

    const body = (await req.json()) as unknown;
    let ok = false;

    if (mode === "credentials") {
      const parsed = CREDENTIALS_SCHEMA.parse(body);
      ok = validateCredentials(parsed.username.trim(), parsed.password);
    } else {
      // mode === "token"
      const parsed = TOKEN_SCHEMA.parse(body);
      ok = validateToken(parsed.token.trim());
    }

    if (!ok) {
      return NextResponse.json(
        { ok: false, error: "Invalid credentials" },
        { status: 401 },
      );
    }

    // Cookie `Secure` decision — this is trickier than it looks behind
    // a reverse proxy.
    //
    // `req.url` shows the URL the *Next server* received, not what the
    // browser typed. A typical production topology (Traefik / nginx
    // terminates TLS, forwards `http://internal:3000` to the
    // container) means `req.url` starts with `http:` even though the
    // *actual* client connection is HTTPS — so the naive
    // `req.url.startsWith("https:")` heuristic silently strips the
    // `Secure` flag from every session cookie, letting a passive
    // network attacker replay the cookie over HTTP.
    //
    // Prefer the (proxy-controlled) `x-forwarded-proto` header when
    // present. As a belt-and-braces measure we also force `secure=true`
    // in production regardless, because a production deployment
    // serving HTTP is an operator misconfiguration that should surface
    // as "cookie won't stick over plain HTTP" rather than "cookie
    // works but leaks on the wire".
    const forwardedProto =
      req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() ??
      "";
    const urlProto = (() => {
      try {
        return new URL(req.url).protocol;
      } catch {
        return "";
      }
    })();
    const isHttps = forwardedProto === "https" || urlProto === "https:";
    const isProd = process.env.NODE_ENV === "production";
    if (isProd && !isHttps) {
      // Surface the misconfiguration in operator logs (the response is
      // still 200 so the login flow doesn't break silently — but the
      // cookie WILL still carry `Secure`, so a plain-HTTP client will
      // fail to persist it on the very next request, which is exactly
      // the signal the operator needs to fix their proxy chain).
      console.warn(
        "[auth/login] production request over non-HTTPS transport — " +
          "forcing Secure cookie anyway; check your reverse-proxy " +
          "x-forwarded-proto configuration.",
      );
    }
    const secure = isHttps || isProd;
    const res = NextResponse.json({ ok: true });
    res.cookies.set({
      name: "app_token",
      value: expectedSecret(),
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });
    return res;
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}
