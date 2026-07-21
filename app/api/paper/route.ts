/**
 * Paper trading ledger endpoint, scoped to one portfolio.
 *
 * Multi-portfolio contract (v15+):
 *
 *   * Every request carries a `portfolioId` — GET as `?portfolioId=`,
 *     POST/PATCH in the JSON body. When missing/invalid, we fall
 *     back to the first active portfolio (helps first-time clients
 *     with no persisted `activePortfolioId` yet) and reflect that
 *     choice in the response's `valuation.portfolioId`. The client
 *     is expected to save that resolved id and keep it in sync.
 *
 *   * DELETE has two modes:
 *       * `?scope=trades` (default) — reset THIS portfolio's cash +
 *         trades to starting cash, keeping the portfolio row.
 *       * `?scope=portfolio` — hard-delete the portfolio itself. Use
 *         `/api/paper/portfolios` for this instead; kept here as a
 *         compat shim would just confuse the picker's cache.
 *     The default preserves the pre-multi-portfolio semantics
 *     ("reset button" wipes the ledger, doesn't destroy the account).
 *
 *   * Portfolios collection CRUD lives at
 *     `/api/paper/portfolios/route.ts` — this route intentionally
 *     doesn't create or rename portfolios so the two responsibility
 *     zones stay separate.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  evaluateTargets,
  getPortfolio,
  listPortfolios,
  placeOrder,
  recentTrades,
  resetPortfolio,
  setPositionTargets,
  valuePortfolio,
  type PortfolioSummary,
  type TriggerEvent,
} from "@/lib/paper-trading";
import { computePaperAnalytics } from "@/lib/paper-analytics";
import { fetchQuote } from "@/lib/data";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve the request's `portfolioId`. Falls back to the first active
 * portfolio when the caller supplied nothing (or an invalid id that
 * doesn't exist in the DB). Returns `null` when there are zero
 * portfolios — the v15 migration seeds one so this only happens if the
 * user has deliberately deleted everything via direct SQL access
 * (impossible via the UI: `deletePortfolio` refuses the last one).
 */
function resolvePortfolioId(
  requested: number | null,
  all: PortfolioSummary[],
): number | null {
  if (all.length === 0) return null;
  if (requested !== null) {
    const match = all.find((p) => p.id === requested);
    if (match) return match.id;
  }
  return all[0]!.id;
}

const orderSchema = z.object({
  portfolioId: z.number().int().positive(),
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
  portfolioId: z.number().int().positive(),
  symbol: z
    .string()
    .min(1)
    .max(12)
    .regex(/^[A-Za-z0-9.\-]+$/, "symbol must be alphanumeric with `.` or `-`"),
  stopLoss: z.number().positive().finite().nullable().optional(),
  takeProfit: z.number().positive().finite().nullable().optional(),
});

const resetSchema = z.object({
  portfolioId: z.number().int().positive(),
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

export async function GET(req: Request) {
  const all = listPortfolios();
  const url = new URL(req.url);
  const requestedRaw = url.searchParams.get("portfolioId");
  const requested = requestedRaw && /^\d+$/.test(requestedRaw)
    ? Number(requestedRaw)
    : null;
  const portfolioId = resolvePortfolioId(requested, all);
  if (portfolioId === null) {
    // Extremely defensive: only reachable if manual SQL wiped the
    // seeded portfolio. Report a clean 500 instead of throwing.
    return NextResponse.json(
      { error: "No portfolios exist" },
      { status: 500 },
    );
  }
  try {
    getPortfolio(portfolioId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Portfolio not found" },
      { status: 404 },
    );
  }

  // Two-phase evaluation: (1) fetch live prices for currently-held symbols,
  // (2) fire any triggered SL/TP guards (which will DELETE / mutate the
  // position rows), (3) refetch the portfolio + trades so the response
  // reflects the post-trigger state. Same shape as pre-v15 GET, just
  // scoped by `portfolioId` from here on.
  const initial = getPortfolio(portfolioId);
  const prices = await fetchLivePrices(initial.positions.map((p) => p.symbol));

  let triggered: TriggerEvent[] = [];
  try {
    triggered = evaluateTargets(portfolioId, prices);
  } catch (err) {
    // A failing trigger shouldn't blank the whole page — swallow and
    // continue. The next GET will retry naturally. Log at error level
    // so a *catastrophic* failure of the guard system (as opposed to
    // the per-position benign races already logged inside
    // evaluateTargets) surfaces in production logs instead of hiding.
    console.error(
      `[api/paper] evaluateTargets threw for portfolio=${portfolioId}:`,
      err,
    );
    triggered = [];
  }

  const trades = recentTrades(portfolioId, 500);
  const analytics = computePaperAnalytics(trades);

  return NextResponse.json({
    portfolios: all,
    activePortfolioId: portfolioId,
    valuation: valuePortfolio(portfolioId, prices),
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
    const trade = placeOrder(body.portfolioId, {
      symbol: body.symbol,
      side: body.side,
      shares: body.shares,
      price: body.price,
      note: body.note,
      stopLoss: body.stopLoss,
      takeProfit: body.takeProfit,
    });
    return NextResponse.json({ ok: true, trade });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = targetSchema.parse(await req.json());
    const position = setPositionTargets(body.portfolioId, {
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
    const body = raw ? resetSchema.parse(JSON.parse(raw)) : null;
    if (!body) {
      // Backward-compat behaviour: refuse a bare DELETE. The pre-v15
      // client sent an empty body and expected "reset the singleton"
      // to Just Work; that ambiguity now maps to a clear 400 so the
      // new client is nudged to include portfolioId.
      return NextResponse.json(
        { ok: false, error: "portfolioId is required" },
        { status: 400 },
      );
    }
    resetPortfolio(body.portfolioId, body.startingCash);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}
