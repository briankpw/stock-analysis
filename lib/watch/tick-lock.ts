/**
 * Shared "run a background watch tick" scaffolding.
 *
 * All five watch engines (technical, resonance, news, stock, portfolio)
 * used to duplicate this boilerplate at the top of their `run*Tick()`
 * entrypoint:
 *
 * ```ts
 * const release = tryLockTick("technical");
 * if (!release) {
 *   report.ok = false;
 *   report.errors.push("Another <name> tick is already running.");
 *   return report;
 * }
 * try {
 *   return await run<Name>TickBody(ranAt, report);
 * } finally {
 *   release();
 * }
 * ```
 *
 * That's 5×~10 lines with subtly different error-message wording and
 * one place (`resonance`) that historically forgot to update the report
 * flag on a failed lock. Centralising it here:
 *
 *   * kills the copy-paste;
 *   * standardises the "another tick is already running" wording so
 *     an operator scanning `bot_state` sees uniform errors across
 *     engines;
 *   * makes it structurally impossible to acquire the lock and forget
 *     to release it — the `finally` lives in exactly one function.
 *
 * The helper is intentionally not `async` at the outer layer — it
 * returns the promise from `body(ranAt)` directly so stack traces stay
 * clean and the wrapper doesn't add its own frame to every rejection.
 */

import { tryLockTick } from "@/lib/bot/store";

/**
 * Minimum shape every tick report shares. Concrete engines extend this
 * with their own per-engine counters (tickersEvaluated, itemsSeen, …).
 */
export interface BaseTickReport {
  ok: boolean;
  ranAt: string;
  errors: string[];
}

/**
 * Run `body` under the named tick-lock. If another process already
 * holds the lock, sets `ok=false` on the report, appends a standard
 * error message, and returns without invoking `body`.
 *
 * On body completion (success OR throw) the lock is always released.
 * Body-thrown errors propagate to the caller — engines that want
 * per-tick error containment should catch inside `body`.
 */
export async function withTickLock<TReport extends BaseTickReport>(
  name: string,
  report: TReport,
  body: () => Promise<TReport>,
): Promise<TReport> {
  const release = tryLockTick(name);
  if (!release) {
    report.ok = false;
    // Lock keys use snake_case (e.g. "portfolio_risk") because they
    // double as DB identifiers; the user-facing message reads better
    // with hyphens. Cheap sub-in avoids adding a separate displayName
    // parameter to every call site.
    const display = name.replace(/_/g, "-");
    report.errors.push(`Another ${display} tick is already running.`);
    return report;
  }
  try {
    return await body();
  } finally {
    release();
  }
}
