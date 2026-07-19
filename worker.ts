#!/usr/bin/env tsx
/**
 * Bot worker entrypoint. Runs every alert-channel tick loop
 * (portfolio, insider, news, technical, resonance, portfolio-risk) in
 * a **separate process** from the Next.js UI, so a crash in the worker
 * doesn't take the UI down (and vice versa).
 *
 * All the interesting logic lives in `lib/bot/engine.ts`. This file is a
 * thin shim so `npm run worker` (= `tsx worker.ts`) does the right thing.
 *
 * `STOCK_TICKER` used to select which symbol the legacy strategy tick
 * evaluated; that tick was removed in July 2026 (see engine.ts) so the
 * env var is no longer read — but kept in the startup log so operators
 * running old dashboards still see a familiar message.
 */

import { runForever } from "./lib/bot/engine";

const legacyTickerLabel = (process.env.STOCK_TICKER || "KEYS").toUpperCase();

// eslint-disable-next-line no-console
console.log(`[worker] starting alert loop (legacy label=${legacyTickerLabel})`);
runForever()
  .then(() => {
    // eslint-disable-next-line no-console
    console.log("[worker] loop exited cleanly");
    process.exit(0);
  })
  .catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("[worker] fatal:", err);
    process.exit(1);
  });
