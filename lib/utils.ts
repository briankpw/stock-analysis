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

/**
 * Minimal HTML entity escaper for the five characters that can inject markup
 * or break attributes. Used ahead of any `dangerouslySetInnerHTML` sink so
 * user-supplied text (ticker names, insight strings) can't smuggle tags in.
 *
 * Never rely on this for URL/JS/CSS contexts — those need different escapes.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render our tiny `**bold**` markdown flavour into safe HTML. Input is
 * fully escaped first, then only the bold markers are turned into
 * `<strong>` tags. This is the correct order — escaping AFTER the tag
 * substitution would neuter the `<strong>` we just inserted.
 */
export function renderMiniMarkdown(text: string): string {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

/**
 * Lightweight bounded TTL cache. Entries expire lazily on read. When the
 * map exceeds `maxSize`, the oldest inserted entry is evicted (approximate
 * LRU — write-order rather than access-order, which matches the usage
 * pattern here: reads dominate and writes rotate through a small keyspace).
 */
export interface TtlCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T, ttlMs?: number): void;
  delete(key: string): boolean;
  clear(): void;
  keys(): string[];
}

export function createTtlCache<T>(opts: {
  defaultTtlMs: number;
  maxSize?: number;
}): TtlCache<T> {
  const { defaultTtlMs, maxSize = 500 } = opts;
  const store = new Map<string, { value: T; expiresAt: number }>();

  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value, ttlMs) {
      store.set(key, {
        value,
        expiresAt: Date.now() + (ttlMs ?? defaultTtlMs),
      });
      if (store.size > maxSize) {
        // Map preserves insertion order — the first key is the oldest.
        const oldest = store.keys().next().value;
        if (oldest !== undefined) store.delete(oldest);
      }
    },
    delete(key) {
      return store.delete(key);
    },
    clear() {
      store.clear();
    },
    keys() {
      return Array.from(store.keys());
    },
  };
}

/**
 * Race `promise` against a hard deadline. On timeout the returned promise
 * rejects with `Error("timeout after Nms: label")` and the underlying work
 * keeps running (there's no generic cancellation for arbitrary promises);
 * pair with `AbortSignal.timeout()` at the `fetch` layer where possible.
 */
export function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label = "operation",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timeout after ${timeoutMs}ms: ${label}`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
