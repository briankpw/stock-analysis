import { NextResponse } from "next/server";
import { z } from "zod";
import { getPortfolio, placeOrder, recentTrades, resetPortfolio, valuePortfolio } from "@/lib/paper-trading";
import { fetchQuote } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const orderSchema = z.object({
  symbol: z.string().min(1).max(20),
  side: z.enum(["buy", "sell"]),
  shares: z.number().positive(),
  price: z.number().positive(),
  note: z.string().max(500).optional(),
});

const resetSchema = z.object({
  startingCash: z.number().positive().optional(),
});

export async function GET() {
  const portfolio = getPortfolio();
  const trades = recentTrades(50);

  // Look up live prices for every held symbol so the UI can render P&L.
  const prices: Record<string, number | null> = {};
  await Promise.all(
    portfolio.positions.map(async (p) => {
      try {
        const q = await fetchQuote(p.symbol);
        prices[p.symbol] = q.price ?? null;
      } catch {
        prices[p.symbol] = null;
      }
    }),
  );

  return NextResponse.json({
    valuation: valuePortfolio(prices),
    trades,
  });
}

export async function POST(req: Request) {
  try {
    const body = orderSchema.parse(await req.json());
    const trade = placeOrder(body);
    return NextResponse.json({ ok: true, trade });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    // Body optional — accept `{ startingCash }` to override the reset value.
    const raw = await req.text();
    const body = raw ? resetSchema.parse(JSON.parse(raw)) : {};
    resetPortfolio(body.startingCash);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
