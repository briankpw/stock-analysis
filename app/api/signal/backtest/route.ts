/**
 * `POST /api/signal/backtest` — run a signal on historical bars and
 * return the equity curve, trade log, and headline metrics.
 *
 * ## Contract
 *
 * Request body (Zod-validated):
 *
 *   ```
 *   {
 *     ticker:        string,       // e.g. "AAPL"
 *     strategy:      BacktestStrategy, // 3 composite + 7 single-indicator
 *                                     // (see lib/signal-backtest for full list)
 *     execution:     "nextOpen" | "sameClose",
 *     sizing:        SizingConfig, // see lib/signal-backtest
 *     startingCash:  number,       // > 0
 *     period:        "6mo" | "1y" | "2y" | "5y" | "10y" | "max",
 *     includeFearGreed?: boolean,  // default false — see notes below
 *     targets?:      TargetsConfig, // optional SL/TP overlay:
 *                                   //   { kind: "off" }               (default)
 *                                   //   { kind: "fixed_pct", stopLossPct?, takeProfitPct? }
 *                                   //   { kind: "smart" }             (data-driven,
 *                                   //     reuses the paper-trading recommender)
 *   }
 *   ```
 *
 * Response body:
 *
 *   ```
 *   {
 *     ok: true,
 *     ticker, strategy, execution, sizing, startingCash, period,
 *     firstBarAt, lastBarAt,       // ISO strings
 *     result: BacktestResult,      // engine's raw output
 *     savedId: number | null,      // populated when persisted to
 *                                  // backtest_runs; null on skip
 *                                  // or if persistence errored
 *   }
 *   ```
 *
 * ## Persistence
 *
 * By default the completed run is persisted to `backtest_runs` (see
 * `lib/backtest-store.ts`) so it turns up in the /backtest history
 * list. The store enforces a rolling cap so the table can't grow
 * unbounded. Callers who explicitly *don't* want persistence (e.g.
 * a comparison "what-if" preview) can pass `persist: false` in the
 * request body.
 *
 * ## Rate-limit posture
 *
 * The endpoint reads a full historical bar series via `fetchHistory`,
 * which hits Yahoo. `fetchHistory` already caches keyed by
 * `(ticker, period, interval)`, so a second identical POST for the
 * same triple is served from the in-process cache without a second
 * upstream call. Combined with the app-wide middleware rate limit,
 * this is safe to expose without a dedicated per-endpoint throttle.
 *
 * ## Fear & Greed handling
 *
 * The technical scorer takes an optional `fearGreedScore` and, when
 * present, contributes a *contrarian* vote. But we don't have
 * historical F&G data — CNN publishes the current value only. If the
 * caller opts in via `includeFearGreed: true`, we fetch the CURRENT
 * value and apply it uniformly across all historical bars. That's
 * dishonest for a backtest (past bars would have seen a different
 * F&G) so it defaults to `false`; the UI surfaces a warning when
 * this is on.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchHistory } from "@/lib/data";
import { fetchFearGreedPayload } from "@/lib/fear-greed";
import { runBacktest, type BacktestConfig } from "@/lib/signal-backtest";
import { saveRun } from "@/lib/backtest-store";
import { redactError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sizingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all_in") }),
  z.object({
    kind: z.literal("fixed_shares"),
    shares: z.number().int().positive().finite(),
  }),
  z.object({
    kind: z.literal("percent_equity"),
    pct: z.number().gt(0).lte(1),
  }),
]);

/**
 * Stop-loss / take-profit overlay. See `lib/signal-backtest.ts` for
 * the engine-side semantics (per-bar order of operations, gap-aware
 * fills, the same-bar SL-vs-TP tiebreaker). Percent values are
 * capped at 0.5 (50%) — beyond that they're effectively "off" for a
 * daily bar strategy, and the cap prevents typos like "typing 50 for
 * fifty" from becoming "5000% stop".
 */
const targetsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("off") }),
  z.object({
    kind: z.literal("fixed_pct"),
    stopLossPct: z.number().gt(0).lte(0.5).optional(),
    takeProfitPct: z.number().gt(0).lte(2).optional(),
  }),
  z.object({ kind: z.literal("smart") }),
]);

const bodySchema = z.object({
  ticker: z
    .string()
    .min(1)
    .max(12)
    .regex(/^[A-Za-z0-9.\-]+$/, "ticker must be alphanumeric with `.` or `-`"),
  strategy: z.enum([
    // Composite strategies (multi-indicator scoring).
    "technical",
    "resonance",
    "master",
    // Single-indicator strategies. Each maps to one indicator on
    // the Charts & Indicators page. See `lib/signal-backtest.ts`
    // module header for the exact per-bar rule and rationale.
    "sma_cross",
    "ema_cross",
    "macd_cross",
    "rsi_reversion",
    "kdj_cross",
    "bbands_reversion",
    "sr_bounce",
  ]),
  execution: z.enum(["nextOpen", "sameClose"]),
  sizing: sizingSchema,
  startingCash: z.number().positive().finite(),
  period: z.enum(["6mo", "1y", "2y", "5y", "10y", "max"]),
  includeFearGreed: z.boolean().optional(),
  /**
   * Optional short human label persisted alongside the run so it
   * shows up in the /backtest history list under something more
   * memorable than "TICKER · Strategy · Period". When omitted, the
   * store auto-generates one.
   */
  label: z.string().max(80).optional(),
  /**
   * When true (the default), the completed run is persisted to
   * `backtest_runs` so it shows up in the history list. Callers that
   * just want a one-off preview (e.g. a comparison "what would have
   * happened if …?" tooltip) can pass `false` to skip persistence.
   */
  persist: z.boolean().optional(),
  /**
   * Optional stop-loss / take-profit overlay. Defaults to
   * `{ kind: "off" }` inside the engine when omitted, so callers who
   * never send this field see the original signal-only behaviour.
   */
  targets: targetsSchema.optional(),
});

export async function POST(req: Request) {
  try {
    const body = bodySchema.parse(await req.json());

    // Interval hard-coded to daily. Intraday backtests would need a
    // different `fetchHistory` intent (Yahoo intraday capped at 60
    // days) and a different warm-up story, and the on-screen
    // verdict itself is daily, so daily is the honest default for
    // "does the signal work?".
    const bars = await fetchHistory(body.ticker, body.period, "1d");
    if (bars.length === 0) {
      return NextResponse.json(
        { ok: false, error: `No historical data for ${body.ticker}` },
        { status: 404 },
      );
    }

    // Optional F&G — see the header comment for the caveat.
    let fearGreedScore: number | null = null;
    if (body.includeFearGreed) {
      try {
        const fg = await fetchFearGreedPayload();
        fearGreedScore = fg.fear_and_greed.score;
      } catch {
        fearGreedScore = null;
      }
    }

    const config: BacktestConfig = {
      strategy: body.strategy,
      execution: body.execution,
      sizing: body.sizing,
      startingCash: body.startingCash,
      fearGreedScore,
      targets: body.targets,
    };
    const result = runBacktest(bars, config);

    const firstBarAt = new Date(bars[0]!.time * 1000).toISOString();
    const lastBarAt = new Date(bars[bars.length - 1]!.time * 1000).toISOString();

    // Persist by default so the run shows up in the /backtest history
    // list. Any failure to save shouldn't fail the whole request —
    // the user can still see the fresh result on-screen.
    let savedId: number | null = null;
    if (body.persist !== false) {
      try {
        const saved = saveRun({
          ticker: body.ticker,
          strategy: body.strategy,
          execution: body.execution,
          period: body.period,
          startingCash: body.startingCash,
          label: body.label,
          firstBarAt,
          lastBarAt,
          config,
          result,
        });
        savedId = saved.id;
      } catch (err) {
        console.error(
          "[api/signal/backtest] persist failed (result still returned to client):",
          err instanceof Error ? err.message : err,
        );
      }
    }

    return NextResponse.json({
      ok: true,
      ticker: body.ticker.toUpperCase(),
      strategy: body.strategy,
      execution: body.execution,
      sizing: body.sizing,
      startingCash: body.startingCash,
      period: body.period,
      firstBarAt,
      lastBarAt,
      result,
      savedId,
    });
  } catch (e) {
    const r = redactError(e, 400);
    return NextResponse.json(
      { ok: false, error: r.message },
      { status: r.status },
    );
  }
}
