/**
 * End-to-end smoke test for the stock-watch pipeline.
 *
 * 1. Resolve AAPL → CIK via SEC's ticker map.
 * 2. Fetch the most recent insider transactions at that CIK.
 * 3. Save an AAPL watch, run one stock tick (dry — Telegram may not
 *    be configured; the tick still records notifications).
 * 4. Verify dedup by running the tick twice and asserting the second
 *    pass produces zero new events.
 * 5. Clean up (delete the watch + any notifications inserted).
 */

/* eslint-disable no-console */

import { resolveTickerCik } from "../lib/stock-watch/ticker-cik";
import { fetchIssuerInsiderTransactions } from "../lib/stock-watch/sec-issuer";
import {
  deleteStockWatch,
  clearStockNotifications,
  upsertStockWatch,
  recentStockNotifications,
} from "../lib/stock-watch/store";
import { runStockTick } from "../lib/stock-watch/engine";

const TARGET = process.env.SMOKE_TICKER || "AAPL";

async function main() {
  console.log(`--- resolveTickerCik(${TARGET}) ---`);
  const hit = await resolveTickerCik(TARGET);
  if (!hit) {
    console.error(`FAIL: SEC ticker map didn't know ${TARGET}`);
    process.exit(1);
  }
  console.log(`  → cik=${hit.cik} name=${hit.name}`);

  console.log(`--- fetchIssuerInsiderTransactions(${hit.cik}, ${TARGET}) ---`);
  const rep = await fetchIssuerInsiderTransactions(hit.cik, TARGET, 10);
  console.log(
    `  → issuer=${rep.issuerName} filingsParsed=${rep.filingsParsed} ` +
      `filingsSkipped=${rep.filingsSkipped} transactions=${rep.transactions.length}`,
  );
  if (rep.transactions.length > 0) {
    const first = rep.transactions[0]!;
    console.log(
      `  first: ${first.action} ${first.actionLabel} by ${first.reporterName} ` +
        `(${first.reporterRelation ?? "—"}) ${first.shares} @ ` +
        `${first.pricePerShare ?? "?"} on ${first.transactionDate ?? "?"}`,
    );
  }

  // Clean slate for the notifications table so dedup counts are honest.
  const prevCleared = clearStockNotifications();
  console.log(`--- cleared ${prevCleared} pre-existing stock notifications ---`);

  console.log(`--- upsertStockWatch(${TARGET}) + runStockTick() (pass 1) ---`);
  upsertStockWatch(TARGET, ["BUY", "SELL"], hit.cik);
  const t1 = await runStockTick();
  console.log(
    `  → seen=${t1.transactionsSeen} matched=${t1.transactionsMatched} ` +
      `notifies=${t1.notifiesSent} errors=${t1.errors.length}`,
  );
  if (t1.errors.length > 0) console.log("  errors:", t1.errors);

  console.log(`--- runStockTick() (pass 2 — expecting dedup, notifiesSent=0) ---`);
  const t2 = await runStockTick();
  console.log(
    `  → seen=${t2.transactionsSeen} matched=${t2.transactionsMatched} ` +
      `notifies=${t2.notifiesSent} errors=${t2.errors.length}`,
  );

  const stored = recentStockNotifications(5);
  console.log(`--- recentStockNotifications(5) ---`);
  for (const n of stored) {
    console.log(
      `  ${n.action} ${n.actionLabel} · ${n.ticker} · ${n.reporterName} ` +
        `· telegram_ok=${n.telegramOk}`,
    );
  }

  // Teardown
  deleteStockWatch(TARGET);
  clearStockNotifications();
  console.log("--- teardown complete ---");

  // Assertions
  const pass1Ok =
    t1.transactionsMatched === 0 ? true : t1.notifiesSent + (t1.errors.filter((e) => e.startsWith("telegram")).length) > 0;
  const pass2Ok = t2.notifiesSent === 0;
  if (!pass2Ok) {
    console.error("FAIL: dedup didn't hold — pass 2 sent Telegram messages");
    process.exit(1);
  }
  if (!pass1Ok && t1.transactionsMatched > 0) {
    console.error("FAIL: pass 1 didn't attempt to send anything");
    process.exit(1);
  }
  console.log("\nSMOKE PASS");
}

main().catch((err) => {
  console.error("SMOKE FAIL:", err);
  process.exit(1);
});
