/**
 * Bot orchestration — one worker loop that fans out into every alert
 * channel we support (technical signals, 6-signal resonance,
 * sector-level 6-signal resonance, portfolio insiders, insider stock
 * watches, news subscriptions, portfolio-risk).
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
import { runSectorResonanceTick } from "../sector-resonance-watch/engine";
import { runSectorTechnicalTick } from "../sector-technical-watch/engine";
import { runPortfolioRiskTick } from "../portfolio-risk/engine";
import { runPortfolioSnapshotTick } from "../portfolios-cache/engine";

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
      // Portfolio-watch tick — followed politicians / insiders /
      // fund-manager filings. Underlying report fetches are cached
      // (portfolios TTL ~6h), so this is cheap when nothing has
      // changed.
      try {
        const pt = await runPortfolioTick();
        // eslint-disable-next-line no-console
        console.log(
          `[worker] portfolio-tick ${pt.ranAt} — ` +
            `watches=${pt.watchCount} probed=${pt.presetsProbed} events=${pt.eventsSeen} ` +
            `matched=${pt.eventsMatched} notified=${pt.notifiesSent} errors=${pt.errors.length}`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[worker] portfolio-tick threw:", err);
      }
      // Stock-watch tick — per-ticker insider transaction alerts.
      try {
        const st = await runStockTick();
        // eslint-disable-next-line no-console
        console.log(
          `[worker] stock-tick ${st.ranAt} — ` +
            `watches=${st.watchCount} probed=${st.tickersProbed} tx=${st.transactionsSeen} ` +
            `matched=${st.transactionsMatched} notified=${st.notifiesSent} errors=${st.errors.length}`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[worker] stock-tick threw:", err);
      }
      // News-watch tick — subscribed tickers get Telegram on any new
      // headline. Also silently accumulates the DB history that the
      // News page reads back to the user.
      try {
        const nt = await runNewsTick();
        // eslint-disable-next-line no-console
        console.log(
          `[worker] news-tick ${nt.ranAt} — ` +
            `subs=${nt.subscriptionCount} probed=${nt.tickersProbed} items=${nt.itemsSeen} ` +
            `new=${nt.itemsNew} notified=${nt.notifiesSent} errors=${nt.errors.length}`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[worker] news-tick threw:", err);
      }
      // Technical-signal alerts — per-ticker rules for scheduled
      // daily digests and on-change notifications.
      try {
        const tt = await runTechnicalTick();
        // eslint-disable-next-line no-console
        console.log(
          `[worker] technical-tick ${tt.ranAt} — ` +
            `alerts=${tt.alertCount} evaluated=${tt.tickersEvaluated} ` +
            `digests=${tt.digestsSent} changes=${tt.changesSent} errors=${tt.errors.length}`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[worker] technical-tick threw:", err);
      }
      // 6-Signal Resonance alerts — parallel to the technical-signal
      // path but driven off the resonance strategy.
      try {
        const rt = await runResonanceTick();
        // eslint-disable-next-line no-console
        console.log(
          `[worker] resonance-tick ${rt.ranAt} — ` +
            `alerts=${rt.alertCount} evaluated=${rt.tickersEvaluated} ` +
            `digests=${rt.digestsSent} changes=${rt.changesSent} errors=${rt.errors.length}`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[worker] resonance-tick threw:", err);
      }
      // Sector 6-Signal Resonance alerts — identical shape to the
      // per-ticker resonance tick above, but keyed by market
      // segment. Each rule resolves its segment slug to a proxy
      // ETF at evaluation time so the resonance math itself is
      // reused. Kept as its own tick (rather than merged into the
      // ticker one) so a stale sector row can't mask ticker
      // errors and vice versa.
      try {
        const srt = await runSectorResonanceTick();
        // eslint-disable-next-line no-console
        console.log(
          `[worker] sector-resonance-tick ${srt.ranAt} — ` +
            `alerts=${srt.alertCount} evaluated=${srt.segmentsEvaluated} ` +
            `digests=${srt.digestsSent} changes=${srt.changesSent} errors=${srt.errors.length}`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[worker] sector-resonance-tick threw:", err);
      }
      // Sector Technical Signal alerts — identical architecture to
      // the sector-resonance tick above but drives the multi-
      // indicator Technical Signal scorer instead of the 6-signal
      // resonance strategy. Kept as its own tick so a stale sector
      // row can't mask ticker errors and vice versa, and so a
      // failure in one scorer's proxy fetch doesn't block the other.
      try {
        const stt = await runSectorTechnicalTick();
        // eslint-disable-next-line no-console
        console.log(
          `[worker] sector-technical-tick ${stt.ranAt} — ` +
            `alerts=${stt.alertCount} evaluated=${stt.segmentsEvaluated} ` +
            `digests=${stt.digestsSent} changes=${stt.changesSent} errors=${stt.errors.length}`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[worker] sector-technical-tick threw:", err);
      }
      // Portfolio delisting / bankruptcy risk — walks every symbol
      // the client asked to monitor and fires a push when a fresh
      // critical/high signal emerges.
      try {
        const prt = await runPortfolioRiskTick();
        // eslint-disable-next-line no-console
        console.log(
          `[worker] portfolio-risk-tick ${prt.ranAt} — ` +
            `watches=${prt.watchCount} evaluated=${prt.tickersEvaluated} ` +
            `risky=${prt.riskyCount} sent=${prt.notifiesSent} errors=${prt.errors.length}`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[worker] portfolio-risk-tick threw:", err);
      }
      // Portfolios snapshot cache — walks user-visited politician /
      // fund / insider snapshots whose freshness window has expired
      // and re-fetches them, so /portfolios pages open instantly on
      // the next visit. See `lib/portfolios-cache/engine.ts` for the
      // batching + concurrency policy (kept small so we don't
      // starve the more time-sensitive alert ticks above).
      try {
        const pst = await runPortfolioSnapshotTick();
        if (!pst.skipped) {
          // eslint-disable-next-line no-console
          console.log(
            `[worker] portfolios-snapshot-tick ${pst.ranAt} — ` +
              `due=${pst.dueCount} attempted=${pst.attempted} refreshed=${pst.refreshed} ` +
              `upstreamDown=${pst.upstreamUnavailable} errors=${pst.errors.length}`,
          );
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[worker] portfolios-snapshot-tick threw:", err);
      }
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
