/**
 * POST /api/auth/logout
 *
 * Clears the `app_token` cookie. Requires an existing valid token
 * (middleware guards this route the same as any other /api/* mutation),
 * so a drive-by cannot log a real user out.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: "app_token",
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
