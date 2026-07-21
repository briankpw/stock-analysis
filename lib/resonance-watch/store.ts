/**
 * Persistence for the 6-Signal Resonance alert feature.
 *
 * Structurally parallel to `lib/technical-watch/store.ts` — the two
 * engines share the same "daily digest + on-change" pattern but track
 * different verdict enums (`Verdict` vs. `ResonanceVerdict`) and
 * different strength gates. Keeping the two tables separate rather
 * than overloading `technical_alerts` avoids a foot-gun where a
 * `last_verdict` string is silently misinterpreted by the other
 * engine.
 *
 * Single table `resonance_alerts` (defined in `lib/db.ts` v5). One row
 * per subscribed ticker — the UI enforces "at most one rule per
 * ticker" so the primary key stays simple.
 *
 * Two independent notification channels share the same row:
 *
 *   1. **Daily digest.** `daily_time` (HH:MM) in `timezone`. Fires
 *      once per local day when the current time has passed the target
 *      instant. Idempotency is enforced by `last_digest_local_date`.
 *
 *   2. **On-change alert.** `notify_on_change = 1`. Fires whenever
 *      the resonance verdict crosses from the last snapshot
 *      (`last_verdict`), filtered by `min_strength`.
 */

import { getDb } from "@/lib/db";
import type { ResonanceVerdict } from "@/lib/resonance";
import {
  normalizeFrequency,
  type NotifyFrequency,
} from "@/lib/alert-frequency";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Which verdict transitions should trigger an on-change notification.
 *
 * The Resonance strategy has a coarser natural cadence than the
 * Technical Signal — the "buy" and "sell" verdicts only fire on the
 * *first* bar of a fresh alignment (see `freshBuy` / `freshSell` in
 * `resonance.ts`), then decay to `holding` / `avoid` on subsequent
 * bars. That means the useful transitions are:
 *
 *   * `all`          — every verdict change (including holding → out,
 *                      avoid → out, and warmup transitions)
 *   * `trigger_only` — only *fresh* `buy` / `sell` triggers, i.e. the
 *                      transition INTO those states. Skips the
 *                      holding ↔ out chatter that fills most days.
 *                      This is the default because it matches the
 *                      spirit of the strategy: alert me the moment
 *                      six signals align.
 *   * `strong_only`  — same as `trigger_only` but *also* requires the
 *                      full 6/6 alignment (i.e. `alignedCount === 6`
 *                      for a buy, `bearishAlignedCount === 6` for a
 *                      sell). Skips the "5 aligned → buy" early
 *                      signal that some setups can produce.
 */
export type ResonanceAlertStrength = "all" | "trigger_only" | "strong_only";
export const ALL_RESONANCE_STRENGTHS: ResonanceAlertStrength[] = [
  "all",
  "trigger_only",
  "strong_only",
];

export interface ResonanceAlert {
  ticker: string;
  /** HH:MM in `timezone`. `null` = no scheduled digest, only on-change. */
  dailyTime: string | null;
  /** IANA timezone name (e.g. `Asia/Shanghai`). Defaults to `UTC`. */
  timezone: string;
  /** When true, fire whenever the resonance verdict changes. */
  notifyOnChange: boolean;
  /** Filter for on-change firings. */
  minStrength: ResonanceAlertStrength;
  /**
   * How often the ON-CHANGE path is allowed to fire per rule. Does
   * NOT affect the daily-digest. See `lib/alert-frequency.ts`.
   */
  frequency: NotifyFrequency;
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
  /** ISO timestamp of the last on-change fire (feeds frequency gate). */
  lastChangeNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertResonanceAlertInput {
  ticker: string;
  dailyTime?: string | null;
  timezone?: string;
  notifyOnChange?: boolean;
  minStrength?: ResonanceAlertStrength;
  frequency?: NotifyFrequency;
}

// ---------------------------------------------------------------------------
// Validation helpers — mirror the technical-alerts store so the two
// features share the same tolerances (HH:MM regex, IANA tz validation).
// ---------------------------------------------------------------------------

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

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

export function normalizeStrength(raw: unknown): ResonanceAlertStrength {
  if (raw === undefined || raw === null) return "trigger_only";
  const s = String(raw);
  if (s === "all" || s === "trigger_only" || s === "strong_only") return s;
  throw new Error(`invalid min_strength: ${s}`);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

const SELECT_COLS =
  "ticker, daily_time, timezone, notify_on_change, min_strength, " +
  "notify_frequency, last_verdict, last_aligned_count, last_bearish_count, " +
  "last_digest_local_date, last_notified_at, last_change_notified_at, " +
  "created_at, updated_at";

export function listResonanceAlerts(): ResonanceAlert[] {
  const rows = getDb()
    .prepare(`SELECT ${SELECT_COLS} FROM resonance_alerts ORDER BY created_at DESC`)
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToAlert);
}

export function findResonanceAlert(ticker: string): ResonanceAlert | null {
  const row = getDb()
    .prepare(`SELECT ${SELECT_COLS} FROM resonance_alerts WHERE ticker = ?`)
    .get(ticker.trim().toUpperCase()) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToAlert(row) : null;
}

/**
 * Upsert: create the row if missing, patch the provided fields
 * otherwise. `last_*` tracking columns are intentionally NOT reset on
 * update — changing the daily-time from 09:00 → 10:00 shouldn't
 * re-fire today's digest.
 */
export function upsertResonanceAlert(
  input: UpsertResonanceAlertInput,
): ResonanceAlert {
  const ticker = input.ticker.trim().toUpperCase();
  if (!ticker) throw new Error("ticker required");
  const dailyTime = normalizeDailyTime(
    input.dailyTime === undefined ? null : input.dailyTime,
  );
  const timezone = normalizeTimezone(input.timezone);
  const notifyOnChange =
    input.notifyOnChange === undefined ? true : Boolean(input.notifyOnChange);
  const minStrength = normalizeStrength(input.minStrength);
  const frequency = normalizeFrequency(input.frequency);
  const now = new Date().toISOString();
  const existing = findResonanceAlert(ticker);
  if (existing) {
    const frequencyChanged = existing.frequency !== frequency;
    getDb()
      .prepare(
        "UPDATE resonance_alerts SET " +
          "daily_time = ?, timezone = ?, notify_on_change = ?, " +
          "min_strength = ?, notify_frequency = ?, " +
          (frequencyChanged ? "last_change_notified_at = NULL, " : "") +
          "updated_at = ? " +
          "WHERE ticker = ?",
      )
      .run(
        dailyTime,
        timezone,
        notifyOnChange ? 1 : 0,
        minStrength,
        frequency,
        now,
        ticker,
      );
  } else {
    getDb()
      .prepare(
        "INSERT INTO resonance_alerts " +
          "(ticker, daily_time, timezone, notify_on_change, min_strength, " +
          " notify_frequency, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        ticker,
        dailyTime,
        timezone,
        notifyOnChange ? 1 : 0,
        minStrength,
        frequency,
        now,
        now,
      );
  }
  return findResonanceAlert(ticker) ?? {
    ticker,
    dailyTime,
    timezone,
    notifyOnChange,
    minStrength,
    frequency,
    lastVerdict: null,
    lastAlignedCount: null,
    lastBearishCount: null,
    lastDigestLocalDate: null,
    lastNotifiedAt: null,
    lastChangeNotifiedAt: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function deleteResonanceAlert(ticker: string): boolean {
  const info = getDb()
    .prepare("DELETE FROM resonance_alerts WHERE ticker = ?")
    .run(ticker.trim().toUpperCase());
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// Post-notification state updates
// ---------------------------------------------------------------------------

export function markResonanceDigestFired(
  ticker: string,
  localDate: string,
  verdict: ResonanceVerdict,
  alignedCount: number,
  bearishCount: number,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "UPDATE resonance_alerts SET " +
        "last_digest_local_date = ?, last_verdict = ?, " +
        "last_aligned_count = ?, last_bearish_count = ?, " +
        "last_notified_at = ?, updated_at = ? " +
        "WHERE ticker = ?",
    )
    .run(
      localDate,
      verdict,
      alignedCount,
      bearishCount,
      now,
      now,
      ticker.trim().toUpperCase(),
    );
}

export function markResonanceChangeFired(
  ticker: string,
  verdict: ResonanceVerdict,
  alignedCount: number,
  bearishCount: number,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "UPDATE resonance_alerts SET " +
        "last_verdict = ?, last_aligned_count = ?, last_bearish_count = ?, " +
        "last_notified_at = ?, last_change_notified_at = ?, updated_at = ? " +
        "WHERE ticker = ?",
    )
    .run(
      verdict,
      alignedCount,
      bearishCount,
      now,
      now,
      now,
      ticker.trim().toUpperCase(),
    );
}

/**
 * Snapshot the current verdict without firing an alert. Called from
 * the engine when we compute a signal but don't have a previous
 * baseline yet — seeds `last_verdict` so the very next tick doesn't
 * spuriously report a "changed from null" transition.
 */
export function seedResonanceLastVerdict(
  ticker: string,
  verdict: ResonanceVerdict,
  alignedCount: number,
  bearishCount: number,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "UPDATE resonance_alerts SET " +
        "last_verdict = ?, last_aligned_count = ?, last_bearish_count = ?, " +
        "updated_at = ? " +
        "WHERE ticker = ? AND last_verdict IS NULL",
    )
    .run(
      verdict,
      alignedCount,
      bearishCount,
      now,
      ticker.trim().toUpperCase(),
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

function coerceStrength(raw: unknown): ResonanceAlertStrength {
  if (raw === "all" || raw === "strong_only") return raw;
  return "trigger_only";
}

function rowToAlert(row: Record<string, unknown>): ResonanceAlert {
  return {
    ticker: String(row.ticker),
    dailyTime: (row.daily_time as string | null) ?? null,
    timezone: String(row.timezone ?? "UTC"),
    notifyOnChange: Boolean(row.notify_on_change),
    minStrength: coerceStrength(row.min_strength),
    frequency: normalizeFrequency(row.notify_frequency),
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
    lastChangeNotifiedAt:
      (row.last_change_notified_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
