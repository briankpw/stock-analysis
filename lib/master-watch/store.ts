/**
 * Persistence for the Master Verdict alert feature.
 *
 * Single table `master_alerts` (defined in `lib/db.ts` v8 migration).
 * One row per subscribed ticker; the UI enforces "at most one rule
 * per ticker" so the PK stays simple.
 *
 * Structurally a mirror of `technical_alerts` (see the v4 docs) — the
 * two engines make identical daily-digest vs. on-change decisions
 * using identical `AlertStrength` semantics and the same 5-band
 * `Verdict` vocabulary. The tables are kept separate so a user can
 * subscribe to one channel without automatically getting the other,
 * and so schema changes on either side (e.g. adding master-only
 * `min_coverage`) don't force migrations for the other.
 *
 * `AlertStrength` is re-exported from `technical-watch/store` so the
 * two subsystems stay in lockstep on the gate vocabulary. If they
 * diverge in the future (e.g. master gets a "buy_sell_conviction"
 * option that technical doesn't) we'll fork the type at that point.
 */

import { getDb } from "@/lib/db";
import type { Verdict } from "@/lib/technical-signal";
import {
  normalizeStrength,
  normalizeTimezone,
  normalizeDailyTime,
  type AlertStrength,
} from "@/lib/technical-watch/store";

export type { AlertStrength } from "@/lib/technical-watch/store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MasterAlert {
  ticker: string;
  /** HH:MM in `timezone`. `null` = no scheduled digest, only on-change. */
  dailyTime: string | null;
  /** IANA timezone name (e.g. `Asia/Shanghai`). Defaults to `UTC`. */
  timezone: string;
  /** When true, fire whenever the master verdict band changes. */
  notifyOnChange: boolean;
  /** Filter for on-change firings. */
  minStrength: AlertStrength;
  /** Last verdict we notified about — used to detect band crossings. */
  lastVerdict: Verdict | null;
  /** Score at last notification (for the "was +42, now -18" delta). */
  lastScore: number | null;
  /**
   * Coverage at last notification. Snapshotted so the digest text can
   * flag "coverage up from 60% → 85% overnight" when news/sentiment
   * fills back in — an early signal that the verdict is now trustable.
   */
  lastCoverage: number | null;
  /** Local (`timezone`) YYYY-MM-DD of the last digest send. */
  lastDigestLocalDate: string | null;
  /** ISO timestamp of the most recent notification of any kind. */
  lastNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertMasterAlertInput {
  ticker: string;
  dailyTime?: string | null;
  timezone?: string;
  notifyOnChange?: boolean;
  minStrength?: AlertStrength;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

// Field list is a single constant so every read-shaped query uses
// the same column order and `rowToAlert` doesn't get out of sync
// when we add a column later.
const SELECT_FIELDS =
  "ticker, daily_time, timezone, notify_on_change, min_strength, " +
  "last_verdict, last_score, last_coverage, last_digest_local_date, last_notified_at, " +
  "created_at, updated_at";

export function listMasterAlerts(): MasterAlert[] {
  const rows = getDb()
    .prepare(
      `SELECT ${SELECT_FIELDS} FROM master_alerts ORDER BY created_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToAlert);
}

export function findMasterAlert(ticker: string): MasterAlert | null {
  const row = getDb()
    .prepare(
      `SELECT ${SELECT_FIELDS} FROM master_alerts WHERE ticker = ?`,
    )
    .get(ticker.trim().toUpperCase()) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToAlert(row) : null;
}

/**
 * Upsert: create the row if missing, patch the provided fields
 * otherwise. The `last_*` tracking columns are intentionally NOT reset
 * on update — changing the daily-time from 09:00 → 10:00 shouldn't
 * re-fire today's digest if we already sent it.
 */
export function upsertMasterAlert(
  input: UpsertMasterAlertInput,
): MasterAlert {
  const ticker = input.ticker.trim().toUpperCase();
  if (!ticker) throw new Error("ticker required");
  const dailyTime = normalizeDailyTime(
    input.dailyTime === undefined ? null : input.dailyTime,
  );
  const timezone = normalizeTimezone(input.timezone);
  const notifyOnChange =
    input.notifyOnChange === undefined
      ? true
      : Boolean(input.notifyOnChange);
  const minStrength = normalizeStrength(input.minStrength);
  const now = new Date().toISOString();
  const existing = findMasterAlert(ticker);
  if (existing) {
    getDb()
      .prepare(
        "UPDATE master_alerts SET " +
          "daily_time = ?, timezone = ?, notify_on_change = ?, " +
          "min_strength = ?, updated_at = ? " +
          "WHERE ticker = ?",
      )
      .run(
        dailyTime,
        timezone,
        notifyOnChange ? 1 : 0,
        minStrength,
        now,
        ticker,
      );
  } else {
    getDb()
      .prepare(
        "INSERT INTO master_alerts " +
          "(ticker, daily_time, timezone, notify_on_change, min_strength, " +
          " created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        ticker,
        dailyTime,
        timezone,
        notifyOnChange ? 1 : 0,
        minStrength,
        now,
        now,
      );
  }
  return (
    findMasterAlert(ticker) ?? {
      ticker,
      dailyTime,
      timezone,
      notifyOnChange,
      minStrength,
      lastVerdict: null,
      lastScore: null,
      lastCoverage: null,
      lastDigestLocalDate: null,
      lastNotifiedAt: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
  );
}

export function deleteMasterAlert(ticker: string): boolean {
  const info = getDb()
    .prepare("DELETE FROM master_alerts WHERE ticker = ?")
    .run(ticker.trim().toUpperCase());
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// Post-notification bookkeeping
// ---------------------------------------------------------------------------

/** Record that we fired today's digest for this ticker's local date. */
export function markMasterDigestFired(
  ticker: string,
  localDate: string,
  verdict: Verdict,
  score: number,
  coverage: number,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "UPDATE master_alerts SET " +
        "last_digest_local_date = ?, last_verdict = ?, last_score = ?, " +
        "last_coverage = ?, last_notified_at = ?, updated_at = ? " +
        "WHERE ticker = ?",
    )
    .run(
      localDate,
      verdict,
      score,
      coverage,
      now,
      now,
      ticker.trim().toUpperCase(),
    );
}

/**
 * Record a verdict change WITHOUT touching `last_digest_local_date` —
 * the two channels are independent so a mid-day BUY→SELL flip
 * shouldn't un-suppress today's digest.
 */
export function markMasterChangeFired(
  ticker: string,
  verdict: Verdict,
  score: number,
  coverage: number,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "UPDATE master_alerts SET " +
        "last_verdict = ?, last_score = ?, last_coverage = ?, " +
        "last_notified_at = ?, updated_at = ? " +
        "WHERE ticker = ?",
    )
    .run(
      verdict,
      score,
      coverage,
      now,
      now,
      ticker.trim().toUpperCase(),
    );
}

/**
 * Snapshot the current verdict/score/coverage WITHOUT firing an
 * alert. Called from the engine when we compute a signal but don't
 * have a previous baseline — this seeds `last_verdict` so the very
 * next tick doesn't spuriously report a "verdict changed from null
 * to buy" transition.
 */
export function seedMasterLastVerdict(
  ticker: string,
  verdict: Verdict,
  score: number,
  coverage: number,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "UPDATE master_alerts SET " +
        "last_verdict = ?, last_score = ?, last_coverage = ?, updated_at = ? " +
        "WHERE ticker = ? AND last_verdict IS NULL",
    )
    .run(
      verdict,
      score,
      coverage,
      now,
      ticker.trim().toUpperCase(),
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

function coerceStrength(raw: unknown): AlertStrength {
  if (raw === "all" || raw === "strong_only") return raw;
  return "buy_sell";
}

function numberOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function rowToAlert(row: Record<string, unknown>): MasterAlert {
  return {
    ticker: String(row.ticker),
    dailyTime: (row.daily_time as string | null) ?? null,
    timezone: String(row.timezone ?? "UTC"),
    notifyOnChange: Boolean(row.notify_on_change),
    minStrength: coerceStrength(row.min_strength),
    lastVerdict: coerceVerdict(row.last_verdict),
    lastScore: numberOrNull(row.last_score),
    lastCoverage: numberOrNull(row.last_coverage),
    lastDigestLocalDate: (row.last_digest_local_date as string | null) ?? null,
    lastNotifiedAt: (row.last_notified_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
