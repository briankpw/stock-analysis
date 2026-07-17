/**
 * Liveness / readiness probe.
 *
 * Deliberately minimal:
 *
 *   * No database open — a cold container should be able to answer this
 *     before `getDb()` has finished the schema/migration bootstrap. That
 *     keeps `HEALTHCHECK --start-period=…` short.
 *   * No external calls — Yahoo / SEC / CNN outages must not flip the
 *     container to "unhealthy" and trigger a restart loop.
 *   * Not gated by the middleware (see `middleware.ts` — `/api/health`
 *     is explicitly whitelisted from auth / CSRF / rate-limit so Docker's
 *     `wget` probe works even when `APP_TOKEN` is set).
 *
 * If you need a deeper readiness check that verifies the DB is writable,
 * add a separate `/api/ready` route and probe that from k8s / Portainer
 * once you actually run those platforms.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { status: "ok", uptimeSeconds: Math.floor(process.uptime()) },
    { status: 200 },
  );
}

export async function HEAD() {
  return new NextResponse(null, { status: 200 });
}
