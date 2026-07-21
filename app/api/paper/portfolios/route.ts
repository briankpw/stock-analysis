/**
 * Portfolios collection endpoint for paper trading. Companion to
 * `/api/paper/route.ts` — this route owns the LIFECYCLE of portfolios
 * (create / rename / delete / list), while `/api/paper` owns the
 * trading ledger scoped to one portfolio.
 *
 * Design decisions:
 *
 *   * The list endpoint returns bare `PortfolioSummary` (no positions
 *     or trades) so the picker can hydrate fast — full portfolio state
 *     is fetched by `/api/paper?portfolioId=…`. Two queries with
 *     zero-duplication scopes each render exactly one UI zone.
 *
 *   * DELETE guards against removing the LAST portfolio (the paper
 *     page requires at least one row exists to render). Enforced in
 *     `lib/paper-trading.ts::deletePortfolio()` so any future caller
 *     (backtest import, worker, migration tool) gets the same
 *     protection.
 *
 *   * We deliberately don't expose a bulk-import endpoint here — the
 *     backtest materialisation path (create + import trades) is
 *     covered by POST on this route with an optional `trades` array,
 *     keeping the "create a portfolio from a simulation" flow to one
 *     round-trip and one transaction boundary.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createPortfolio,
  deletePortfolio,
  importTrades,
  listPortfolios,
  renamePortfolio,
} from "@/lib/paper-trading";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nameSchema = z
  .string()
  .min(1)
  .max(60)
  // Server-side length + character validation is duplicated in
  // `normalisePortfolioName` (defence in depth) — the Zod check
  // catches the 99% of malformed inputs before they hit the DB.
  .transform((s) => s.trim());

const createSchema = z.object({
  name: nameSchema,
  startingCash: z.number().positive().finite().optional(),
  /**
   * When provided, the new portfolio is seeded by replaying these trades
   * chronologically via `importTrades()`. Used by the backtest
   * "materialise as paper portfolio" flow. Empty array is treated the
   * same as omitting the field (creates a blank portfolio).
   */
  trades: z
    .array(
      z.object({
        symbol: z
          .string()
          .min(1)
          .max(12)
          .regex(/^[A-Za-z0-9.\-]+$/, "symbol must be alphanumeric with `.` or `-`"),
        side: z.enum(["buy", "sell"]),
        shares: z.number().positive().finite(),
        price: z.number().positive().finite(),
        commission: z.number().nonnegative().finite().optional(),
        note: z.string().max(500).nullable().optional(),
        createdAt: z
          .string()
          .datetime({ offset: true })
          .or(z.string().datetime()),
      }),
    )
    .max(10_000, "Too many trades in a single import")
    .optional(),
});

const patchSchema = z.object({
  id: z.number().int().positive(),
  name: nameSchema,
});

const deleteSchema = z.object({
  id: z.number().int().positive(),
});

export async function GET() {
  const portfolios = listPortfolios();
  return NextResponse.json({ portfolios });
}

export async function POST(req: Request) {
  try {
    const body = createSchema.parse(await req.json());
    const created = createPortfolio({
      name: body.name,
      startingCash: body.startingCash,
    });
    let importSummary: { insertedCount: number; finalCash: number } | null = null;
    if (body.trades && body.trades.length > 0) {
      importSummary = importTrades(
        created.id,
        body.trades.map((t) => ({
          symbol: t.symbol,
          side: t.side,
          shares: t.shares,
          price: t.price,
          commission: t.commission ?? 0,
          note: t.note ?? null,
          createdAt: t.createdAt,
        })),
      );
    }
    return NextResponse.json({ ok: true, portfolio: created, imported: importSummary });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = patchSchema.parse(await req.json());
    const updated = renamePortfolio(body.id, body.name);
    return NextResponse.json({ ok: true, portfolio: updated });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}

export async function DELETE(req: Request) {
  try {
    // Accept the id either in the query string (`?id=`) or the body,
    // matching how the client-side `useSWR` helper prefers to send
    // it (body for POST/PATCH, query for DELETE).
    const url = new URL(req.url);
    const queryId = url.searchParams.get("id");
    let id: number;
    if (queryId) {
      const parsed = Number(queryId);
      const validated = deleteSchema.parse({ id: parsed });
      id = validated.id;
    } else {
      const raw = await req.text();
      const parsed = raw ? deleteSchema.parse(JSON.parse(raw)) : null;
      if (!parsed) throw new Error("id is required");
      id = parsed.id;
    }
    deletePortfolio(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}
