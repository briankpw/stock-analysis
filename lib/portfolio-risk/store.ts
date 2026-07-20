/**
 * Persistence for the portfolio delisting / bankruptcy risk feature.
 *
 * The user's actual holdings live only in the browser (see
 * `lib/holdings-state.ts` — a Zustand store persisted to
 * localStorage). The server never sees the full transaction history;
 * all it knows is the *list of ticker symbols* the client has asked
 * to monitor.
 *
 * Single table `portfolio_risk_watches` (defined in `lib/db.ts` v6).
 * One row per ticker under monitoring.
 *
 * The client bulk-replaces this list via `syncRiskWatches()` whenever
 * its imported holdings change. The worker's
 * `runPortfolioRiskTick()` walks the list every loop; a push fires
 * once per at-risk episode (see the engine's sticky-until-recovery
 * contract) when the assessment clears the watch's `min_severity`
 * gate. `last_notified_at` acts as the episode's sticky lock — it's
 * set on push and cleared when the ticker returns to a clean state.
 */

import { getDb } from "@/lib/db";
import type { RiskAssessment, RiskSeverity, RiskSignalId } from "./signals";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Which severity levels should trigger a push notification.
 *
 *   * `critical` — only fire on `critical` signals (bankruptcy,
 *     delisting notice, no bars, collapse). Least noisy.
 *   * `high`     — fire on `critical` OR `high` (going concern, SEC
 *     action, sub-$1 extended). Default.
 */
export type MinRiskSeverity = "critical" | "high";

export interface RiskWatch {
  ticker: string;
  minSeverity: MinRiskSeverity;
  lastSeverity: RiskSeverity | null;
  lastFingerprint: string | null;
  lastSignals: RiskSignalId[];
  lastNotifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncRiskWatchesResult {
  added: number;
  removed: number;
  kept: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Matches the API-route regex: letters, digits, and the Yahoo Finance
// separator set (`.`, `-`, `^`, `=`). Max length bumped to 16 so
// longer crypto pairs like `MATIC-USD` and forex like `EURUSD=X` fit.
const TICKER_RE = /^[A-Za-z0-9.\-^=]{1,16}$/;

function normalizeTicker(raw: unknown): string {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!TICKER_RE.test(s)) throw new Error(`invalid ticker: ${s}`);
  return s;
}

function normalizeMinSeverity(raw: unknown): MinRiskSeverity {
  if (raw === undefined || raw === null) return "high";
  const s = String(raw);
  if (s === "critical" || s === "high") return s;
  throw new Error(`invalid min_severity: ${s}`);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

const SELECT_COLS =
  "ticker, min_severity, last_severity, last_fingerprint, " +
  "last_signals_json, last_notified_at, created_at, updated_at";

export function listRiskWatches(): RiskWatch[] {
  const rows = getDb()
    .prepare(
      `SELECT ${SELECT_COLS} FROM portfolio_risk_watches ORDER BY created_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToWatch);
}

export function findRiskWatch(ticker: string): RiskWatch | null {
  const row = getDb()
    .prepare(
      `SELECT ${SELECT_COLS} FROM portfolio_risk_watches WHERE ticker = ?`,
    )
    .get(normalizeTicker(ticker)) as Record<string, unknown> | undefined;
  return row ? rowToWatch(row) : null;
}

export function upsertRiskWatch(
  ticker: string,
  minSeverity: MinRiskSeverity = "high",
): RiskWatch {
  const t = normalizeTicker(ticker);
  const sev = normalizeMinSeverity(minSeverity);
  const now = new Date().toISOString();
  const existing = findRiskWatch(t);
  if (existing) {
    getDb()
      .prepare(
        "UPDATE portfolio_risk_watches SET min_severity = ?, updated_at = ? WHERE ticker = ?",
      )
      .run(sev, now, t);
  } else {
    getDb()
      .prepare(
        "INSERT INTO portfolio_risk_watches " +
          "(ticker, min_severity, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(t, sev, now, now);
  }
  return findRiskWatch(t)!;
}

export function deleteRiskWatch(ticker: string): boolean {
  const info = getDb()
    .prepare("DELETE FROM portfolio_risk_watches WHERE ticker = ?")
    .run(normalizeTicker(ticker));
  return info.changes > 0;
}

/**
 * Bulk-replace the watch list to match `tickers`. Used by the client
 * to keep the server's monitor list in sync with the user's imported
 * holdings — call it whenever the CSV changes.
 *
 * Semantics:
 *   * Any ticker in `tickers` that's not already in the DB is
 *     inserted with the caller's `minSeverity` (default "high").
 *   * Any ticker in the DB that's NOT in `tickers` is deleted — this
 *     is how a fully-closed position stops paging the user.
 *   * Existing rows keep their `min_severity` and `last_*` snapshot
 *     untouched, so we don't spuriously re-fire notifications when a
 *     user re-imports the same CSV.
 *
 * The transaction wraps both branches so we never end up in a
 * "half-updated" state on error. `total` in the returned report is
 * the row count AFTER the sync.
 */
export function syncRiskWatches(
  tickers: string[],
  minSeverity: MinRiskSeverity = "high",
): SyncRiskWatchesResult {
  const db = getDb();
  const sev = normalizeMinSeverity(minSeverity);
  // Dedup + normalise incoming set. Invalid inputs raise immediately —
  // callers should validate up-stream, but the extra check keeps the
  // DB clean.
  const incoming = new Set(tickers.map(normalizeTicker));

  const existingRows = db
    .prepare("SELECT ticker FROM portfolio_risk_watches")
    .all() as Array<{ ticker: string }>;
  const existing = new Set(existingRows.map((r) => r.ticker));

  const toAdd = [...incoming].filter((t) => !existing.has(t));
  const toDelete = [...existing].filter((t) => !incoming.has(t));

  const now = new Date().toISOString();
  const runSync = db.transaction(() => {
    if (toDelete.length > 0) {
      const stmt = db.prepare(
        "DELETE FROM portfolio_risk_watches WHERE ticker = ?",
      );
      for (const t of toDelete) stmt.run(t);
    }
    if (toAdd.length > 0) {
      const stmt = db.prepare(
        "INSERT INTO portfolio_risk_watches " +
          "(ticker, min_severity, created_at, updated_at) VALUES (?, ?, ?, ?)",
      );
      for (const t of toAdd) stmt.run(t, sev, now, now);
    }
  });
  runSync();

  const total = incoming.size;
  return {
    added: toAdd.length,
    removed: toDelete.length,
    kept: total - toAdd.length,
    total,
  };
}

// ---------------------------------------------------------------------------
// Post-notification bookkeeping
// ---------------------------------------------------------------------------

/**
 * Record what the tick just saw for this ticker.
 *
 * Three cases for `last_notified_at`:
 *
 *   * `notified === true` — we just pushed an alert, so stamp
 *     `last_notified_at` = now. This is the "sticky lock" flag the
 *     engine consults to suppress repeat pings for the rest of the
 *     current at-risk episode.
 *
 *   * Confirmed recovery — the assessment is clean AND the *previous*
 *     tick was also clean. Only then do we clear `last_notified_at`
 *     back to NULL so a future re-entry into risk fires again. The
 *     two-consecutive-clean-ticks requirement is essential: without
 *     it, a single Yahoo Finance hiccup (empty bars → `null`
 *     severity for one tick) or a news headline sliding across the
 *     30-day lookback boundary could spuriously clear the lock and
 *     re-fire the same alert every 30–45 minutes.
 *
 *   * All other cases — leave `last_notified_at` untouched. This
 *     includes: still-risky with the lock held, first clean tick
 *     after a risky run (candidate recovery, not yet confirmed), and
 *     the initial "seed the baseline" tick on a freshly-added watch.
 */
export function markRiskEvaluated(
  ticker: string,
  assessment: RiskAssessment,
  notified: boolean,
): void {
  const now = new Date().toISOString();
  const t = normalizeTicker(ticker);
  const signalIds = assessment.signals.map((s) => s.id);
  const json = JSON.stringify(signalIds);
  const isClean = assessment.overallSeverity === null;

  // Look up the previous severity to distinguish "first clean tick"
  // (candidate recovery, don't clear yet) from "second clean tick"
  // (confirmed recovery, safe to clear). Cheap indexed lookup.
  const prev = getDb()
    .prepare("SELECT last_severity FROM portfolio_risk_watches WHERE ticker = ?")
    .get(t) as { last_severity: string | null } | undefined;
  const wasClean = !prev || prev.last_severity === null;
  const confirmedRecovery = isClean && wasClean;

  if (notified) {
    getDb()
      .prepare(
        "UPDATE portfolio_risk_watches SET " +
          "last_severity = ?, last_fingerprint = ?, last_signals_json = ?, " +
          "last_notified_at = ?, updated_at = ? " +
          "WHERE ticker = ?",
      )
      .run(
        assessment.overallSeverity,
        assessment.fingerprint,
        json,
        now,
        now,
        t,
      );
  } else if (confirmedRecovery) {
    getDb()
      .prepare(
        "UPDATE portfolio_risk_watches SET " +
          "last_severity = ?, last_fingerprint = ?, last_signals_json = ?, " +
          "last_notified_at = NULL, updated_at = ? " +
          "WHERE ticker = ?",
      )
      .run(
        assessment.overallSeverity,
        assessment.fingerprint,
        json,
        now,
        t,
      );
  } else {
    getDb()
      .prepare(
        "UPDATE portfolio_risk_watches SET " +
          "last_severity = ?, last_fingerprint = ?, last_signals_json = ?, " +
          "updated_at = ? " +
          "WHERE ticker = ?",
      )
      .run(
        assessment.overallSeverity,
        assessment.fingerprint,
        json,
        now,
        t,
      );
  }
}

// ---------------------------------------------------------------------------
// Row hydration
// ---------------------------------------------------------------------------

const VALID_SEV: readonly RiskSeverity[] = ["critical", "high", "medium"];

function coerceSeverity(raw: unknown): RiskSeverity | null {
  if (typeof raw !== "string") return null;
  return (VALID_SEV as readonly string[]).includes(raw)
    ? (raw as RiskSeverity)
    : null;
}

function coerceMinSeverity(raw: unknown): MinRiskSeverity {
  return raw === "critical" ? "critical" : "high";
}

function coerceSignalIds(raw: unknown): RiskSignalId[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is RiskSignalId => typeof x === "string");
  } catch {
    return [];
  }
}

function rowToWatch(row: Record<string, unknown>): RiskWatch {
  return {
    ticker: String(row.ticker),
    minSeverity: coerceMinSeverity(row.min_severity),
    lastSeverity: coerceSeverity(row.last_severity),
    lastFingerprint: (row.last_fingerprint as string | null) ?? null,
    lastSignals: coerceSignalIds(row.last_signals_json),
    lastNotifiedAt: (row.last_notified_at as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
