import { NextResponse } from "next/server";
import { z } from "zod";
import {
  addCustomFund,
  addCustomPerson,
  addCustomPolitician,
  removeCustomPreset,
} from "@/lib/portfolio-presets";
import { listPresets } from "@/lib/portfolios";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Custom "portfolios" preset CRUD. GET the merged (built-in + custom)
 * index from `/api/portfolios` (no `type` query) — this route is just for
 * mutations against the user-added rows.
 *
 *   POST   /api/portfolios/presets              body: { category, preset }
 *   DELETE /api/portfolios/presets?category=&id=
 */

const politicianSchema = z.object({
  id: z.string().min(1).max(48).regex(/^[a-z0-9_-]+$/i, "id must be alphanumeric + `_-`"),
  name: z.string().min(1).max(80),
  chamber: z.enum(["House", "Senate"]),
  party: z.enum(["D", "R", "I"]),
  role: z.string().max(80).optional(),
});
const fundSchema = z.object({
  id: z.string().min(1).max(48).regex(/^[a-z0-9_-]+$/i, "id must be alphanumeric + `_-`"),
  manager: z.string().min(1).max(80),
  firm: z.string().min(1).max(120),
  cik: z.string().regex(/^\d{10}$/, "cik must be 10 zero-padded digits"),
  note: z.string().max(200).optional(),
});
const personSchema = z.object({
  id: z.string().min(1).max(48).regex(/^[a-z0-9_-]+$/i, "id must be alphanumeric + `_-`"),
  name: z.string().min(1).max(80),
  role: z.string().min(1).max(120),
  cik: z.string().regex(/^\d{10}$/, "cik must be 10 zero-padded digits"),
  note: z.string().max(200).optional(),
});

const addSchema = z.discriminatedUnion("category", [
  z.object({ category: z.literal("politician"), preset: politicianSchema }),
  z.object({ category: z.literal("fund"), preset: fundSchema }),
  z.object({ category: z.literal("person"), preset: personSchema }),
]);

export async function POST(req: Request) {
  try {
    const body = addSchema.parse(await req.json());
    switch (body.category) {
      case "politician":
        addCustomPolitician(body.preset);
        break;
      case "fund":
        addCustomFund(body.preset);
        break;
      case "person":
        addCustomPerson(body.preset);
        break;
    }
    return NextResponse.json({ ok: true, index: listPresets() });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  const id = url.searchParams.get("id");
  if (category !== "politician" && category !== "fund" && category !== "person") {
    return NextResponse.json(
      { ok: false, error: "category must be one of politician|fund|person" },
      { status: 400 },
    );
  }
  if (!id) {
    return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  }
  try {
    removeCustomPreset(category, id);
    return NextResponse.json({ ok: true, index: listPresets() });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json({ ok: false, error: r.message }, { status: r.status });
  }
}
