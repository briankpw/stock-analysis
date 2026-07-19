/**
 * User-added "portfolios" presets — Politicians / Fund managers / People
 * that the user has saved on top of the built-in seed lists in
 * `lib/portfolios.ts`. Persisted to SQLite so they survive restarts.
 *
 * The built-in list is intentionally kept separate (it's a static const
 * array) — that way custom entries never clobber the seed data, and if we
 * ever ship a change to a seeded preset the update reaches everyone.
 */

import { getDb } from "./db";
import type {
  FundPreset,
  PersonPreset,
  PoliticianPreset,
} from "./portfolios";

export type PresetCategory = "politician" | "fund" | "person";

type StoredRow = {
  id: string;
  category: PresetCategory;
  payload_json: string;
  created_at: string;
};

/**
 * Fetch all custom presets in one category. Ordered by insertion time,
 * newest first — matches the "most recently added" bias of the UI.
 */
function listCustom<T>(category: PresetCategory): T[] {
  const rows = getDb()
    .prepare(
      "SELECT id, category, payload_json, created_at FROM portfolio_presets WHERE category = ? ORDER BY created_at DESC",
    )
    .all(category) as StoredRow[];
  return rows.map((r) => JSON.parse(r.payload_json) as T);
}

export function listCustomPoliticians(): PoliticianPreset[] {
  return listCustom<PoliticianPreset>("politician");
}
export function listCustomFunds(): FundPreset[] {
  return listCustom<FundPreset>("fund");
}
export function listCustomPeople(): PersonPreset[] {
  return listCustom<PersonPreset>("person");
}

/**
 * Insert-or-replace a custom preset. Idempotent on `(category, id)`.
 * Callers should sanitize + validate before this — we do not double-check
 * shape here beyond ensuring an `id` field exists in the payload.
 */
function upsert(category: PresetCategory, preset: { id: string }): void {
  if (!preset.id || typeof preset.id !== "string") {
    throw new Error("preset.id required");
  }
  getDb()
    .prepare(
      "INSERT OR REPLACE INTO portfolio_presets (id, category, payload_json, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(preset.id, category, JSON.stringify(preset), new Date().toISOString());
}

export function addCustomPolitician(preset: PoliticianPreset): void {
  upsert("politician", preset);
}
export function addCustomFund(preset: FundPreset): void {
  upsert("fund", preset);
}
export function addCustomPerson(preset: PersonPreset): void {
  upsert("person", preset);
}

/**
 * Remove a custom preset. No-op if not found. Built-in presets are
 * stored in the code, not in this table, so this cannot delete them —
 * useful safety guarantee since the UI shares one "delete" affordance
 * across both source kinds.
 *
 * Also purges any cached snapshot for this preset so we don't leave
 * orphan rows in `portfolio_snapshots` (they'd never be visited
 * again, and would occupy DB pages indefinitely). The snapshot
 * table uses the same `(category, id)` key so the delete is a
 * single SQL statement.
 */
export function removeCustomPreset(category: PresetCategory, id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM portfolio_presets WHERE category = ? AND id = ?").run(
    category,
    id,
  );
  // Snapshot rows use `preset_kind` as their column name, but the
  // enum values are identical to `PresetCategory` — kept in lockstep
  // by the CHECK constraint in migration v9. Direct DELETE here (rather
  // than importing `deleteSnapshot` from the cache store) avoids a
  // dependency cycle: `portfolios-cache/store.ts` transitively imports
  // `lib/portfolios.ts` which is a heavy module we don't want to pull
  // into the preset CRUD path.
  db.prepare(
    "DELETE FROM portfolio_snapshots WHERE preset_kind = ? AND preset_id = ?",
  ).run(category, id);
}
