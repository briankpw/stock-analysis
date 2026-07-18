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
 * Bounded-parallelism variant of `Promise.all(items.map(fn))`.
 *
 * `Promise.all(items.map(fn))` fans every request out **simultaneously**.
 * That works for a handful of items but explodes for hundreds — e.g. the
 * segments routes that need one quote per company can enqueue 100+
 * concurrent Yahoo Finance calls, which reliably trips Yahoo's rate
 * limiter (429 storm), starves other in-flight background work, and can
 * crash the Node process by exceeding its default socket pool.
 *
 * `mapConcurrent` keeps at most `concurrency` promises in flight at any
 * time. Results are returned in the **same order** as `items`. If the
 * mapper throws for one element, the whole call rejects with that error
 * (matching `Promise.all`'s fail-fast behaviour); if you need per-item
 * error containment, catch inside `fn` and return a sentinel/`null`.
 *
 * Concurrency defaults to 6, which matches Chromium's per-origin socket
 * limit and empirically avoids Yahoo throttling for the ~100-symbol
 * segment fan-outs the app makes on `/api/segments/...`.
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 6,
): Promise<R[]> {
  const size = items.length;
  if (size === 0) return [];
  const cap = Math.max(1, Math.min(concurrency, size));
  const results = new Array<R>(size);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const idx = cursor++;
      if (idx >= size) return;
      results[idx] = await fn(items[idx], idx);
    }
  };
  const workers: Promise<void>[] = [];
  for (let i = 0; i < cap; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
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
