/**
 * Persistence for the technical-signal alert feature.
 *
 * Single table `technical_alerts` (defined in `lib/db.ts` v4 migration).
 * One row per subscribed ticker — the UI enforces "at most one rule
 * per ticker" so this keeps the PK simple.
 *
 * The engine reads these on every worker tick, computes the current
 * `TechnicalSignal`, and decides between two independent notification
 * modes:
 *
 *   1. **Daily digest.** `daily_time` (HH:MM) in `timezone`. Fires once
 *      per local day when the current time has passed the target
 *      instant. Idempotency is enforced by `last_digest_local_date`.
 *
 *   2. **On-change alert.** `notify_on_change = 1`. Fires whenever the
 *      verdict band crosses from the last snapshot (`last_verdict`),
 *      filtered by `min_strength`.
 *
 * Both channels share the same row so users don't have to configure
 * the same ticker twice.
 */

import { getDb } from "@/lib/db";
import type { Verdict } from "@/lib/technical-signal";
import {
  normalizeFrequency,
  type NotifyFrequency,
} from "@/lib/alert-frequency";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Which verdicts should trigger an on-change notification.
 *
 *   * `all`         — every band cross (including into HOLD) fires
 *   * `buy_sell`    — only BUY/STRONG_BUY/SELL/STRONG_SELL fire
 *                     (default; skips HOLD noise)
 *   * `strong_only` — only STRONG_BUY / STRONG_SELL fire
 */
export type AlertStrength = "all" | "buy_sell" | "strong_only";
export const ALL_STRENGTHS: AlertStrength[] = [
  "all",
  "buy_sell",
  "strong_only",
];

export interface TechnicalAlert {
  ticker: string;
  /** HH:MM in `timezone`. `null` = no scheduled digest, only on-change. */
  dailyTime: string | null;
  /** IANA timezone name (e.g. `Asia/Shanghai`). Defaults to `UTC`. */
  timezone: string;
  /** When true, fire whenever the verdict band changes. */
  notifyOnChange: boolean;
  /** Filter for on-change firings. */
  minStrength: AlertStrength;
  /**
   * How often the ON-CHANGE path is allowed to fire per rule. Does
   * NOT affect the daily-digest — that's already once-per-day by
   * design. See `lib/alert-frequency.ts` for semantics.
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
  /**
   * ISO timestamp of the last ON-CHANGE notification specifically.
   * Kept separate from `lastNotifiedAt` so the frequency gate for the
   * on-change path isn't tripped by a digest fire on the same day.
   */
  lastChangeNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertTechnicalAlertInput {
  ticker: string;
  dailyTime?: string | null;
  timezone?: string;
  notifyOnChange?: boolean;
  minStrength?: AlertStrength;
  /**
   * Optional new frequency mode. When the user changes this to
   * anything other than the current value, the store also clears
   * `last_change_notified_at` so a fresh `once` rule can fire, and a
   * `daily` rule isn't stuck waiting until tomorrow just because the
   * previous config already sent one today.
   */
  frequency?: NotifyFrequency;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Return the trimmed HH:MM or throw if the input is not a valid clock. */
export function normalizeDailyTime(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const s = String(raw).trim();
  if (!TIME_RE.test(s)) {
    throw new Error("daily_time must be HH:MM (24-hour)");
  }
  return s;
}

/**
 * Validate an IANA timezone with the Intl API — the same source of truth
 * the engine uses for the "what time is it in this zone right now?"
 * conversion, so any string that survives this check is guaranteed to
 * be usable later.
 */
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

export function normalizeStrength(raw: unknown): AlertStrength {
  if (raw === undefined || raw === null) return "buy_sell";
  const s = String(raw);
  if (
    s === "all" ||
    s === "buy_sell" ||
    s === "strong_only"
  ) {
    return s;
  }
  throw new Error(`invalid min_strength: ${s}`);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

const SELECT_COLS =
  "ticker, daily_time, timezone, notify_on_change, min_strength, " +
  "notify_frequency, last_verdict, last_score, last_digest_local_date, " +
  "last_notified_at, last_change_notified_at, created_at, updated_at";

export function listTechnicalAlerts(): TechnicalAlert[] {
  const rows = getDb()
    .prepare(
      `SELECT ${SELECT_COLS} FROM technical_alerts ORDER BY created_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToAlert);
}

export function findTechnicalAlert(ticker: string): TechnicalAlert | null {
  const row = getDb()
    .prepare(`SELECT ${SELECT_COLS} FROM technical_alerts WHERE ticker = ?`)
    .get(ticker.trim().toUpperCase()) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToAlert(row) : null;
}

/**
 * Upsert: create the row if missing, patch the provided fields otherwise.
 * The `last_*` tracking columns are intentionally NOT reset on update —
 * changing the daily-time from 09:00 → 10:00 shouldn't re-fire today's
 * digest if we already sent it.
 */
export function upsertTechnicalAlert(
  input: UpsertTechnicalAlertInput,
): TechnicalAlert {
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
  const existing = findTechnicalAlert(ticker);
  if (existing) {
    // Saving with a DIFFERENT frequency mode re-arms the on-change
    // gate: clearing `last_change_notified_at` lets a once-mode rule
    // fire again, and prevents a daily-mode rule from being stuck
    // waiting until tomorrow just because the previous config
    // already fired today. Same-mode saves preserve the timestamp
    // so a plain "update the timezone" doesn't unintentionally
    // reset the throttle.
    const frequencyChanged = existing.frequency !== frequency;
    getDb()
      .prepare(
        "UPDATE technical_alerts SET " +
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
        "INSERT INTO technical_alerts " +
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
  return findTechnicalAlert(ticker) ?? {
    ticker,
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

export function deleteTechnicalAlert(ticker: string): boolean {
  const info = getDb()
    .prepare("DELETE FROM technical_alerts WHERE ticker = ?")
    .run(ticker.trim().toUpperCase());
  return info.changes > 0;
}

// ---------------------------------------------------------------------------
// Post-notification state updates. Kept as narrow surface-area helpers so
// the engine doesn't need to hold raw SQL — makes it easy to add columns
// later without touching every call site.
// ---------------------------------------------------------------------------

/** Record that we fired today's digest for this ticker's local date. */
export function markDigestFired(
  ticker: string,
  localDate: string,
  verdict: Verdict,
  score: number,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "UPDATE technical_alerts SET " +
        "last_digest_local_date = ?, last_verdict = ?, last_score = ?, " +
        "last_notified_at = ?, updated_at = ? " +
        "WHERE ticker = ?",
    )
    .run(localDate, verdict, score, now, now, ticker.trim().toUpperCase());
}

/**
 * Record a verdict change without touching `last_digest_local_date` —
 * the two channels are independent so a mid-day BUY→SELL flip shouldn't
 * un-suppress today's digest. Also stamps `last_change_notified_at`,
 * which the frequency gate in `lib/alert-frequency.ts` reads to enforce
 * daily / once caps on the on-change path.
 */
export function markChangeFired(
  ticker: string,
  verdict: Verdict,
  score: number,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "UPDATE technical_alerts SET " +
        "last_verdict = ?, last_score = ?, last_notified_at = ?, " +
        "last_change_notified_at = ?, updated_at = ? " +
        "WHERE ticker = ?",
    )
    .run(verdict, score, now, now, now, ticker.trim().toUpperCase());
}

/**
 * Snapshot the current verdict/score WITHOUT firing an alert. Called
 * from the engine when we compute a signal but don't have a previous
 * baseline to compare against — this seeds `last_verdict` so the very
 * next tick doesn't spuriously report a "verdict changed" transition.
 */
export function seedLastVerdict(
  ticker: string,
  verdict: Verdict,
  score: number,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      "UPDATE technical_alerts SET " +
        "last_verdict = ?, last_score = ?, updated_at = ? " +
        "WHERE ticker = ? AND last_verdict IS NULL",
    )
    .run(verdict, score, now, ticker.trim().toUpperCase());
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

function rowToAlert(row: Record<string, unknown>): TechnicalAlert {
  return {
    ticker: String(row.ticker),
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
