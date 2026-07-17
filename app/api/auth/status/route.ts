/**
 * GET /api/auth/status
 *
 * Cheap "is auth configured, am I authenticated" probe. The UI uses it
 * to decide whether to show a logout button in the sidebar and — more
 * importantly — the login page uses it to detect whether a returning
 * user with a still-valid cookie can be redirected straight to `/` on
 * page-open instead of retyping the token.
 *
 * Middleware treats this as unprotected (like /api/health) so it
 * always answers — otherwise the UI can't tell "no token needed" from
 * "wrong token".
 */

import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const expected = process.env.APP_TOKEN?.trim() || "";
  const required = Boolean(expected);
  const presented = req.cookies.get("app_token")?.value?.trim() || "";
  const authenticated = required ? presented === expected : true;
  return NextResponse.json({ required, authenticated });
}
