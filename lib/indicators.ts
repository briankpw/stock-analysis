/**
 * Technical indicators — pure-TypeScript port of the pandas-based
 * `src/indicators.py`. All functions accept an array of numeric closes (or
 * OHLCV bars) and return an array of the same length where the leading
 * warm-up values are `null` (mirroring pandas' `NaN` in a language that
 * doesn't have a first-class NaN convention).
 *
 * Design notes
 * ------------
 * * All indicators are computed in a single left-to-right pass where the
 *   math allows (SMA uses a rolling-sum trick, EMA uses the recursive form).
 * * Output length always equals input length — so the arrays can be
 *   z-aligned with the OHLCV bars for charting without index gymnastics.
 * * `null` (not `NaN` / `undefined`) is used to mean "no value yet": it
 *   survives JSON serialisation, doesn't sort weirdly, and lightweight-charts
 *   accepts it via a whitespaceData marker.
 */

export interface Bar {
  time: number; // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type NullableSeries = (number | null)[];

/**
 * Simple Moving Average. Warm-up: first `window - 1` values are null.
 */
export function sma(values: number[], window: number): NullableSeries {
  if (window <= 0) throw new Error("window must be > 0");
  const out: NullableSeries = new Array(values.length).fill(null);
  if (values.length < window) return out;

  let sum = 0;
  for (let i = 0; i < window; i++) sum += values[i]!;
  out[window - 1] = sum / window;

  for (let i = window; i < values.length; i++) {
    sum += values[i]! - values[i - window]!;
    out[i] = sum / window;
  }
  return out;
}

/**
 * Exponential Moving Average using the standard recursive form:
 *   EMA_t = alpha * value_t + (1 - alpha) * EMA_{t-1}
 * with `alpha = 2 / (period + 1)`. Seeded with the SMA of the first `period`
 * values (same convention as pandas `ewm(min_periods=period).mean()`).
 */
export function ema(values: number[], period: number): NullableSeries {
  if (period <= 0) throw new Error("period must be > 0");
  const out: NullableSeries = new Array(values.length).fill(null);
  if (values.length < period) return out;

  const alpha = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i]!;
  seed /= period;
  out[period - 1] = seed;

  for (let i = period; i < values.length; i++) {
    const prev = out[i - 1]!;
    out[i] = alpha * values[i]! + (1 - alpha) * prev;
  }
  return out;
}

/**
 * Relative Strength Index using Wilder's smoothing (the same convention as
 * pandas' typical RSI implementation).
 */
export function rsi(values: number[], period = 14): NullableSeries {
  const out: NullableSeries = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i]! - values[i - 1]!;
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i]! - values[i - 1]!;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface MacdResult {
  macd: NullableSeries;
  signal: NullableSeries;
  histogram: NullableSeries;
}

export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): MacdResult {
  const fastLine = ema(values, fast);
  const slowLine = ema(values, slow);
  const macdLine: NullableSeries = values.map((_, i) => {
    const f = fastLine[i];
    const s = slowLine[i];
    return f !== null && s !== null ? f - s : null;
  });

  // Signal line is an EMA of the MACD line, but we have to skip the null
  // prefix or the EMA seed becomes NaN.
  const firstIdx = macdLine.findIndex((v) => v !== null);
  const signalLine: NullableSeries = new Array(values.length).fill(null);
  if (firstIdx >= 0) {
    const trimmed = macdLine.slice(firstIdx).map((v) => v ?? 0);
    const sig = ema(trimmed, signal);
    for (let i = 0; i < sig.length; i++) {
      signalLine[firstIdx + i] = sig[i];
    }
  }
  const histogram: NullableSeries = values.map((_, i) => {
    const m = macdLine[i];
    const s = signalLine[i];
    return m !== null && s !== null ? m - s : null;
  });
  return { macd: macdLine, signal: signalLine, histogram };
}

export interface BollingerBands {
  middle: NullableSeries;
  upper: NullableSeries;
  lower: NullableSeries;
}

export function bollinger(
  values: number[],
  window = 20,
  numStd = 2,
): BollingerBands {
  const middle = sma(values, window);
  const upper: NullableSeries = new Array(values.length).fill(null);
  const lower: NullableSeries = new Array(values.length).fill(null);
  if (values.length < window) return { middle, upper, lower };

  // Rolling variance via Welford-style running sums of squares.
  for (let i = window - 1; i < values.length; i++) {
    let sum = 0;
    let sumSq = 0;
    for (let j = i - window + 1; j <= i; j++) {
      sum += values[j]!;
      sumSq += values[j]! * values[j]!;
    }
    const mean = sum / window;
    const variance = Math.max(0, sumSq / window - mean * mean);
    const std = Math.sqrt(variance);
    upper[i] = mean + numStd * std;
    lower[i] = mean - numStd * std;
  }
  return { middle, upper, lower };
}

/** Average True Range — Wilder-smoothed. */
export function atr(bars: Bar[], period = 14): NullableSeries {
  const out: NullableSeries = new Array(bars.length).fill(null);
  if (bars.length <= period) return out;

  const trs: number[] = new Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i]!;
    const prev = bars[i - 1]!;
    trs[i] = Math.max(
      b.high - b.low,
      Math.abs(b.high - prev.close),
      Math.abs(b.low - prev.close),
    );
  }

  let sum = 0;
  for (let i = 1; i <= period; i++) sum += trs[i]!;
  let atrPrev = sum / period;
  out[period] = atrPrev;

  for (let i = period + 1; i < bars.length; i++) {
    atrPrev = (atrPrev * (period - 1) + trs[i]!) / period;
    out[i] = atrPrev;
  }
  return out;
}

/** Daily percentage returns (leading `null` because the first bar has none). */
export function returns(values: number[]): NullableSeries {
  const out: NullableSeries = new Array(values.length).fill(null);
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]!;
    out[i] = prev === 0 ? null : (values[i]! - prev) / prev;
  }
  return out;
}

/** Annualised volatility — std-dev of daily returns * sqrt(252). */
export function annualisedVolatility(values: number[]): number | null {
  const rets = returns(values).filter((v): v is number => v !== null);
  if (rets.length < 2) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance =
    rets.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

// ---------------------------------------------------------------------------
// Enriched bundle: takes raw bars and returns bars + all the indicator arrays
// pre-computed. Callers get everything they need for charts + signals in one
// pass, matching the Python `add_indicator_columns` helper.
// ---------------------------------------------------------------------------
export interface Enriched {
  bars: Bar[];
  closes: number[];
  sma20: NullableSeries;
  sma50: NullableSeries;
  sma200: NullableSeries;
  ema20: NullableSeries;
  rsi14: NullableSeries;
  macd: MacdResult;
  bb20: BollingerBands;
  atr14: NullableSeries;
  returns: NullableSeries;
}

export function enrich(bars: Bar[]): Enriched {
  const closes = bars.map((b) => b.close);
  return {
    bars,
    closes,
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    sma200: sma(closes, 200),
    ema20: ema(closes, 20),
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    bb20: bollinger(closes, 20, 2),
    atr14: atr(bars, 14),
    returns: returns(closes),
  };
}

// ---------------------------------------------------------------------------
// Latest-value signals (Overview page cards). Same string outputs as the
// Python `latest_signals(enriched)` so the UI code doesn't have to branch.
// ---------------------------------------------------------------------------
export interface LatestSignals {
  trend: string;             // 'Bullish uptrend' / 'Bearish downtrend' / 'Sideways'
  rsi: string;               // 'Overbought (78.2)' / 'Oversold (22.1)' / 'Neutral (54.0)'
  macd: string;              // 'Bullish' / 'Bearish' / 'Flat'
  bollinger: string;         // 'Near upper band' / 'Near lower band' / '…'
  lastClose: number | null;
  lastChange: number | null;         // absolute
  lastChangePercent: number | null;  // fraction, e.g. 0.0132 = +1.32%
}

/** Pull the last non-null value from a nullable series, or null. */
function lastOf(series: NullableSeries): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] !== null) return series[i]!;
  }
  return null;
}

export function latestSignals(e: Enriched): LatestSignals {
  const n = e.closes.length;
  const lastClose = n > 0 ? e.closes[n - 1]! : null;
  const prevClose = n > 1 ? e.closes[n - 2]! : null;

  // ---- Trend: SMA50 vs SMA200, plus price relative to SMA50.
  let trend = "Sideways";
  const sma50 = lastOf(e.sma50);
  const sma200 = lastOf(e.sma200);
  if (lastClose !== null && sma50 !== null && sma200 !== null) {
    if (sma50 > sma200 && lastClose > sma50) trend = "Bullish uptrend";
    else if (sma50 < sma200 && lastClose < sma50) trend = "Bearish downtrend";
  }

  // ---- RSI
  const rsiVal = lastOf(e.rsi14);
  let rsiLabel = "n/a";
  if (rsiVal !== null) {
    if (rsiVal >= 70) rsiLabel = `Overbought (${rsiVal.toFixed(1)})`;
    else if (rsiVal <= 30) rsiLabel = `Oversold (${rsiVal.toFixed(1)})`;
    else rsiLabel = `Neutral (${rsiVal.toFixed(1)})`;
  }

  // ---- MACD (line vs signal cross)
  const macdLine = lastOf(e.macd.macd);
  const signalLine = lastOf(e.macd.signal);
  let macdLabel = "Flat";
  if (macdLine !== null && signalLine !== null) {
    if (macdLine > signalLine) macdLabel = "Bullish";
    else if (macdLine < signalLine) macdLabel = "Bearish";
  }

  // ---- Bollinger position
  const bbUpper = lastOf(e.bb20.upper);
  const bbLower = lastOf(e.bb20.lower);
  let bbLabel = "—";
  if (lastClose !== null && bbUpper !== null && bbLower !== null) {
    if (lastClose >= bbUpper) bbLabel = "Price above upper band";
    else if (lastClose <= bbLower) bbLabel = "Price below lower band";
    else bbLabel = "Inside bands";
  }

  const lastChange =
    lastClose !== null && prevClose !== null ? lastClose - prevClose : null;
  const lastChangePercent =
    lastClose !== null && prevClose !== null && prevClose !== 0
      ? (lastClose - prevClose) / prevClose
      : null;

  return {
    trend,
    rsi: rsiLabel,
    macd: macdLabel,
    bollinger: bbLabel,
    lastClose,
    lastChange,
    lastChangePercent,
  };
}
