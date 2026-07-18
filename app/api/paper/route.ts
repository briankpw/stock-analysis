import { NextResponse } from "next/server";
import { z } from "zod";
import {
  evaluateTargets,
  getPortfolio,
  placeOrder,
  recentTrades,
  resetPortfolio,
  setPositionTargets,
  valuePortfolio,
  type TriggerEvent,
} from "@/lib/paper-trading";
import { computePaperAnalytics } from "@/lib/paper-analytics";
import { fetchQuote } from "@/lib/data";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Order schema now includes optional bracket-order fields (`stopLoss` /
 * `takeProfit`). When provided on a buy, `placeOrder` attaches them to
 * the resulting position row in the same transaction — so a user can
 * open a paper trade with protective levels already wired up instead
 * of having to remember a second click after the fill.
 */
const orderSchema = z.object({
  symbol: z
    .string()
    .min(1)
    .max(12)
    .regex(/^[A-Za-z0-9.\-]+$/, "symbol must be alphanumeric with `.` or `-`"),
  side: z.enum(["buy", "sell"]),
  shares: z.number().positive().finite(),
  price: z.number().positive().finite(),
  note: z.string().max(500).optional(),
  stopLoss: z.number().positive().finite().nullable().optional(),
  takeProfit: z.number().positive().finite().nullable().optional(),
});

const targetSchema = z.object({
  symbol: z
    .string()
    .min(1)
    .max(12)
    .regex(/^[A-Za-z0-9.\-]+$/, "symbol must be alphanumeric with `.` or `-`"),
  // `null` = clear the guard. `undefined` = don't touch. We normalise both
  // to `null` on the way in — PATCH always overwrites both fields so the
  // client never has to worry about partial-update semantics.
  stopLoss: z.number().positive().finite().nullable().optional(),
  takeProfit: z.number().positive().finite().nullable().optional(),
});

const resetSchema = z.object({
  startingCash: z.number().positive().finite().optional(),
});

async function fetchLivePrices(symbols: string[]): Promise<Record<string, number | null>> {
  const prices: Record<string, number | null> = {};
  await Promise.all(
    symbols.map(async (s) => {
      try {
        const q = await fetchQuote(s);
        prices[s] = q.price ?? null;
      } catch {
        prices[s] = null;
      }
    }),
  );
  return prices;
}

export async function GET() {
  // Two-phase evaluation: (1) fetch live prices for currently-held symbols,
  // (2) fire any triggered SL/TP guards (which will DELETE / mutate the
  // position rows), (3) refetch the portfolio + trades so the response
  // reflects the post-trigger state. This keeps the guard logic on the
  // server and out of the client — the UI just renders what it gets.
  const initial = getPortfolio();
  const prices = await fetchLivePrices(initial.positions.map((p) => p.symbol));

  let triggered: TriggerEvent[] = [];
  try {
    triggered = evaluateTargets(prices);
  } catch (err) {
    // A failing trigger shouldn't blank the whole page — swallow and
    // continue. The next GET will retry naturally. Log at error level
    // so a *catastrophic* failure of the guard system (as opposed to
    // the per-position benign races already logged inside
    // evaluateTargets) surfaces in production logs instead of hiding.
    console.error("[api/paper] evaluateTargets threw:", err);
    triggered = [];
  }

  // Pull a wider trade history (500 rows) than the display cap so the
  // analytics see the full realised-P&L picture even when the visible
  // log is a subset. The client still gets the newest 500 for display,
  // and the analytics summary matches what those trades imply.
  const trades = recentTrades(500);
  const analytics = computePaperAnalytics(trades);

  return NextResponse.json({
    valuation: valuePortfolio(prices),
    trades: analytics.enrichedTrades,
    analytics: {
      portfolio: analytics.portfolio,
      perSymbol: analytics.perSymbol,
    },
    triggered: triggered.map((t) => ({
      symbol: t.symbol,
      reason: t.reason,
      level: t.level,
      price: t.price,
      tradeId: t.trade.id,
    })),
  });
}

export async function POST(req: Request) {
  try {
    const body = orderSchema.parse(await req.json());
    const trade = placeOrder(body);
    return NextResponse.json({ ok: true, trade });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = targetSchema.parse(await req.json());
    const position = setPositionTargets({
      symbol: body.symbol,
      stopLoss: body.stopLoss ?? null,
      takeProfit: body.takeProfit ?? null,
    });
    return NextResponse.json({ ok: true, position });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}

export async function DELETE(req: Request) {
  try {
    const raw = await req.text();
    const body = raw ? resetSchema.parse(JSON.parse(raw)) : {};
    resetPortfolio(body.startingCash);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}
