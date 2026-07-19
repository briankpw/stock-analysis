import { NextResponse } from "next/server";
import { z } from "zod";
import { testConnection } from "@/lib/bot/notifier";
import { getState, setState, STATE_KEYS } from "@/lib/bot/store";
import { settings, telegramConfigured } from "@/lib/config";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bot control endpoint.
 *
 * Now a tiny surface: the worker loop is on/off, and the user can
 * send a Telegram test message. Everything else — per-ticker signal
 * subscriptions, portfolio watches, insider watches, news, portfolio
 * risk — lives in its own route with its own hook/UI.
 *
 * (Historically this route also exposed `set-strategies`, `run-tick`,
 * and `clear-history` for the legacy SMA/RSI/MACD strategy tick. That
 * tick was retired in July 2026 — see the comment in
 * `lib/bot/engine.ts` for the rationale.)
 */

const configSchema = z.object({
  action: z.enum(["set-enabled", "test"]),
  enabled: z.boolean().optional(),
});

export async function GET() {
  return NextResponse.json({
    enabled: getState<boolean>(STATE_KEYS.ENABLED, true),
    lastTickAt: getState<string | null>(STATE_KEYS.LAST_TICK_AT, null),
    telegramConfigured: telegramConfigured(),
    pollIntervalSeconds: settings.bot.pollIntervalSeconds,
  });
}

export async function POST(req: Request) {
  try {
    const body = configSchema.parse(await req.json());
    switch (body.action) {
      case "set-enabled":
        setState(STATE_KEYS.ENABLED, body.enabled ?? true);
        return NextResponse.json({ ok: true });
      case "test": {
        const res = await testConnection();
        return NextResponse.json({ ok: res.ok, detail: res.detail });
      }
    }
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}
