/**
 * GET /api/auth/status
 *
 * Cheap "is auth configured, am I authenticated, which form should I
 * show" probe. Used by:
 *
 *   * The login page — to decide between the credentials form and the
 *     legacy token form, and to auto-redirect an already-signed-in
 *     visitor away from /login.
 *   * The sidebar's <AuthStatus /> widget — to decide whether to render
 *     the "Sign out" button.
 *
 * Middleware treats this as unprotected (like /api/health) so it
 * always answers — otherwise the UI can't tell "no auth needed" from
 * "wrong credentials".
 */

import { NextResponse, type NextRequest } from "next/server";
import { authMode, authRequired, validatePresentedSecret } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const required = authRequired();
  const mode = authMode();
  const presented = req.cookies.get("app_token")?.value?.trim() || "";
  const authenticated = required
    ? Boolean(presented) && validatePresentedSecret(presented)
    : true;
  return NextResponse.json({ required, authenticated, mode });
}
