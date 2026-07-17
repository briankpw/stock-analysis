import { NextResponse } from "next/server";
import { z } from "zod";
import { runTick } from "@/lib/bot/engine";
import { testConnection } from "@/lib/bot/notifier";
import {
  clearHistory,
  DEFAULT_ACTIVE_STRATEGIES,
  getState,
  recentSignals,
  setState,
  STATE_KEYS,
} from "@/lib/bot/store";
import { STRATEGIES, type StrategyKey } from "@/lib/bot/strategy";
import { settings, telegramConfigured } from "@/lib/config";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CFG_STRAT_KEYS = Object.keys(STRATEGIES) as StrategyKey[];

const configSchema = z.object({
  action: z.enum(["set-enabled", "set-strategies", "run-tick", "test", "clear-history"]),
  enabled: z.boolean().optional(),
  strategies: z.array(z.enum(CFG_STRAT_KEYS as [StrategyKey, ...StrategyKey[]])).optional(),
  ticker: z.string().optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker") ?? null;

  return NextResponse.json({
    enabled: getState<boolean>(STATE_KEYS.ENABLED, true),
    activeStrategies: getState<StrategyKey[]>(STATE_KEYS.ACTIVE_STRATEGIES, DEFAULT_ACTIVE_STRATEGIES),
    availableStrategies: CFG_STRAT_KEYS,
    lastTickAt: getState<string | null>(STATE_KEYS.LAST_TICK_AT, null),
    lastTickStatus: getState(STATE_KEYS.LAST_TICK_STATUS, null),
    telegramConfigured: telegramConfigured(),
    signals: recentSignals(ticker, 50),
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
      case "set-strategies":
        setState(STATE_KEYS.ACTIVE_STRATEGIES, body.strategies ?? DEFAULT_ACTIVE_STRATEGIES);
        return NextResponse.json({ ok: true });
      case "run-tick": {
        const t = (body.ticker ?? settings.ticker).toUpperCase();
        const report = await runTick(t);
        return NextResponse.json({ ok: true, report });
      }
      case "test": {
        const res = await testConnection();
        return NextResponse.json({ ok: res.ok, detail: res.detail });
      }
      case "clear-history": {
        const t = body.ticker?.toUpperCase();
        const removed = clearHistory(t);
        return NextResponse.json({ ok: true, removed });
      }
    }
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}
