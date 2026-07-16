import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tailwind-aware `classNames` helper: dedupes conflicting classes so the
 * *last* one wins, which matches Tailwind's `@apply` semantics.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Clamp a number to the given inclusive range.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Nullish-safe numeric coercion. Returns `null` if the value can't be parsed
 * as a finite number (empty string, NaN, ±Infinity, `null`, `undefined`).
 * Used pervasively for yfinance fields where any value can be missing.
 */
export function toNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * `map`-style helper for optional numbers: apply `fn` only if the input is
 * a finite number, otherwise return `null`.
 */
export function mapNum<T>(value: unknown, fn: (n: number) => T): T | null {
  const n = toNum(value);
  return n === null ? null : fn(n);
}
