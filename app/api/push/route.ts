import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getVapidKeys,
  validatePushEndpoint,
  webPushConfigured,
} from "@/lib/bot/webpush";
import { testWebPush } from "@/lib/bot/notifier";
import {
  listPushSubscriptions,
  pushSubscriberCount,
  removePushSubscription,
  upsertPushSubscription,
} from "@/lib/bot/push-store";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Web Push admin endpoint.
 *
 *   GET  — returns the VAPID public key + list of registered devices
 *   POST — actions: subscribe / unsubscribe / test
 *
 * The public key is safe to expose — VAPID puts the confidentiality on
 * the private key which stays server-side (env override or `bot_state`).
 */

const bodySchema = z.union([
  z.object({
    action: z.literal("subscribe"),
    subscription: z.object({
      endpoint: z.string().url(),
      keys: z.object({
        p256dh: z.string().min(1),
        auth: z.string().min(1),
      }),
    }),
    label: z.string().max(80).optional(),
    // Some enterprise / mobile UAs exceed 250 chars — 400 leaves 2×
    // headroom without opening the door to unbounded strings.
    userAgent: z.string().max(400).optional(),
  }),
  z.object({
    action: z.literal("unsubscribe"),
    endpoint: z.string().url(),
  }),
  z.object({ action: z.literal("test") }),
]);

export async function GET() {
  try {
    // Reading the key also lazily generates + persists the pair on first
    // boot — so a fresh install works with zero env config.
    const keys = await getVapidKeys();
    const subs = listPushSubscriptions().map((s) => ({
      endpoint: s.endpoint,
      label: s.label,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
    }));
    return NextResponse.json({
      configured: webPushConfigured(),
      publicKey: keys.publicKey,
      subject: keys.subject,
      subscriberCount: pushSubscriberCount(),
      subscriptions: subs,
    });
  } catch (e) {
    const r = redactError(e, 500);
    return NextResponse.json({ error: r.message }, { status: r.status });
  }
}

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());
    if (body.action === "subscribe") {
      // SSRF guard — refuse to persist anything the server would then
      // POST authenticated payloads to unless it's clearly a real push
      // service. `validatePushEndpoint` enforces https:// + known-host
      // allow-list + no IP literals. We do NOT echo the endpoint back
      // in the error body (it's attacker-controlled); the reason is
      // safe to surface because it's from a static enum.
      const check = validatePushEndpoint(body.subscription.endpoint);
      if (!check.ok) {
        // Log server-side so an operator can trace attempted abuse —
        // the endpoint IS sensitive here (may leak internal IPs of
        // whoever tried to register it) so we redact to the reason
        // + hostname only in the log, and never in the response body.
        let hostForLog = "invalid";
        try {
          hostForLog = new URL(body.subscription.endpoint).hostname || "invalid";
        } catch { /* keep placeholder */ }
        console.warn(
          `[api/push] rejected subscribe: ${check.reason} (host=${hostForLog})`,
        );
        return NextResponse.json(
          { ok: false, error: `Push endpoint rejected: ${check.reason}` },
          { status: 400 },
        );
      }
      // Prefer the client-supplied user agent over the request header
      // when present — the header can be spoofed by proxies and the
      // client already has to run navigator.userAgent to render the
      // label anyway.
      const ua =
        body.userAgent ?? req.headers.get("user-agent") ?? null;
      const stored = upsertPushSubscription(body.subscription, {
        label: body.label ?? null,
        userAgent: ua,
      });
      return NextResponse.json({
        ok: true,
        subscription: {
          endpoint: stored.endpoint,
          label: stored.label,
          createdAt: stored.createdAt,
        },
      });
    }
    if (body.action === "unsubscribe") {
      const removed = removePushSubscription(body.endpoint);
      return NextResponse.json({ ok: true, removed });
    }
    // action === "test"
    const res = await testWebPush();
    return NextResponse.json({ ok: res.ok, detail: res.detail });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}
