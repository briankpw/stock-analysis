/**
 * Strategy library for the alert bot. Each strategy takes an enriched bar
 * series and returns a `Signal` describing what it saw on the *last closed
 * bar*. Signals are strictly `BUY` / `SELL` / `HOLD` — no fractional
 * conviction, no size sizing (this is an alert bot, not an executor).
 *
 * Mirrors `src/bot/strategy.py`.
 */

import { enrich } from "../indicators";
import type { Bar } from "../indicators";

export type SignalType = "BUY" | "SELL" | "HOLD";

export interface Signal {
  strategy: string;
  type: SignalType;
  price: number | null;
  reason: string;
  barTs: string | null; // ISO of the bar the signal is for
}

// ---- Helpers ---------------------------------------------------------------
function lastBarIso(bars: Bar[]): string | null {
  if (bars.length === 0) return null;
  return new Date(bars[bars.length - 1]!.time * 1000).toISOString();
}

function crossedUp(prev: number | null, curr: number | null, prevRef: number | null, currRef: number | null): boolean {
  if (prev === null || curr === null || prevRef === null || currRef === null) return false;
  return prev <= prevRef && curr > currRef;
}
function crossedDown(prev: number | null, curr: number | null, prevRef: number | null, currRef: number | null): boolean {
  if (prev === null || curr === null || prevRef === null || currRef === null) return false;
  return prev >= prevRef && curr < currRef;
}


// ---- Strategy 1: SMA(50) / SMA(200) golden/death cross --------------------
export function smaCrossover(bars: Bar[]): Signal {
  const name = "SMA 50/200";
  if (bars.length < 200) {
    return { strategy: name, type: "HOLD", price: null, reason: "warming up", barTs: lastBarIso(bars) };
  }
  const e = enrich(bars);
  const last = e.bars.length - 1;
  const prev = last - 1;
  const sma50Curr = e.sma50[last];
  const sma50Prev = e.sma50[prev];
  const sma200Curr = e.sma200[last];
  const sma200Prev = e.sma200[prev];
  const price = bars[last]!.close;

  if (crossedUp(sma50Prev, sma50Curr, sma200Prev, sma200Curr)) {
    return { strategy: name, type: "BUY", price, reason: "SMA50 crossed above SMA200 (golden cross)", barTs: lastBarIso(bars) };
  }
  if (crossedDown(sma50Prev, sma50Curr, sma200Prev, sma200Curr)) {
    return { strategy: name, type: "SELL", price, reason: "SMA50 crossed below SMA200 (death cross)", barTs: lastBarIso(bars) };
  }
  return { strategy: name, type: "HOLD", price, reason: "No cross on the latest bar", barTs: lastBarIso(bars) };
}


// ---- Strategy 2: RSI reversion --------------------------------------------
export function rsiReversion(bars: Bar[], oversold = 30, overbought = 70): Signal {
  const name = "RSI reversion";
  if (bars.length < 15) {
    return { strategy: name, type: "HOLD", price: null, reason: "warming up", barTs: lastBarIso(bars) };
  }
  const e = enrich(bars);
  const last = e.bars.length - 1;
  const prev = last - 1;
  const rsiCurr = e.rsi14[last];
  const rsiPrev = e.rsi14[prev];
  const price = bars[last]!.close;
  if (rsiCurr === null || rsiPrev === null) {
    return { strategy: name, type: "HOLD", price, reason: "RSI unavailable", barTs: lastBarIso(bars) };
  }
  if (rsiPrev < oversold && rsiCurr >= oversold) {
    return { strategy: name, type: "BUY", price, reason: `RSI crossed back above ${oversold} from oversold`, barTs: lastBarIso(bars) };
  }
  if (rsiPrev > overbought && rsiCurr <= overbought) {
    return { strategy: name, type: "SELL", price, reason: `RSI crossed back below ${overbought} from overbought`, barTs: lastBarIso(bars) };
  }
  return { strategy: name, type: "HOLD", price, reason: `RSI at ${rsiCurr.toFixed(1)} — no reversion signal`, barTs: lastBarIso(bars) };
}


// ---- Strategy 3: MACD line / signal cross ---------------------------------
export function macdCross(bars: Bar[]): Signal {
  const name = "MACD cross";
  if (bars.length < 40) {
    return { strategy: name, type: "HOLD", price: null, reason: "warming up", barTs: lastBarIso(bars) };
  }
  const e = enrich(bars);
  const last = e.bars.length - 1;
  const prev = last - 1;
  const mCurr = e.macd.macd[last];
  const mPrev = e.macd.macd[prev];
  const sCurr = e.macd.signal[last];
  const sPrev = e.macd.signal[prev];
  const price = bars[last]!.close;
  if (crossedUp(mPrev, mCurr, sPrev, sCurr)) {
    return { strategy: name, type: "BUY", price, reason: "MACD crossed above its signal line", barTs: lastBarIso(bars) };
  }
  if (crossedDown(mPrev, mCurr, sPrev, sCurr)) {
    return { strategy: name, type: "SELL", price, reason: "MACD crossed below its signal line", barTs: lastBarIso(bars) };
  }
  return { strategy: name, type: "HOLD", price, reason: "No MACD cross on the latest bar", barTs: lastBarIso(bars) };
}


// ---- Registry --------------------------------------------------------------
export const STRATEGIES = {
  sma_crossover: smaCrossover,
  rsi_reversion: rsiReversion,
  macd_cross: macdCross,
} as const;

export type StrategyKey = keyof typeof STRATEGIES;

export function humanName(key: StrategyKey): string {
  return { sma_crossover: "SMA 50/200 crossover", rsi_reversion: "RSI reversion", macd_cross: "MACD cross" }[key];
}
