/**
 * CRUD for portfolio-watch rules.
 *
 * GET               — list every active watch
 * POST { kind, ... } — upsert (person or ticker)
 * DELETE ?id=       — delete by watch id (from the row)
 * DELETE ?kind=person&category=&presetId= — delete by person tuple
 * DELETE ?kind=ticker&ticker=              — delete by ticker
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ALL_ACTIONS,
  deletePersonWatch,
  deleteTickerWatch,
  deleteWatch,
  listWatches,
  upsertPersonWatch,
  upsertTickerWatch,
} from "@/lib/portfolio-watch/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.enum(["BUY", "SELL"]);
const categorySchema = z.enum(["people", "politicians", "funds"]);

const upsertSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("person"),
    category: categorySchema,
    presetId: z.string().min(1),
    actions: z.array(actionSchema).min(1).optional(),
  }),
  z.object({
    kind: z.literal("ticker"),
    ticker: z.string().min(1).max(12),
    actions: z.array(actionSchema).min(1).optional(),
  }),
]);

export async function GET() {
  return NextResponse.json({ watches: listWatches() });
}

export async function POST(req: Request) {
  try {
    const body = upsertSchema.parse(await req.json());
    const actions = body.actions ?? ALL_ACTIONS;
    const watch =
      body.kind === "person"
        ? upsertPersonWatch(body.category, body.presetId, actions)
        : upsertTickerWatch(body.ticker, actions);
    return NextResponse.json({ ok: true, watch });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const rawId = url.searchParams.get("id");
  const kind = url.searchParams.get("kind");
  try {
    if (rawId) {
      const id = Number(rawId);
      if (!Number.isFinite(id)) throw new Error("Invalid id");
      const ok = deleteWatch(id);
      return NextResponse.json({ ok });
    }
    if (kind === "person") {
      const category = url.searchParams.get("category");
      const presetId = url.searchParams.get("presetId");
      if (!category || !presetId) throw new Error("category+presetId required");
      const parsed = categorySchema.parse(category);
      const ok = deletePersonWatch(parsed, presetId);
      return NextResponse.json({ ok });
    }
    if (kind === "ticker") {
      const ticker = url.searchParams.get("ticker");
      if (!ticker) throw new Error("ticker required");
      const ok = deleteTickerWatch(ticker);
      return NextResponse.json({ ok });
    }
    throw new Error("Missing id or kind+key params");
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
}
