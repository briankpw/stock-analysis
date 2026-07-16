/**
 * Formatting helpers for the dashboard — mirrors the semantics of
 * `src/ratios.py::_format_*` in the Python codebase so numbers look identical
 * across both apps.
 */

import { toNum } from "./utils";

/** Return a `—` placeholder when we can't sensibly format a value. */
export const DASH = "—";

export function fmtCompactNumber(value: unknown): string {
  const n = toNum(value);
  if (n === null) return DASH;
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}

export function fmtCurrency(value: unknown, decimals = 2, symbol = "$"): string {
  const n = toNum(value);
  if (n === null) return DASH;
  return `${symbol}${n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function fmtCompactCurrency(value: unknown, symbol = "$"): string {
  const n = toNum(value);
  if (n === null) return DASH;
  return `${symbol}${fmtCompactNumber(n)}`;
}

/** Multiplies by 100 by default (i.e. 0.15 → "15.00%"). */
export function fmtPercent(value: unknown, decimals = 2, asFraction = true): string {
  const n = toNum(value);
  if (n === null) return DASH;
  const scaled = asFraction ? n * 100 : n;
  return `${scaled.toFixed(decimals)}%`;
}

/** No multiplication — accepts an already-scaled percent like 15.4. */
export function fmtPercentRaw(value: unknown, decimals = 2): string {
  return fmtPercent(value, decimals, false);
}

export function fmtNumber(value: unknown, decimals = 2): string {
  const n = toNum(value);
  if (n === null) return DASH;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtInteger(value: unknown): string {
  const n = toNum(value);
  if (n === null) return DASH;
  return Math.trunc(n).toLocaleString("en-US");
}

export function fmtVolume(value: unknown): string {
  const n = toNum(value);
  if (n === null) return DASH;
  return fmtCompactNumber(n);
}

/** Compact relative-time formatter: '17m ago', '4h ago', '2d ago', or a date. */
export function relativeTime(from: Date | string | number, now = new Date()): string {
  const then = new Date(from);
  const deltaMs = Math.max(0, now.getTime() - then.getTime());
  const seconds = deltaMs / 1000;
  const minutes = seconds / 60;
  const hours = minutes / 60;
  const days = hours / 24;

  if (minutes < 1) return "just now";
  if (hours < 1) return `${Math.max(1, Math.floor(minutes))}m ago`;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  if (days < 30) return `${Math.floor(days)}d ago`;
  return then.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * "+3.42%" / "−1.05%" with a leading sign and configurable precision.
 * Used on Overview / market header where sign matters.
 */
export function fmtSignedPercent(value: unknown, decimals = 2, asFraction = true): string {
  const n = toNum(value);
  if (n === null) return DASH;
  const scaled = asFraction ? n * 100 : n;
  const sign = scaled >= 0 ? "+" : "";
  return `${sign}${scaled.toFixed(decimals)}%`;
}

export function fmtSigned(value: unknown, decimals = 2): string {
  const n = toNum(value);
  if (n === null) return DASH;
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}
