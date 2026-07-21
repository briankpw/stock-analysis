/**
 * Persistence for per-market-segment Technical Signal alerts.
 *
 * Structural sibling of `lib/technical-watch/store.ts` — same
 * "daily digest + on-change" schema, same strength enum, same
 * verdict bookkeeping. The only meaningful difference is the
 * primary key: `segment_id` (e.g. `ai`, `semiconductors`) rather
 * than `ticker`. See migration v11 in `lib/db.ts` for the rationale
 * behind the separate table (short version: overloading
 * `technical_alerts` with a nullable segment column would conflate
 * two conceptually distinct subscriptions in one row and force
 * every ticker read to remember to filter segment rows).
 *
 * The engine resolves each `segment_id` to its proxy ETF via
 * `findSegment()` at tick time, so the technical-signal math is
 * identical to the per-ticker path — only the notification content
 * (segment name + proxy tag) differs.
 */

import { getDb } from "@/lib/db";
import type { Verdict } from "@/lib/technical-signal";
import { findSegment } from "@/lib/segments";
import {
  normalizeFrequency,
  type NotifyFrequency,
} from "@/lib/alert-frequency";

// Segment IDs are stable URL slugs from `SEGMENTS[]`. The source of
// truth is `lib/segments.ts`, so the character set is a–z, 0–9 plus
// dash. Validated on write so bad rows can't accumulate.
const SEGMENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

// ---------------------------------------------------------------------------
// Types — deliberately identical to the per-ticker `AlertStrength` /
// `TechnicalAlert` types so the two tables can share one strength picker
// and one row-renderer on the dashboard.
// ---------------------------------------------------------------------------

/**
 * Which verdicts should trigger an on-change notification.
 *
 *   * `all`         — every band cross (including into HOLD) fires
 *   * `buy_sell`    — only BUY/STRONG_BUY/SELL/STRONG_SELL fire
 *                     (default; skips HOLD noise)
 *   * `strong_only` — only STRONG_BUY / STRONG_SELL fire
 */
export type SectorTechnicalAlertStrength =
  | "all"
  | "buy_sell"
  | "strong_only";

export const ALL_SECTOR_TECHNICAL_STRENGTHS: SectorTechnicalAlertStrength[] = [
  "all",
  "buy_sell",
  "strong_only",
];

export interface SectorTechnicalAlert {
  /** Stable slug from `SEGMENTS[]` in `lib/segments.ts`. */
  segmentId: string;
  /** HH:MM in `timezone`. `null` = no scheduled digest, only on-change. */
  dailyTime: string | null;
  /** IANA timezone name (e.g. `Asia/Shanghai`). Defaults to `UTC`. */
  timezone: string;
  /** When true, fire whenever the verdict band changes. */
  notifyOnChange: boolean;
  /** Filter for on-change firings. */
  minStrength: SectorTechnicalAlertStrength;
  /**
   * How often the ON-CHANGE path is allowed to fire. Does NOT affect
   * the daily-digest. See `lib/alert-frequency.ts`.
   */
  frequency: NotifyFrequency;
  /** Last verdict we notified about — used to detect band crossings. */
  lastVerdict: Verdict | null;
  /** Score at last notification (for the "was +42, now -18" delta). */
  lastScore: number | null;
  /** Local (`timezone`) YYYY-MM-DD of the last digest send. */
  lastDigestLocalDate: string | null;
  /** ISO timestamp of the most recent notification of any kind. */
  lastNotifiedAt: string | null;
  /** ISO timestamp of the last on-change fire (feeds frequency gate). */
  lastChangeNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertSectorTechnicalAlertInput {
  segmentId: string;
  dailyTime?: string | null;
  timezone?: string;
  notifyOnChange?: boolean;
  minStrength?: SectorTechnicalAlertStrength;
  frequency?: NotifyFrequency;
}

// ---------------------------------------------------------------------------
// Validation helpers — mirror the sector-resonance store so the two
// features share the same tolerances (segment slug regex, HH:MM regex,
// IANA tz validation).
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
): SectorTechnicalAlertStrength {
  if (raw === undefined || raw === null) return "buy_sell";
  const s = String(raw);
  if (s === "all" || s === "buy_sell" || s === "strong_only") return s;
  throw new Error(`invalid min_strength: ${s}`);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

const SELECT_COLS =
  "segment_id, daily_time, timezone, notify_on_change, min_strength, " +
  "notify_frequency, last_verdict, last_score, last_digest_local_date, " +
  "last_notified_at, last_change_notified_at, created_at, updated_at";

export function listSectorTechnicalAlerts(): SectorTechnicalAlert[] {
  const rows = getDb()
    .prepare(
      `SELECT ${SELECT_COLS} FROM sector_technical_alerts ORDER BY created_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToAlert);
}

export function findSectorTechnicalAlert(
  segmentId: string,
): SectorTechnicalAlert | null {
  const row = getDb()
    .prepare(
      `SELECT ${SELECT_COLS} FROM sector_technical_alerts WHERE segment_id = ?`,
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
export function upsertSectorTechnicalAlert(
  input: UpsertSectorTechnicalAlertInput,
): SectorTechnicalAlert {
  const segmentId = normalizeSegmentId(input.segmentId);
  const dailyTime = normalizeDailyTime(
    input.dailyTime === undefined ? null : input.dailyTime,
  );
  const timezone = normalizeTimezone(input.timezone);
  const notifyOnChange =
    input.notifyOnChange === undefined ? true : Boolean(input.notifyOnChange);
  const minStrength = normalizeStrength(input.minStrength);
  const frequency = normalizeFrequency(input.frequency);
  const now = new Date().toISOString();
  const existing = findSectorTechnicalAlert(segmentId);
  if (existing) {
    const frequencyChanged = existing.frequency !== frequency;
    getDb()
      .prepare(
        "UPDATE sector_technical_alerts SET " +
          "daily_time = ?, timezone = ?, notify_on_change = ?, " +
          "min_strength = ?, notify_frequency = ?, " +
          (frequencyChanged ? "last_change_notified_at = NULL, " : "") +
          "updated_at = ? " +
          "WHERE segment_id = ?",
      )
      .run(
        dailyTime,
        timezone,
        notifyOnChange ? 1 : 0,
        minStrength,
        frequency,
        now,
        segmentId,
      );
  } else {
    getDb()
      .prepare(
        "INSERT INTO sector_technical_alerts " +
          "(segment_id, daily_time, timezone, notify_on_change, min_strength, " +
          " notify_frequency, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        segmentId,
        dailyTime,
        timezone,
        notifyOnChange ? 1 : 0,
        minStrength,
        frequency,
        now,
        now,
      );
  }
  return findSectorTechnicalAlert(segmentId) ?? {
    segmentId,
    dailyTime,
    timezone,
    notifyOnChange,
    minStrength,
    frequency,
    lastVerdict: null,
    lastScore: null,
    lastDigestLocalDate: null,
    lastNotifiedAt: null,
    lastChangeNotifiedAt: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function deleteSectorTechnicalAlert(segmentId: string): boolean {
  const info = getDb()
    .prepare("DELETE FROM sector_technical_alerts WHERE segment_id = ?")
    .run(String(segmentId).trim().toLowerCase());
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// Post-notification state updates. Kept as narrow helpers so the engine
// never touches raw SQL — makes it easy to add tracking columns later.
// ---------------------------------------------------------------------------

export function markSectorTechnicalDigestFired(
  segmentId: string,
  localDate: string,
  verdict: Verdict,
  score: number,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "UPDATE sector_technical_alerts SET " +
        "last_digest_local_date = ?, last_verdict = ?, last_score = ?, " +
        "last_notified_at = ?, updated_at = ? " +
        "WHERE segment_id = ?",
    )
    .run(
      localDate,
      verdict,
      score,
      now,
      now,
      String(segmentId).trim().toLowerCase(),
    );
}

export function markSectorTechnicalChangeFired(
  segmentId: string,
  verdict: Verdict,
  score: number,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "UPDATE sector_technical_alerts SET " +
        "last_verdict = ?, last_score = ?, last_notified_at = ?, " +
        "last_change_notified_at = ?, updated_at = ? " +
        "WHERE segment_id = ?",
    )
    .run(
      verdict,
      score,
      now,
      now,
      now,
      String(segmentId).trim().toLowerCase(),
    );
}

/**
 * Snapshot the current verdict without firing an alert. Called from
 * the engine when we compute a signal but don't have a previous
 * baseline yet — seeds `last_verdict` so the very next tick doesn't
 * spuriously report a "changed from null" transition.
 */
export function seedSectorTechnicalLastVerdict(
  segmentId: string,
  verdict: Verdict,
  score: number,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "UPDATE sector_technical_alerts SET " +
        "last_verdict = ?, last_score = ?, updated_at = ? " +
        "WHERE segment_id = ? AND last_verdict IS NULL",
    )
    .run(
      verdict,
      score,
      now,
      String(segmentId).trim().toLowerCase(),
    );
}

// ---------------------------------------------------------------------------
// Row hydration
// ---------------------------------------------------------------------------

const VALID_VERDICTS: readonly Verdict[] = [
  "strong_buy",
  "buy",
  "hold",
  "sell",
  "strong_sell",
];

function coerceVerdict(raw: unknown): Verdict | null {
  if (typeof raw !== "string") return null;
  return (VALID_VERDICTS as readonly string[]).includes(raw)
    ? (raw as Verdict)
    : null;
}

function coerceStrength(raw: unknown): SectorTechnicalAlertStrength {
  if (raw === "all" || raw === "strong_only") return raw;
  return "buy_sell";
}

function rowToAlert(row: Record<string, unknown>): SectorTechnicalAlert {
  return {
    segmentId: String(row.segment_id),
    dailyTime: (row.daily_time as string | null) ?? null,
    timezone: String(row.timezone ?? "UTC"),
    notifyOnChange: Boolean(row.notify_on_change),
    minStrength: coerceStrength(row.min_strength),
    frequency: normalizeFrequency(row.notify_frequency),
    lastVerdict: coerceVerdict(row.last_verdict),
    lastScore:
      row.last_score === null || row.last_score === undefined
        ? null
        : Number(row.last_score),
    lastDigestLocalDate: (row.last_digest_local_date as string | null) ?? null,
    lastNotifiedAt: (row.last_notified_at as string | null) ?? null,
    lastChangeNotifiedAt:
      (row.last_change_notified_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
