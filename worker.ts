#!/usr/bin/env tsx
/**
 * Bot worker entrypoint. Runs the strategy-evaluation loop in a **separate
 * process** from the Next.js UI, so a crash in the worker doesn't take the
 * UI down (and vice versa).
 *
 * All the interesting logic lives in `lib/bot/engine.ts`. This file is a
 * thin shim so `npm run worker` (= `tsx worker.ts`) does the right thing.
 */

import { runForever } from "./lib/bot/engine";

const ticker = (process.env.STOCK_TICKER || "KEYS").toUpperCase();

// eslint-disable-next-line no-console
console.log(`[worker] starting bot loop for ${ticker}`);
runForever(ticker)
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
