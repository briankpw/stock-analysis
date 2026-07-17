/**
 * POST /api/auth/login
 *
 * Exchanges a caller-supplied `APP_TOKEN` value for an httpOnly session
 * cookie. The cookie is what the middleware then checks on every
 * subsequent request — so the UI page loads work seamlessly after
 * one login.
 *
 * Whitelisted by middleware.ts so callers can hit it without already
 * being authenticated (otherwise we'd have a chicken-and-egg problem).
 *
 * Security posture:
 *   * Rate-limited by the middleware's `mutation` bucket. A missing
 *     APP_TOKEN env means there's nothing to authenticate against;
 *     the route returns 400 (not 401) so operators can tell "no auth
 *     configured" from "wrong password".
 *   * The response is a deliberate constant-time-ish comparison to
 *     avoid trivial timing side-channels — we compare full string
 *     equality with an early length check.
 *   * Cookie is `HttpOnly` (unreadable from JS), `SameSite=Lax`
 *     (survives top-level navigation but not cross-site fetches),
 *     `Path=/`, and `Secure` when the incoming URL is https so a
 *     downgrade attack can't leak it.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOGIN_SCHEMA = z.object({
  token: z.string().min(1).max(512),
});

// Two weeks of validity — long enough that the operator isn't retyping
// the token every day, short enough that a stolen cookie has a natural
// expiry. Operators wanting anything else can override in a reverse
// proxy (Traefik forward-auth, nginx `proxy_cookie_flags`, etc.).
const COOKIE_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: Request) {
  try {
    const expected = process.env.APP_TOKEN?.trim() || "";
    if (!expected) {
      return NextResponse.json(
        { ok: false, error: "APP_TOKEN is not configured on this server" },
        { status: 400 },
      );
    }

    const body = LOGIN_SCHEMA.parse(await req.json());
    if (!safeEqual(body.token.trim(), expected)) {
      return NextResponse.json(
        { ok: false, error: "Invalid token" },
        { status: 401 },
      );
    }

    const isHttps = new URL(req.url).protocol === "https:";
    const res = NextResponse.json({ ok: true });
    res.cookies.set({
      name: "app_token",
      value: expected,
      httpOnly: true,
      sameSite: "lax",
      secure: isHttps,
      path: "/",
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });
    return res;
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}
