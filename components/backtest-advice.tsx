/**
 * Beginner-mode explainer for a backtest result.
 *
 * Renders only when the user has "Beginner" experience selected in
 * the sidebar (checked via `useIsBeginner()`). A hidden component
 * on the pro/expert setting; a plain-English paragraph + bullet list
 * on beginner.
 *
 * ## What the copy is trying to teach
 *
 * The default result panel (see `backtest-panels.tsx`) shows raw
 * numbers — `+12.4%`, `-8.2% drawdown`, `54% win rate`. A beginner
 * doesn't know:
 *
 *   1. Whether "beat buy & hold" is the point (it is, mostly, but
 *      not by a couple of percent — you should account for how much
 *      LESS risk you took).
 *   2. What a drawdown "feels like" (a 22% drawdown means: at the
 *      worst moment during this test, your account was down 22%
 *      from its peak — could you sit through that in real life?).
 *   3. Whether a 54% win rate is good (it depends on the payoff
 *      ratio: 54% wins × 1.5× payoff = great; 54% wins × 0.5× payoff
 *      = you're bleeding out).
 *   4. What "8% exposure" means (you were in the market only 8% of
 *      the time — the signal barely traded, so a "great" return over
 *      such little exposure is likely random noise).
 *
 * Rather than dumping five paragraphs of definitions, this component
 * emits one **verdict headline** (bullish / cautionary / neutral)
 * followed by three or four **decision-relevant bullets** picked
 * based on the actual numbers. Every bullet is one sentence, no
 * jargon, no absolute prescriptions.
 *
 * ## Why the logic lives here (not in the engine)
 *
 * The engine (`lib/signal-backtest.ts`) is a pure calculator — it
 * shouldn't decide what's "good" or "bad", because those thresholds
 * are opinionated and could evolve. Keeping the classification in
 * the component means we can tweak wording, add scenarios, or A/B
 * test copy without touching the deterministic core.
 */

"use client";

import * as React from "react";
import { Lightbulb } from "lucide-react";
import { useIsBeginner } from "@/lib/state";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BacktestResponse } from "@/components/backtest-panels";

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export function BacktestAdvice({ response }: { response: BacktestResponse }) {
  const beginner = useIsBeginner();
  const t = useT();
  if (!beginner) return null;

  const advice = classifyBacktest(response);

  return (
    <div
      className={cn(
        "rounded-md border p-3 space-y-2",
        advice.tone === "positive" && "border-success/40 bg-success/5",
        advice.tone === "negative" && "border-danger/40 bg-danger/5",
        advice.tone === "neutral" && "border-border bg-card/50",
      )}
    >
      <div className="flex items-start gap-2">
        <Lightbulb
          className={cn(
            "h-4 w-4 mt-0.5 shrink-0",
            advice.tone === "positive" && "text-success",
            advice.tone === "negative" && "text-danger",
            advice.tone === "neutral" && "text-primary",
          )}
        />
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("backtest.advice.title")}
          </p>
          <p className="text-sm font-medium">
            {t(advice.headlineKey, advice.headlineVars)}
          </p>
        </div>
      </div>
      <ul className="ml-6 space-y-1 text-xs text-muted-foreground list-disc marker:text-muted-foreground/60">
        {advice.bullets.map((b) => (
          <li key={b.key}>{t(b.key, b.vars)}</li>
        ))}
      </ul>
      <p className="ml-6 text-[0.7rem] text-muted-foreground/80 italic">
        {t("backtest.advice.disclaimer")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

type AdviceTone = "positive" | "negative" | "neutral";

interface AdviceBullet {
  key: string;
  vars?: Record<string, string | number>;
}

interface Advice {
  tone: AdviceTone;
  headlineKey: string;
  headlineVars: Record<string, string | number>;
  bullets: AdviceBullet[];
}

/**
 * Turn raw metrics into (headline, tone, ~3 bullets).
 *
 * The classification is intentionally conservative — we lean toward
 * "cautionary" or "neutral" whenever the sample is too small or the
 * strategy didn't take enough trades to statistically distinguish
 * skill from luck. That's the honest read for a beginner: it's
 * easier to fool yourself with a lucky 3-trade winner than with a
 * modest 40-trade signal.
 */
function classifyBacktest(response: BacktestResponse): Advice {
  const m = response.result.metrics;
  const bullets: AdviceBullet[] = [];

  const beatBuyHold = m.totalReturn > m.buyHoldReturn;
  const strategyPositive = m.totalReturn > 0;
  const buyHoldPositive = m.buyHoldReturn > 0;
  const exposure = m.exposureFraction;
  const drawdown = m.maxDrawdown;
  const buyHoldDrawdown = m.buyHoldMaxDrawdown;
  const trades = m.tradeCount;
  const roundTrips = m.roundTrips;
  const winRate = m.winRate;
  const payoff = m.payoffRatio;
  const currency = fmtCurrencyPlain(m.finalEquity);
  const startingCash = fmtCurrencyPlain(response.startingCash);

  // ---- Tone + headline ---------------------------------------------------

  // "Too few trades" ALWAYS demotes the headline to neutral — the
  // sample is too thin to trust any positive read.
  const enoughTrades = trades >= 6;

  let tone: AdviceTone;
  let headlineKey: string;
  const headlineVars: Record<string, string | number> = {
    ticker: response.ticker,
    startingCash,
    finalCash: currency,
    totalReturn: fmtSignedPct(m.totalReturn),
    buyHoldReturn: fmtSignedPct(m.buyHoldReturn),
  };

  if (!enoughTrades) {
    tone = "neutral";
    headlineKey = "backtest.advice.headline.fewTrades";
  } else if (beatBuyHold && strategyPositive) {
    tone = "positive";
    headlineKey = "backtest.advice.headline.outperformed";
  } else if (beatBuyHold && !strategyPositive) {
    // Strategy lost less than buy & hold — a "safer loss".
    tone = "neutral";
    headlineKey = "backtest.advice.headline.lostLess";
  } else if (!beatBuyHold && strategyPositive && buyHoldPositive) {
    tone = "neutral";
    headlineKey = "backtest.advice.headline.underperformedButPositive";
  } else {
    tone = "negative";
    headlineKey = "backtest.advice.headline.underperformed";
  }

  // ---- Bullets -----------------------------------------------------------

  // 1) Drawdown pain-check — always shown, always relevant.
  bullets.push({
    key: "backtest.advice.bullet.drawdown",
    vars: {
      drawdown: fmtPctPositive(drawdown),
      buyHoldDrawdown: fmtPctPositive(buyHoldDrawdown),
      loss: fmtCurrencyPlain(response.startingCash * drawdown),
      startingCash,
    },
  });

  // 2) Trade count / statistical significance.
  if (trades === 0) {
    bullets.push({ key: "backtest.advice.bullet.noTrades" });
  } else if (!enoughTrades) {
    bullets.push({
      key: "backtest.advice.bullet.fewTrades",
      vars: { trades, roundTrips: Math.max(0, Math.floor(roundTrips)) },
    });
  } else {
    bullets.push({
      key: "backtest.advice.bullet.tradeCount",
      vars: { trades, roundTrips: Math.max(0, Math.floor(roundTrips)) },
    });
  }

  // 3) Win rate + payoff read.
  if (winRate !== null && payoff !== null && enoughTrades) {
    if (winRate >= 0.5 && payoff >= 1) {
      bullets.push({
        key: "backtest.advice.bullet.winRate.strong",
        vars: { winRate: fmtPctPositive(winRate), payoff: payoff.toFixed(2) },
      });
    } else if (winRate < 0.5 && payoff >= 1.5) {
      bullets.push({
        key: "backtest.advice.bullet.winRate.lowRateHighPayoff",
        vars: { winRate: fmtPctPositive(winRate), payoff: payoff.toFixed(2) },
      });
    } else if (winRate >= 0.5 && payoff < 1) {
      bullets.push({
        key: "backtest.advice.bullet.winRate.highRateLowPayoff",
        vars: { winRate: fmtPctPositive(winRate), payoff: payoff.toFixed(2) },
      });
    } else {
      bullets.push({
        key: "backtest.advice.bullet.winRate.weak",
        vars: { winRate: fmtPctPositive(winRate), payoff: payoff.toFixed(2) },
      });
    }
  }

  // 4) Exposure sanity check — is the "outperformance" just a
  //    function of avoiding the tape entirely?
  if (exposure < 0.15) {
    bullets.push({
      key: "backtest.advice.bullet.exposure.low",
      vars: { exposure: fmtPctPositive(exposure) },
    });
  } else if (exposure > 0.85) {
    bullets.push({
      key: "backtest.advice.bullet.exposure.high",
      vars: { exposure: fmtPctPositive(exposure) },
    });
  } else {
    bullets.push({
      key: "backtest.advice.bullet.exposure.moderate",
      vars: { exposure: fmtPctPositive(exposure) },
    });
  }

  // 5) Execution timing reminder — a subtle bias source many beginners
  //    miss.
  if (response.execution === "sameClose") {
    bullets.push({ key: "backtest.advice.bullet.sameClose" });
  }

  // 6) "Would-fill-tomorrow" call-out.
  if (response.result.hasUnfilledFinalSignal) {
    bullets.push({
      key: "backtest.advice.bullet.unfilledFinal",
      vars: { ticker: response.ticker },
    });
  }

  // 7) Strategy-specific "known weakness" bullet. Always relevant
  //    for single-indicator strategies (each has a well-known
  //    failure mode). Composite strategies (technical / resonance /
  //    master) already balance across indicators so no per-strategy
  //    bullet is emitted for them.
  const weaknessKey = strategyWeaknessKey(response.strategy);
  if (weaknessKey) {
    bullets.push({ key: weaknessKey });
  }

  // 8) SL/TP overlay bullet — only rendered when the overlay was on,
  //    because the whole point of this bullet is to explain what the
  //    overlay did (or didn't do) to the numbers above. We branch on
  //    what fired most: if stops dominated, that's a "protected you
  //    from further losses" read; if TPs dominated, "locked in gains
  //    early"; roughly balanced, "worked as a bracket". A quiet
  //    overlay (nothing hit) gets its own line so the user knows the
  //    SL/TP levels never actually tripped — this often means the
  //    signal already exited before either target could hit.
  const targetsCfg = response.result.config.targets;
  const exitCounts = m.exitCounts;
  const overlayActive = targetsCfg && targetsCfg.kind !== "off";
  const totalExits =
    exitCounts.signal + exitCounts.stopLoss + exitCounts.takeProfit;
  if (overlayActive && totalExits > 0) {
    if (exitCounts.stopLoss === 0 && exitCounts.takeProfit === 0) {
      bullets.push({ key: "backtest.advice.bullet.targets.quiet" });
    } else if (exitCounts.stopLoss > exitCounts.takeProfit) {
      bullets.push({
        key: "backtest.advice.bullet.targets.stopHeavy",
        vars: {
          stops: exitCounts.stopLoss,
          totalExits,
        },
      });
    } else if (exitCounts.takeProfit > exitCounts.stopLoss) {
      bullets.push({
        key: "backtest.advice.bullet.targets.tpHeavy",
        vars: {
          tps: exitCounts.takeProfit,
          totalExits,
        },
      });
    } else {
      bullets.push({
        key: "backtest.advice.bullet.targets.balanced",
        vars: {
          stops: exitCounts.stopLoss,
          tps: exitCounts.takeProfit,
        },
      });
    }
  }

  return { tone, headlineKey, headlineVars, bullets };
}

/**
 * Map each single-indicator strategy to its canonical failure-mode
 * bullet. Returns `null` for composite strategies — those already
 * account for multiple indicators and don't have a one-line
 * cautionary description that would help a beginner.
 */
function strategyWeaknessKey(strategy: string): string | null {
  switch (strategy) {
    case "sma_cross":
      return "backtest.advice.bullet.weakness.smaCross";
    case "ema_cross":
      return "backtest.advice.bullet.weakness.emaCross";
    case "macd_cross":
      return "backtest.advice.bullet.weakness.macdCross";
    case "rsi_reversion":
      return "backtest.advice.bullet.weakness.rsiReversion";
    case "kdj_cross":
      return "backtest.advice.bullet.weakness.kdjCross";
    case "bbands_reversion":
      return "backtest.advice.bullet.weakness.bbandsReversion";
    case "sr_bounce":
      return "backtest.advice.bullet.weakness.srBounce";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Small locale-neutral formatters
// ---------------------------------------------------------------------------
//
// We deliberately don't use `fmtCurrency` from `@/lib/format` here
// because the strings are interpolated inside i18n templates and the
// dictionary already has punctuation/spacing that ships with the
// translated sentence. Keeping the formatter identical across
// locales avoids double-formatting artefacts.

function fmtCurrencyPlain(n: number): string {
  const abs = Math.abs(n);
  const s = abs >= 10_000 ? abs.toFixed(0) : abs.toFixed(2);
  const withCommas = s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${n < 0 ? "-" : ""}${withCommas}`;
}

function fmtSignedPct(x: number): string {
  const pct = x * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function fmtPctPositive(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}
