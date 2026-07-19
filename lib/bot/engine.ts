/**
 * Bot orchestration — one worker loop that fans out into every alert
 * channel we support (technical signals, 6-signal resonance, master
 * verdict, sector-level 6-signal resonance, sector technical signals,
 * portfolio insiders, insider stock watches, news subscriptions,
 * portfolio-risk).
 *
 * Historically this module also ran a per-tick "strategy" pass (SMA
 * crossover / RSI reversion / MACD cross) against the sticky sidebar
 * ticker. That path was removed in July 2026: every one of those three
 * strategies is already covered — and covered better — by the
 * per-ticker Technical Signal alerts and 6-Signal Resonance alerts,
 * both of which have proper per-ticker subscription flows, digest
 * scheduling, and strength gates. Keeping the legacy strategy tick
 * around only added a footgun where alerts fired for whatever ticker
 * happened to be sticky in the sidebar.
 *
 * The worker process (`worker.mjs`) calls `runForever()`. There is no
 * longer a `runTick(ticker)` — nothing runs against a single ticker at
 * the "bot" level; every channel has its own scheduling.
 */

import { settings } from "../config";
import {
  setState,
  STATE_KEYS,
  getState,
} from "./store";
import { runPortfolioTick } from "../portfolio-watch/engine";
import { runStockTick } from "../stock-watch/engine";
import { runNewsTick } from "../news-watch/engine";
import { runTechnicalTick } from "../technical-watch/engine";
import { runResonanceTick } from "../resonance-watch/engine";
import { runMasterTick } from "../master-watch/engine";
import { runSectorResonanceTick } from "../sector-resonance-watch/engine";
import { runSectorTechnicalTick } from "../sector-technical-watch/engine";
import { runPortfolioRiskTick } from "../portfolio-risk/engine";
import { runPortfolioSnapshotTick } from "../portfolios-cache/engine";
import { runRetentionTick } from "./retention";
import { runBackupTick } from "./backup";

/**
 * Long-running worker loop. Fires every enabled sub-tick in isolation
 * (independent `try` blocks so a bad rule on one channel can't stall
 * any of the others) and writes a heartbeat timestamp at the end of
 * each cycle so the UI's "Last tick" indicator stays meaningful.
 *
 * Sleeps `BOT_POLL_INTERVAL_SECONDS` between cycles. Reacts to
 * SIGINT/SIGTERM within ~500 ms.
 *
 * The `ticker` argument used to select which symbol the removed
 * strategy tick evaluated; it's now unused but kept in the signature
 * so `worker.mjs` doesn't need to change. Passing `settings.ticker`
 * (the default) is still the correct call site convention if a caller
 * wants explicit intent.
 */
export async function runForever(_ticker?: string): Promise<void> {
  const interval = Math.max(60, settings.bot.pollIntervalSeconds) * 1000;
  let stopping = false;
  const stop = () => {
    if (!stopping) {
      stopping = true;
      // eslint-disable-next-line no-console
      console.log("[worker] shutdown signal received; exiting after current tick");
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (!stopping) {
    const enabled = getState<boolean>(STATE_KEYS.ENABLED, true);
    if (enabled) {
      // Every sub-tick runs in parallel. They share no in-memory
      // state and every DB write goes through `INSERT OR IGNORE` on a
      // unique key (see the per-channel notification tables in
      // `lib/db.ts`), so concurrent execution is safe. Total wall
      // time is now `max(tick_i)` instead of `sum(tick_i)` — a hung
      // Yahoo response on one channel no longer stalls the eight
      // others. Each `runTick` helper wraps its channel in its own
      // try/catch + structured log line so a failure in one channel
      // never surfaces as an unhandled rejection at the
      // `Promise.allSettled` boundary.
      await Promise.allSettled([
        runTick("portfolio-tick", runPortfolioTick, (r) =>
          `watches=${r.watchCount} probed=${r.presetsProbed} events=${r.eventsSeen} ` +
          `matched=${r.eventsMatched} notified=${r.notifiesSent} errors=${r.errors.length}`,
        ),
        runTick("stock-tick", runStockTick, (r) =>
          `watches=${r.watchCount} probed=${r.tickersProbed} tx=${r.transactionsSeen} ` +
          `matched=${r.transactionsMatched} notified=${r.notifiesSent} errors=${r.errors.length}`,
        ),
        runTick("news-tick", runNewsTick, (r) =>
          `subs=${r.subscriptionCount} probed=${r.tickersProbed} items=${r.itemsSeen} ` +
          `new=${r.itemsNew} notified=${r.notifiesSent} errors=${r.errors.length}`,
        ),
        runTick("technical-tick", runTechnicalTick, (r) =>
          `alerts=${r.alertCount} evaluated=${r.tickersEvaluated} ` +
          `digests=${r.digestsSent} changes=${r.changesSent} errors=${r.errors.length}`,
        ),
        runTick("resonance-tick", runResonanceTick, (r) =>
          `alerts=${r.alertCount} evaluated=${r.tickersEvaluated} ` +
          `digests=${r.digestsSent} changes=${r.changesSent} errors=${r.errors.length}`,
        ),
        runTick("master-tick", runMasterTick, (r) =>
          `alerts=${r.alertCount} evaluated=${r.tickersEvaluated} ` +
          `digests=${r.digestsSent} changes=${r.changesSent} errors=${r.errors.length}`,
        ),
        runTick("sector-resonance-tick", runSectorResonanceTick, (r) =>
          `alerts=${r.alertCount} evaluated=${r.segmentsEvaluated} ` +
          `digests=${r.digestsSent} changes=${r.changesSent} errors=${r.errors.length}`,
        ),
        runTick("sector-technical-tick", runSectorTechnicalTick, (r) =>
          `alerts=${r.alertCount} evaluated=${r.segmentsEvaluated} ` +
          `digests=${r.digestsSent} changes=${r.changesSent} errors=${r.errors.length}`,
        ),
        runTick("portfolio-risk-tick", runPortfolioRiskTick, (r) =>
          `watches=${r.watchCount} evaluated=${r.tickersEvaluated} ` +
          `risky=${r.riskyCount} sent=${r.notifiesSent} errors=${r.errors.length}`,
        ),
        runTick("portfolios-snapshot-tick", runPortfolioSnapshotTick, (r) =>
          r.skipped
            ? null // suppress noisy "another tick running" log lines
            : `due=${r.dueCount} attempted=${r.attempted} refreshed=${r.refreshed} ` +
              `upstreamDown=${r.upstreamUnavailable} errors=${r.errors.length}`,
        ),
        runTick("retention-prune", runRetentionTick, (r) => {
          // The prune runs at most once per 24 h; on non-due ticks
          // stay quiet so the worker log doesn't scroll with
          // "skipped" lines every minute.
          if (r.skippedNotDue || r.skippedLocked) return null;
          const total = Object.values(r.deleted).reduce((a, b) => a + b, 0);
          const perTable = Object.entries(r.deleted)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ");
          return `deleted=${total} (${perTable}) errors=${r.errors.length}`;
        }),
        runTick("sqlite-backup", runBackupTick, (r) => {
          // Backup runs at most once per 24 h; on skipped ticks
          // stay quiet, same rationale as the retention prune
          // above. Failures log at info level (the outer catch in
          // `runTick` would double-log if we returned an error
          // line here).
          if (r.skippedNotDue || r.skippedLocked) return null;
          if (r.failed) return `FAILED: ${r.error ?? "unknown"}`;
          return (
            `wrote=${r.writtenTo ?? "?"} ` +
            `bytes=${r.writtenBytes ?? "?"} rotated=${r.rotatedOut}`
          );
        }),
      ]);
      // Worker heartbeat. Written *after* every sub-tick so the UI's
      // "Last tick" indicator reflects a real completed cycle rather
      // than a start-of-cycle marker. Historically this key was
      // owned by the removed strategy tick; repurposing it keeps the
      // Bot Status card meaningful without an i18n rename.
      try {
        setState(STATE_KEYS.LAST_TICK_AT, new Date().toISOString());
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[worker] failed to write heartbeat:", err);
      }
    } else {
      // eslint-disable-next-line no-console
      console.log("[worker] bot disabled — skipping tick");
    }
    // Sleep in short slices so we can react to SIGINT quickly.
    const deadline = Date.now() + interval;
    while (!stopping && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/**
 * One-shot tick runner used by the `Promise.allSettled` fan-out
 * above. Runs the tick, formats a per-channel log line via the
 * caller-supplied summariser, and swallows any thrown error into a
 * structured console.error so a failure in one channel can't reject
 * the whole `allSettled` (defence in depth — `allSettled` already
 * absorbs rejections, but this keeps the log message shape
 * consistent with the pre-parallel implementation).
 *
 * `summarise` returning `null` suppresses the log line — used by
 * the portfolios-snapshot channel to skip the "another tick already
 * running" noise on every worker cycle.
 */
async function runTick<T extends { ranAt: string }>(
  label: string,
  fn: () => Promise<T>,
  summarise: (r: T) => string | null,
): Promise<void> {
  try {
    const r = await fn();
    const line = summarise(r);
    if (line !== null) {
      // eslint-disable-next-line no-console
      console.log(`[worker] ${label} ${r.ranAt} — ${line}`);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[worker] ${label} threw:`, err);
  }
}
