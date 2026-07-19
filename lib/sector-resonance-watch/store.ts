/**
 * Persistence for per-market-segment 6-Signal Resonance alerts.
 *
 * Structurally parallel to `lib/resonance-watch/store.ts` — same
 * "daily digest + on-change" schema, same strength enum, same
 * verdict bookkeeping. The only meaningful difference is the
 * primary key: `segment_id` (e.g. `ai`, `semiconductors`) rather
 * than `ticker`. See migration v10 in `lib/db.ts` for the rationale
 * behind the separate table.
 *
 * The engine resolves each `segment_id` to its proxy ETF via
 * `findSegment()` at tick-time, so the resonance math itself is
 * identical to the per-ticker path — only the notification content
 * (segment name + proxy tag) differs.
 */

import { getDb } from "@/lib/db";
import type { ResonanceVerdict } from "@/lib/resonance";
import { findSegment } from "@/lib/segments";

// Segment IDs are the stable URL slugs from `SEGMENTS[]`. They're
// tightly-controlled — the source of truth is `lib/segments.ts`,
// so the character set is a-z0-9 plus dash. Validated on write to
// keep bad rows out of the table.
const SEGMENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type SectorResonanceAlertStrength =
  | "all"
  | "trigger_only"
  | "strong_only";

export const ALL_SECTOR_RESONANCE_STRENGTHS: SectorResonanceAlertStrength[] = [
  "all",
  "trigger_only",
  "strong_only",
];

export interface SectorResonanceAlert {
  /** Stable slug from `SEGMENTS[]` in `lib/segments.ts`. */
  segmentId: string;
  /** HH:MM in `timezone`. `null` = no scheduled digest, only on-change. */
  dailyTime: string | null;
  /** IANA timezone name (e.g. `Asia/Shanghai`). Defaults to `UTC`. */
  timezone: string;
  /** When true, fire whenever the resonance verdict changes. */
  notifyOnChange: boolean;
  /** Filter for on-change firings. */
  minStrength: SectorResonanceAlertStrength;
  /** Last verdict we notified about — used to detect crossings. */
  lastVerdict: ResonanceVerdict | null;
  /** Bullish 0-6 count at last notification (for delta display). */
  lastAlignedCount: number | null;
  /** Bearish 0-6 count at last notification. */
  lastBearishCount: number | null;
  /** Local (`timezone`) YYYY-MM-DD of the last digest send. */
  lastDigestLocalDate: string | null;
  /** ISO timestamp of the most recent notification of any kind. */
  lastNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertSectorResonanceAlertInput {
  segmentId: string;
  dailyTime?: string | null;
  timezone?: string;
  notifyOnChange?: boolean;
  minStrength?: SectorResonanceAlertStrength;
}

// ---------------------------------------------------------------------------
// Validation helpers — mirror the per-ticker resonance store so the two
// features share the same tolerances (HH:MM regex, IANA tz validation).
// ---------------------------------------------------------------------------

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function normalizeSegmentId(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) throw new Error("segmentId required");
  if (!SEGMENT_ID_RE.test(s)) {
    throw new Error("segmentId must be lowercase alphanumeric + dashes");
  }
  // Bail early on unknown segments — a rule for a segment that
  // doesn't exist would never fire and would just accumulate.
  if (!findSegment(s)) {
    throw new Error(`unknown segment: ${s}`);
  }
  return s;
}

export function normalizeDailyTime(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const s = String(raw).trim();
  if (!TIME_RE.test(s)) {
    throw new Error("daily_time must be HH:MM (24-hour)");
  }
  return s;
}

export function normalizeTimezone(raw: unknown): string {
  const s = raw === undefined || raw === null ? "UTC" : String(raw).trim();
  const candidate = s || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    throw new Error(`invalid timezone: ${candidate}`);
  }
}

export function normalizeStrength(
  raw: unknown,
): SectorResonanceAlertStrength {
  if (raw === undefined || raw === null) return "trigger_only";
  const s = String(raw);
  if (s === "all" || s === "trigger_only" || s === "strong_only") return s;
  throw new Error(`invalid min_strength: ${s}`);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

const SELECT_COLS =
  "segment_id, daily_time, timezone, notify_on_change, min_strength, " +
  "last_verdict, last_aligned_count, last_bearish_count, " +
  "last_digest_local_date, last_notified_at, created_at, updated_at";

export function listSectorResonanceAlerts(): SectorResonanceAlert[] {
  const rows = getDb()
    .prepare(
      `SELECT ${SELECT_COLS} FROM sector_resonance_alerts ORDER BY created_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToAlert);
}

export function findSectorResonanceAlert(
  segmentId: string,
): SectorResonanceAlert | null {
  const row = getDb()
    .prepare(
      `SELECT ${SELECT_COLS} FROM sector_resonance_alerts WHERE segment_id = ?`,
    )
    .get(String(segmentId).trim().toLowerCase()) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToAlert(row) : null;
}

/**
 * Upsert. `last_*` tracking columns are intentionally NOT reset on
 * update — changing the daily-time from 09:00 → 10:00 shouldn't
 * re-fire today's digest.
 */
export function upsertSectorResonanceAlert(
  input: UpsertSectorResonanceAlertInput,
): SectorResonanceAlert {
  const segmentId = normalizeSegmentId(input.segmentId);
  const dailyTime = normalizeDailyTime(
    input.dailyTime === undefined ? null : input.dailyTime,
  );
  const timezone = normalizeTimezone(input.timezone);
  const notifyOnChange =
    input.notifyOnChange === undefined ? true : Boolean(input.notifyOnChange);
  const minStrength = normalizeStrength(input.minStrength);
  const now = new Date().toISOString();
  const existing = findSectorResonanceAlert(segmentId);
  if (existing) {
    getDb()
      .prepare(
        "UPDATE sector_resonance_alerts SET " +
          "daily_time = ?, timezone = ?, notify_on_change = ?, " +
          "min_strength = ?, updated_at = ? " +
          "WHERE segment_id = ?",
      )
      .run(
        dailyTime,
        timezone,
        notifyOnChange ? 1 : 0,
        minStrength,
        now,
        segmentId,
      );
  } else {
    getDb()
      .prepare(
        "INSERT INTO sector_resonance_alerts " +
          "(segment_id, daily_time, timezone, notify_on_change, min_strength, " +
          " created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        segmentId,
        dailyTime,
        timezone,
        notifyOnChange ? 1 : 0,
        minStrength,
        now,
        now,
      );
  }
  return findSectorResonanceAlert(segmentId) ?? {
    segmentId,
    dailyTime,
    timezone,
    notifyOnChange,
    minStrength,
    lastVerdict: null,
    lastAlignedCount: null,
    lastBearishCount: null,
    lastDigestLocalDate: null,
    lastNotifiedAt: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function deleteSectorResonanceAlert(segmentId: string): boolean {
  const info = getDb()
    .prepare("DELETE FROM sector_resonance_alerts WHERE segment_id = ?")
    .run(String(segmentId).trim().toLowerCase());
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// Post-notification state updates — mirror the per-ticker store's helpers
// ---------------------------------------------------------------------------

export function markSectorResonanceDigestFired(
  segmentId: string,
  localDate: string,
  verdict: ResonanceVerdict,
  alignedCount: number,
  bearishCount: number,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "UPDATE sector_resonance_alerts SET " +
        "last_digest_local_date = ?, last_verdict = ?, " +
        "last_aligned_count = ?, last_bearish_count = ?, " +
        "last_notified_at = ?, updated_at = ? " +
        "WHERE segment_id = ?",
    )
    .run(
      localDate,
      verdict,
      alignedCount,
      bearishCount,
      now,
      now,
      String(segmentId).trim().toLowerCase(),
    );
}

export function markSectorResonanceChangeFired(
  segmentId: string,
  verdict: ResonanceVerdict,
  alignedCount: number,
  bearishCount: number,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "UPDATE sector_resonance_alerts SET " +
        "last_verdict = ?, last_aligned_count = ?, last_bearish_count = ?, " +
        "last_notified_at = ?, updated_at = ? " +
        "WHERE segment_id = ?",
    )
    .run(
      verdict,
      alignedCount,
      bearishCount,
      now,
      now,
      String(segmentId).trim().toLowerCase(),
    );
}

/**
 * Snapshot the current verdict without firing an alert. Called
 * from the engine when we compute a signal but don't have a
 * previous baseline yet — seeds `last_verdict` so the very next
 * tick doesn't spuriously report a "changed from null" transition.
 */
export function seedSectorResonanceLastVerdict(
  segmentId: string,
  verdict: ResonanceVerdict,
  alignedCount: number,
  bearishCount: number,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "UPDATE sector_resonance_alerts SET " +
        "last_verdict = ?, last_aligned_count = ?, last_bearish_count = ?, " +
        "updated_at = ? " +
        "WHERE segment_id = ? AND last_verdict IS NULL",
    )
    .run(
      verdict,
      alignedCount,
      bearishCount,
      now,
      String(segmentId).trim().toLowerCase(),
    );
}

// ---------------------------------------------------------------------------
// Row hydration
// ---------------------------------------------------------------------------

const VALID_VERDICTS: readonly ResonanceVerdict[] = [
  "buy",
  "holding",
  "sell",
  "avoid",
  "out",
  "warmup",
];

function coerceVerdict(raw: unknown): ResonanceVerdict | null {
  if (typeof raw !== "string") return null;
  return (VALID_VERDICTS as readonly string[]).includes(raw)
    ? (raw as ResonanceVerdict)
    : null;
}

function coerceStrength(raw: unknown): SectorResonanceAlertStrength {
  if (raw === "all" || raw === "strong_only") return raw;
  return "trigger_only";
}

function rowToAlert(row: Record<string, unknown>): SectorResonanceAlert {
  return {
    segmentId: String(row.segment_id),
    dailyTime: (row.daily_time as string | null) ?? null,
    timezone: String(row.timezone ?? "UTC"),
    notifyOnChange: Boolean(row.notify_on_change),
    minStrength: coerceStrength(row.min_strength),
    lastVerdict: coerceVerdict(row.last_verdict),
    lastAlignedCount:
      row.last_aligned_count === null || row.last_aligned_count === undefined
        ? null
        : Number(row.last_aligned_count),
    lastBearishCount:
      row.last_bearish_count === null || row.last_bearish_count === undefined
        ? null
        : Number(row.last_bearish_count),
    lastDigestLocalDate: (row.last_digest_local_date as string | null) ?? null,
    lastNotifiedAt: (row.last_notified_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
