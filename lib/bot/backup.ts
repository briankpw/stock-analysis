/**
 * SQLite hot-backup tick — periodic snapshot of the shared DB file so
 * a corrupted WAL, an accidental `DELETE FROM …`, or an SD-card
 * flush-loss on a laptop deployment doesn't cost the operator every
 * politician-portfolio snapshot, alert-history row, or paper-trading
 * balance we've ever recorded.
 *
 * Why hot-backup and not a `cp` cron job
 * --------------------------------------
 * `better-sqlite3` exposes `db.backup(target)` which runs the SQLite
 * Online Backup API — it acquires the shared lock, streams pages to
 * a new file, and releases the lock, all while readers/writers on
 * the main file keep working. A naive `cp bot.db bot.db.bak` under
 * WAL mode captures a half-written journal state and produces a
 * torn snapshot ~1% of the time (worse under sustained write load).
 *
 * What gets kept
 * --------------
 * We store the last `BACKUP_KEEP_COUNT` snapshots in a `backups/`
 * subdirectory next to the DB file, named
 * `<basename>.YYYYMMDD-HHmmss.bak`. Rotation happens at the end of
 * each successful run (delete the oldest excess snapshots so the
 * count stays bounded — no separate cron-style cleanup needed).
 *
 * When it runs
 * ------------
 * Scheduled from `lib/bot/engine.ts` alongside the retention prune,
 * but gated to at most once every `BACKUP_INTERVAL_MS` (default
 * 24 h) via `STATE_KEYS.LAST_BACKUP_AT`. Manual runs can be
 * triggered by resetting that key to null.
 *
 * The tick lock (`"sqlite-backup"`) ensures the UI process and the
 * worker process never both try to snapshot concurrently — the
 * SQLite Backup API tolerates concurrent readers but two concurrent
 * *backup writers* on the same shared cache is Undefined Behaviour.
 */

import fs from "node:fs";
import path from "node:path";
import { settings } from "../config";
import { getDb } from "../db";
import { tryLockTick, getState, setState, STATE_KEYS } from "./store";

/**
 * Minimum interval between successful backups. Kept at 24 h so the
 * total on-disk overhead is bounded (BACKUP_KEEP_COUNT × ~DB size)
 * and so a laptop that only runs the app for a few hours a day
 * still captures at most one snapshot per session.
 */
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * How many snapshots to retain. Seven gives us a full week of
 * rollback windows — enough to catch a bug that manifests slowly
 * (e.g. a rule regression that trickles bad rows into an alert
 * history table) while keeping the storage cost bounded to ~7×
 * the live DB size.
 */
const BACKUP_KEEP_COUNT = 7;

export interface BackupTickReport {
  ranAt: string;
  /** True when the daily interval hasn't elapsed. */
  skippedNotDue: boolean;
  /** True when another backup was already running (very unlikely). */
  skippedLocked: boolean;
  /** True when we ran but failed — see `error` for the details. */
  failed: boolean;
  /** Absolute path of the snapshot we just wrote, when successful. */
  writtenTo: string | null;
  /** Byte size of the snapshot we just wrote, when successful. */
  writtenBytes: number | null;
  /** Number of older snapshots we deleted this run. */
  rotatedOut: number;
  /** Redacted error string when `failed` is true. */
  error: string | null;
}

/**
 * Bot-worker entrypoint. Idempotent — safe to call every tick; the
 * once-per-day gate is enforced here rather than requiring the
 * caller to compute it.
 */
export async function runBackupTick(): Promise<BackupTickReport> {
  const ranAt = new Date().toISOString();
  const base: Omit<BackupTickReport, "ranAt"> = {
    skippedNotDue: false,
    skippedLocked: false,
    failed: false,
    writtenTo: null,
    writtenBytes: null,
    rotatedOut: 0,
    error: null,
  };

  // Once-per-day gate. Reading state is cheap; do it before
  // acquiring the lock so the vast majority of ticks that will
  // just skip don't need to touch the lock table.
  const lastAtIso = getState<string | null>(STATE_KEYS.LAST_BACKUP_AT, null);
  const lastAtMs = lastAtIso ? new Date(lastAtIso).getTime() : 0;
  if (lastAtMs && Date.now() - lastAtMs < BACKUP_INTERVAL_MS) {
    return { ranAt, ...base, skippedNotDue: true };
  }

  const release = tryLockTick("sqlite-backup");
  if (!release) return { ranAt, ...base, skippedLocked: true };

  try {
    const dbPath = settings.bot.dbPath;
    const dir = path.join(path.dirname(dbPath), "backups");
    fs.mkdirSync(dir, { recursive: true });

    // Timestamp format YYYYMMDD-HHmmss is chosen so `fs.readdir()`
    // + lexicographic sort gives chronological order for cheap
    // rotation. No colons / spaces so the filename survives every
    // filesystem the app targets (ext4, NTFS, exFAT on portable
    // media).
    const now = new Date();
    const stamp = [
      now.getUTCFullYear(),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      String(now.getUTCDate()).padStart(2, "0"),
      "-",
      String(now.getUTCHours()).padStart(2, "0"),
      String(now.getUTCMinutes()).padStart(2, "0"),
      String(now.getUTCSeconds()).padStart(2, "0"),
    ].join("");
    const basename = path.basename(dbPath);
    const target = path.join(dir, `${basename}.${stamp}.bak`);

    // `db.backup()` returns a Promise (better-sqlite3 async
    // wrapper). Under the hood it uses SQLite's Online Backup API:
    // acquires the shared lock, streams pages page-by-page (2048
    // pages per step by default so the writer isn't starved), and
    // releases when finished. Safe with concurrent readers/writers.
    //
    // The `progress` callback lets you throttle further; we accept
    // the defaults because a full snapshot of a laptop-sized DB
    // (~10 MB range) takes well under a second in practice.
    await getDb().backup(target);

    let bytes: number | null = null;
    try {
      bytes = fs.statSync(target).size;
    } catch {
      // Non-fatal — the file exists (backup returned without
      // throwing) but stat failed for a permission reason. We
      // still consider the run a success.
    }

    // Rotation — keep only the most recent BACKUP_KEEP_COUNT. Sort
    // by filename (which encodes UTC timestamp) is equivalent to
    // sorting by mtime here and avoids reading each dirent's mtime.
    const prefix = `${basename}.`;
    const rotated = _rotateBackups(dir, prefix, BACKUP_KEEP_COUNT);

    setState(STATE_KEYS.LAST_BACKUP_AT, new Date().toISOString());

    return {
      ranAt,
      ...base,
      writtenTo: target,
      writtenBytes: bytes,
      rotatedOut: rotated,
    };
  } catch (err) {
    return {
      ranAt,
      ...base,
      failed: true,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    };
  } finally {
    release();
  }
}

/**
 * Delete every file in `dir` whose name starts with `prefix` and
 * ends with `.bak`, keeping the newest `keep` entries. Returns the
 * number of files removed. Errors on individual deletes are
 * swallowed and just reduce the return count — a stuck backup file
 * shouldn't crash the whole tick.
 */
function _rotateBackups(dir: string, prefix: string, keep: number): number {
  let entries: string[];
  try {
    entries = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith(prefix) && n.endsWith(".bak"))
      .sort(); // ascending — oldest first (filename encodes UTC ts)
  } catch {
    return 0;
  }
  const excess = entries.length - keep;
  if (excess <= 0) return 0;
  let removed = 0;
  for (let i = 0; i < excess; i++) {
    try {
      fs.unlinkSync(path.join(dir, entries[i]!));
      removed++;
    } catch {
      // ignore — file may have been swept manually
    }
  }
  return removed;
}
