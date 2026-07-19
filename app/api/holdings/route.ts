import { NextResponse } from "next/server";
import { z } from "zod";

import { redactError } from "@/lib/http";
import {
  clearHoldings,
  listHoldingsSnapshot,
  mergeHoldings,
  replaceHoldings,
} from "@/lib/holdings-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/api/holdings` — server-side sync for the user's imported portfolio.
 *
 * Prior to this route the CSV upload lived in browser localStorage
 * only, which meant zero cross-device sync — uploading on a laptop
 * left the phone showing nothing. Now the server is the source of
 * truth and every device pulls from GET on mount, writes through PUT
 * on every mutation.
 *
 *   GET    → { rows, meta } snapshot
 *   PUT    → { action: "replace" | "merge", rows, meta }; returns snapshot
 *   DELETE → wipe both tables
 *
 * The route deliberately mirrors the client's old in-memory API
 * surface (`setHoldings`, `mergeHoldings`, `clearHoldings`) so the
 * client-side migration is as close to a drop-in as possible.
 *
 * Payload size — a fully-imported portfolio (MSP export from a
 * long-term retail investor) can hit ~2000 rows × ~500 bytes each ≈
 * 1MB. Next.js's default 1MB body limit could bite on the largest
 * replaces, but MSP CSVs we've seen stay well under; if this ever
 * becomes real we'll add streaming batches.
 */

// ---------------------------------------------------------------------------
// Row schema — deliberately lax so a future CSV column addition on the
// client doesn't force a server-side migration. We validate the *shape*
// (keys we know how to persist) but accept unknown keys, forwarding
// them as-is inside the row JSON blob.
// ---------------------------------------------------------------------------

const rowSchema = z
  .object({
    id: z.string(),
    symbol: z.string().max(30),
    name: z.string().max(200),
    displaySymbol: z.string().nullable(),
    exchange: z.string().max(30),
    portfolio: z.string().max(120),
    currency: z.string().max(10),
    shares: z.number().finite().nullable(),
    costPerShare: z.number().finite().nullable(),
    commission: z.number().finite().nullable(),
    transactionDate: z.string().nullable(),
    transactionTime: z.string().nullable(),
    purchaseExchangeRate: z.number().finite().nullable(),
    purchaseExchangeCurrencies: z.string().nullable(),
    type: z.enum(["Buy", "Sell"]).nullable(),
    accounting: z.string().nullable(),
    accountingExecutionIds: z.string().nullable(),
    notes: z.string().nullable(),
    outgoingCashLink: z.string().nullable(),
  })
  .passthrough(); // tolerate extra columns from future CSV variants

const baseMetaSchema = z.object({
  sourceFilename: z.string().min(1).max(500),
  importedAt: z.string().min(1).max(64),
});

const putSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("replace"),
    rows: z.array(rowSchema).max(10_000),
    meta: baseMetaSchema,
  }),
  z.object({
    action: z.literal("merge"),
    rows: z.array(rowSchema).max(10_000),
    meta: baseMetaSchema,
  }),
]);

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    return NextResponse.json(listHoldingsSnapshot());
  } catch (e) {
    const r = redactError(e, 500);
    return NextResponse.json({ error: r.message }, { status: r.status });
  }
}

export async function PUT(req: Request) {
  try {
    const body = putSchema.parse(await req.json());
    if (body.action === "replace") {
      const snapshot = replaceHoldings(body.rows, body.meta);
      return NextResponse.json({ ok: true, snapshot });
    }
    // action === "merge"
    const { snapshot, report } = mergeHoldings(body.rows, body.meta);
    return NextResponse.json({ ok: true, snapshot, report });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}

export async function DELETE() {
  try {
    clearHoldings();
    return NextResponse.json({ ok: true });
  } catch (e) {
    const r = redactError(e, 500);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}
