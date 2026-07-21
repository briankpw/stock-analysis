/**
 * Environment-driven tuning parameters for the three single-indicator
 * backtest strategies whose window / threshold values were previously
 * hard-coded in `lib/signal-backtest.ts`:
 *
 *   * `sma_cross`     — fast/slow SMA windows (default 50 / 200)
 *   * `ema_cross`     — fast/slow EMA windows (default 20 / 52)
 *   * `rsi_reversion` — RSI period + oversold/overbought thresholds
 *                       (default 14 / 30 / 70)
 *
 * ## Why `NEXT_PUBLIC_*`?
 *
 * The backtest engine itself only runs on the server, but the strategy
 * picker in the UI needs to render "SMA Cross (50/200)" etc. with the
 * *configured* numbers — otherwise a user who tuned the env would see
 * misleading labels. Using the `NEXT_PUBLIC_` prefix has Next.js inline
 * the value into the client bundle at build time so both the engine and
 * the UI read from a single source. A container rebuild is required to
 * pick up a change; that's fine for tuning knobs (this isn't a per-user
 * setting) and it means the client can't be tricked into using stale
 * server values via a runtime injection.
 *
 * ## Validation & fallback
 *
 * We deliberately never THROW on bad input — a misconfigured env var
 * should never take the whole app down. Instead each unparseable /
 * out-of-bound value is logged once and silently falls back to the
 * baked-in default. Ordering constraints (`fast < slow`,
 * `oversold < overbought`) are enforced likewise: if the user sets
 * `SMA_FAST=200 SMA_SLOW=50` we log and reset BOTH to the pair's
 * defaults so the strategy definitely trades sensibly.
 */

const FALLBACK = {
  smaFast: 50,
  smaSlow: 200,
  emaFast: 20,
  emaSlow: 52,
  rsiPeriod: 14,
  rsiOversold: 30,
  rsiOverbought: 70,
} as const;

// -------------------------------------------------------------------
// Low-level parsers
// -------------------------------------------------------------------

/**
 * Parse a positive integer within [min, max]. Returns `null` when the
 * input is missing, not a finite number, or outside the range — the
 * caller then decides how to log + fall back so we can emit ONE
 * warning per config knob (a single warning is helpful; two per knob
 * is noise).
 */
function _parsePosInt(
  raw: string | undefined,
  { min, max }: { min: number; max: number },
): number | null {
  if (!raw) return null;
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) return null;
  if (!Number.isInteger(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

function _warnOnce(name: string, raw: string | undefined, reason: string) {
  // eslint-disable-next-line no-console
  console.warn(
    `[backtest-strategy-config] ${name}=${JSON.stringify(raw)} rejected (${reason}); falling back to default.`,
  );
}

// -------------------------------------------------------------------
// Pair resolvers — each returns a fully-resolved (fast, slow) tuple
// -------------------------------------------------------------------

function _resolvePair(
  label: "SMA" | "EMA",
  fastEnv: string | undefined,
  slowEnv: string | undefined,
  fallbackFast: number,
  fallbackSlow: number,
  bounds: { min: number; max: number },
): { fast: number; slow: number } {
  let fast = _parsePosInt(fastEnv, bounds);
  let slow = _parsePosInt(slowEnv, bounds);
  if (fastEnv && fast === null) {
    _warnOnce(
      `NEXT_PUBLIC_BACKTEST_${label}_FAST`,
      fastEnv,
      `must be an integer in [${bounds.min}, ${bounds.max}]`,
    );
    fast = null;
  }
  if (slowEnv && slow === null) {
    _warnOnce(
      `NEXT_PUBLIC_BACKTEST_${label}_SLOW`,
      slowEnv,
      `must be an integer in [${bounds.min}, ${bounds.max}]`,
    );
    slow = null;
  }
  const resolvedFast = fast ?? fallbackFast;
  const resolvedSlow = slow ?? fallbackSlow;
  if (resolvedFast >= resolvedSlow) {
    _warnOnce(
      `NEXT_PUBLIC_BACKTEST_${label}_FAST / _SLOW`,
      `${resolvedFast}/${resolvedSlow}`,
      "fast must be strictly less than slow",
    );
    return { fast: fallbackFast, slow: fallbackSlow };
  }
  return { fast: resolvedFast, slow: resolvedSlow };
}

function _resolveRsi(): {
  period: number;
  oversold: number;
  overbought: number;
} {
  const rawPeriod = process.env.NEXT_PUBLIC_BACKTEST_RSI_PERIOD;
  const rawOversold = process.env.NEXT_PUBLIC_BACKTEST_RSI_OVERSOLD;
  const rawOverbought = process.env.NEXT_PUBLIC_BACKTEST_RSI_OVERBOUGHT;

  let period = _parsePosInt(rawPeriod, { min: 2, max: 200 });
  if (rawPeriod && period === null) {
    _warnOnce(
      "NEXT_PUBLIC_BACKTEST_RSI_PERIOD",
      rawPeriod,
      "must be an integer in [2, 200]",
    );
  }
  // Thresholds accept any integer in (0, 100). We reject 0 and 100
  // because they'd make the strategy either always-flat or always-
  // firing on the boundary.
  let oversold = _parsePosInt(rawOversold, { min: 1, max: 99 });
  if (rawOversold && oversold === null) {
    _warnOnce(
      "NEXT_PUBLIC_BACKTEST_RSI_OVERSOLD",
      rawOversold,
      "must be an integer in [1, 99]",
    );
  }
  let overbought = _parsePosInt(rawOverbought, { min: 1, max: 99 });
  if (rawOverbought && overbought === null) {
    _warnOnce(
      "NEXT_PUBLIC_BACKTEST_RSI_OVERBOUGHT",
      rawOverbought,
      "must be an integer in [1, 99]",
    );
  }

  const resolvedPeriod = period ?? FALLBACK.rsiPeriod;
  const resolvedOversold = oversold ?? FALLBACK.rsiOversold;
  const resolvedOverbought = overbought ?? FALLBACK.rsiOverbought;
  if (resolvedOversold >= resolvedOverbought) {
    _warnOnce(
      "NEXT_PUBLIC_BACKTEST_RSI_OVERSOLD / _OVERBOUGHT",
      `${resolvedOversold}/${resolvedOverbought}`,
      "oversold must be strictly less than overbought",
    );
    return {
      period: resolvedPeriod,
      oversold: FALLBACK.rsiOversold,
      overbought: FALLBACK.rsiOverbought,
    };
  }
  return {
    period: resolvedPeriod,
    oversold: resolvedOversold,
    overbought: resolvedOverbought,
  };
}

// -------------------------------------------------------------------
// Public surface
// -------------------------------------------------------------------

/**
 * The final, validated parameters used by the backtest engine AND
 * the UI. Resolved once at module load — `NEXT_PUBLIC_*` values are
 * static across a process's lifetime, so re-reading per call would
 * just add overhead.
 */
export const BACKTEST_STRATEGY_PARAMS: {
  readonly smaCross: { readonly fast: number; readonly slow: number };
  readonly emaCross: { readonly fast: number; readonly slow: number };
  readonly rsiReversion: {
    readonly period: number;
    readonly oversold: number;
    readonly overbought: number;
  };
} = (() => {
  const sma = _resolvePair(
    "SMA",
    process.env.NEXT_PUBLIC_BACKTEST_SMA_FAST,
    process.env.NEXT_PUBLIC_BACKTEST_SMA_SLOW,
    FALLBACK.smaFast,
    FALLBACK.smaSlow,
    { min: 2, max: 500 },
  );
  const ema = _resolvePair(
    "EMA",
    process.env.NEXT_PUBLIC_BACKTEST_EMA_FAST,
    process.env.NEXT_PUBLIC_BACKTEST_EMA_SLOW,
    FALLBACK.emaFast,
    FALLBACK.emaSlow,
    { min: 2, max: 500 },
  );
  const rsi = _resolveRsi();
  return Object.freeze({
    smaCross: Object.freeze(sma),
    emaCross: Object.freeze(ema),
    rsiReversion: Object.freeze(rsi),
  });
})();
