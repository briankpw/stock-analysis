/* eslint-disable no-console */
/**
 * Smoke test for the portfolio-watch engine.
 *
 *   npx tsx scripts/smoke-portfolio-watch.ts
 *
 * Adds a watch for politicians/pelosi, runs one tick, and dumps the
 * first few notification rows. Telegram will NOT actually push unless
 * TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are set — the rows still show
 * up in the notifications table for inspection.
 */

import {
  clearNotifications,
  deletePersonWatch,
  listWatches,
  recentNotifications,
  upsertPersonWatch,
} from "@/lib/portfolio-watch/store";
import { runPortfolioTick } from "@/lib/portfolio-watch/engine";

async function main() {
  console.log("--- Setup: watch politicians/pelosi ---");
  clearNotifications();
  deletePersonWatch("politicians", "pelosi");

  const w = upsertPersonWatch("politicians", "pelosi");
  console.log("Watch created:", w);
  console.log("All watches:", listWatches().length);

  console.log("\n--- Running portfolio tick ---");
  const report = await runPortfolioTick();
  console.log("Tick report:", JSON.stringify(report, null, 2));

  console.log("\n--- First 5 notifications ---");
  const notes = recentNotifications(5);
  for (const n of notes) {
    console.log(
      `- ${n.action.padEnd(4)} ${n.presetName} · ${n.ticker ?? "(no ticker)"} · ` +
        `${(n.companyName ?? "").slice(0, 32)} · ${n.amountLabel ?? ""}`,
    );
    console.log(`  telegram=${n.telegramOk} (${n.telegramDetail ?? "n/a"})`);
  }
  console.log(`\nTotal notified rows: ${notes.length}`);
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e);
  process.exit(1);
});
