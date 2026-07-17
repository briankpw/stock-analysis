/**
 * CRUD for per-ticker news subscriptions.
 *
 * GET                      — list every subscription
 * POST { ticker }          — subscribe; silent-seeds the current news
 *                            into `news_items` so the first tick doesn't
 *                            Telegram-blast the initial batch.
 * DELETE ?ticker=SYMBOL    — unsubscribe (does not clear accumulated news)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteNewsSubscription,
  listNewsSubscriptions,
  upsertNewsSubscription,
} from "@/lib/news-watch/store";
import { seedNewsHistory } from "@/lib/news-watch/engine";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const upsertSchema = z.object({
  ticker: z
    .string()
    .min(1)
    .max(12)
    .regex(/^[A-Za-z0-9.\-]+$/, "ticker must be alphanumeric with `.-`"),
});

export async function GET() {
  return NextResponse.json({ subscriptions: listNewsSubscriptions() });
}

export async function POST(req: Request) {
  try {
    const body = upsertSchema.parse(await req.json());
    const sub = upsertNewsSubscription(body.ticker);
    // Silent seed. Failures here (e.g. rate-limit) are non-fatal —
    // the next background tick will retry.
    let seeded: { inserted: number; total: number } = { inserted: 0, total: 0 };
    try {
      seeded = await seedNewsHistory(sub.ticker);
    } catch {
      /* swallow — subscription was created; seed can retry on tick */
    }
    return NextResponse.json({ ok: true, subscription: sub, seeded });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get("ticker");
  try {
    if (!ticker) throw new Error("ticker required");
    const ok = deleteNewsSubscription(ticker);
    return NextResponse.json({ ok });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}
