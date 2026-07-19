/**
 * SEC issuer-name → ticker resolver.
 *
 * Why this exists: SEC 13F filings (fund manager holdings) identify
 * positions by CUSIP + issuer name only — the schema literally has
 * no `ticker` field. CUSIPs are copyright-protected by CUSIP Global
 * Services, so SEC deliberately does NOT publish a CUSIP → ticker
 * table. Left to their own devices, users see a long list of names
 * like "APPLE INC" with a placeholder "Look up" link and have to
 * hand-type each ticker into the watchlist popover — which is what
 * prompted the "cannot add to the wishlist" report.
 *
 * We can't get CUSIPs from SEC, but we CAN get an official name +
 * ticker + CIK + exchange list from
 * `https://www.sec.gov/files/company_tickers_exchange.json` — a
 * public, unauthenticated file that SEC updates roughly weekly and
 * covers every US-listed operating company. For a 13F filing, most
 * holdings are exactly these companies (S&P 500 + mid caps, mostly),
 * so a **normalized-name match** resolves the vast majority of rows
 * with zero ambiguity.
 *
 * Design constraints:
 *
 *   • **Never per-holding network calls.** A 13F can carry 500+
 *     positions; issuing 500 SEC lookups on every fund report view
 *     would blow the 10 req/sec limit and take minutes. Instead we
 *     fetch ONE ~5 MB JSON file up front, build an in-memory Map
 *     once, and resolve every holding in-memory at O(1) per lookup.
 *
 *   • **Aggressive TTL.** SEC updates the file infrequently and
 *     ticker↔company mappings are effectively immutable within a
 *     day. Cache for 24 hours. On refresh failure we intentionally
 *     KEEP the stale map so a transient SEC outage doesn't strip
 *     the tickers from every fund report.
 *
 *   • **Conservative matching.** We only return a ticker on a
 *     confident normalized-name match. When the SEC's canonical
 *     name differs materially from the 13F-reported name (e.g.
 *     rebrands, spinoffs, subsidiaries reporting under the parent),
 *     we return `null` and let the UI fall back to the manual-
 *     input popover. Better to say "I don't know" than confidently
 *     link a user to the wrong ticker.
 *
 *   • **Single source of truth for the normalizer.** Exported so
 *     future callers (search endpoint, watchlist reconciler, etc.)
 *     can normalize identically.
 */

import { secTimedFetch } from "./sec-limiter";
import { settings } from "./config";

/** Source URL. SEC publishes this file publicly with no auth. */
const SEC_TICKERS_URL =
  "https://www.sec.gov/files/company_tickers_exchange.json";

/**
 * How long a successfully-fetched map stays fresh. SEC's file only
 * changes on new listings / delistings / renames — 24h is plenty
 * of granularity for our purposes.
 */
const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How long we wait between refresh attempts after a SEC fetch
 * failure. Keeps us from hammering a flaky endpoint on every
 * request while a real outage is in progress.
 */
const RETRY_MS = 5 * 60 * 1000;

/**
 * Individual row in SEC's file (post-normalization to our shape).
 * The raw payload uses parallel arrays under a `fields` / `data`
 * structure — see `parseSecPayload` for the shape adaptor.
 */
export interface TickerEntry {
  ticker: string;
  cik: number;
  name: string;
  /** Two-letter exchange code (e.g. "NASDAQ", "NYSE", "OTC"). May
   *  be missing on some rows. */
  exchange: string | null;
}

/**
 * The resolved lookup for a single issuer. Kept minimal so it's
 * cheap to serialize into API responses.
 */
export interface TickerResolution {
  ticker: string;
  exchange: string | null;
  /** Whether the match was exact-name (`exact`) or after
   *  normalization / suffix stripping (`normalized`). Currently
   *  informational only; the UI could use it to grey-out lower-
   *  confidence hits, but for now we surface both the same way. */
  confidence: "exact" | "normalized";
}

// ---------------------------------------------------------------------------
// Name normalization
// ---------------------------------------------------------------------------

/**
 * Common corporate suffixes that appear on issuer names but don't
 * meaningfully distinguish companies. Stripped during normalization
 * so "APPLE INC" and "APPLE" collapse to the same key.
 *
 * Order matters: longer / more-specific first, so "COMMON STOCK"
 * doesn't get partially eaten by "COMMON" if we ever add that.
 */
const CORP_SUFFIXES = [
  "COMMON STOCK",
  "CLASS A COMMON STOCK",
  "CLASS B COMMON STOCK",
  "CLASS C COMMON STOCK",
  "ORDINARY SHARES",
  "AMERICAN DEPOSITARY SHARES",
  "ADR",
  "ADS",
  "REIT",
  "INC OF DE",
  "INCORPORATED",
  "CORPORATION",
  "COMPANY",
  "HOLDINGS",
  "HOLDING",
  "GROUP",
  "TRUST",
  "PARTNERS",
  "PARTNER",
  "LIMITED",
  "INC",
  "CORP",
  "CO",
  "LTD",
  "PLC",
  "LLC",
  "LP",
  "NV",
  "SA",
  "SE",
  "AG",
  "AB",
  "OYJ",
  "ASA",
  "SPA",
  "SPZOO",
  "CL A",
  "CL B",
  "CL C",
  "CLASS A",
  "CLASS B",
  "CLASS C",
];

/**
 * Normalize an issuer name for lookup. The goal is that
 * `norm("APPLE INC")` === `norm("Apple Inc.")` ===
 * `norm("APPLE INCORPORATED")` === `norm("APPLE INC (THE)")` so a
 * fuzzy match becomes an exact map lookup.
 *
 * Steps:
 *   1. Uppercase, trim.
 *   2. Strip punctuation to spaces (comma, period, ampersand,
 *      parens, slash, dash, apostrophe).
 *   3. Drop the leading article "THE".
 *   4. Iteratively strip trailing corporate suffixes (a company
 *      can carry two: "APPLE INC COMMON STOCK" → drop COMMON
 *      STOCK, then drop INC).
 *   5. Collapse repeated whitespace.
 */
export function normalizeIssuerName(name: string): string {
  let s = name.toUpperCase().trim();
  // Punctuation → space. Keep letters, digits, and whitespace.
  // `/` is escaped defensively to avoid any parser ambiguity with
  // the regex literal delimiter — modern engines don't need it but
  // future-proofing this regex costs nothing.
  s = s.replace(/[.,&()\-'\/\\]/g, " ");
  // Drop leading article.
  s = s.replace(/^THE\s+/, "");
  // Also drop trailing " (THE)" or " THE" that some SEC rows carry.
  s = s.replace(/\s+THE$/, "");
  // Collapse whitespace so the suffix regex below sees single spaces.
  s = s.replace(/\s+/g, " ").trim();

  // Iteratively strip trailing corporate suffixes. Loop bounded by
  // suffix count so we can't get stuck if a bad regex is ever added.
  let changed = true;
  let guard = 0;
  while (changed && guard < CORP_SUFFIXES.length) {
    changed = false;
    for (const suffix of CORP_SUFFIXES) {
      if (s.endsWith(" " + suffix) || s === suffix) {
        s = s.slice(0, s.length - suffix.length).trim();
        changed = true;
        break;
      }
    }
    guard += 1;
  }
  return s.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// In-memory cache & fetcher
// ---------------------------------------------------------------------------

interface CachedMap {
  /** normalized-name → entry. First-write wins on collisions (see
   *  `buildMap` for the collision policy). */
  byNormalizedName: Map<string, TickerEntry>;
  /** Raw uppercased-name → entry, for exact-match preference before
   *  falling back to the normalized-name map. */
  byExactName: Map<string, TickerEntry>;
  /** When this cache was populated. */
  loadedAt: number;
  /** Total entries loaded — surfaced in logs for sanity-checking. */
  entryCount: number;
}

let _cached: CachedMap | null = null;
let _lastFailAt = 0;
let _inflight: Promise<CachedMap | null> | null = null;

/**
 * Force-refresh the map. Public for tests / diagnostics; regular
 * callers should use `getTickerMap()` which handles TTL + retry
 * budget for them.
 */
async function refreshMap(): Promise<CachedMap | null> {
  try {
    const res = await secTimedFetch(SEC_TICKERS_URL, {
      // A fresh copy is fine — the server sets its own cache
      // headers. `no-store` here just means "don't let the fetch
      // API cache the response body in-process independently".
      cache: "no-store",
      headers: {
        "User-Agent": settings.portfolios.secUserAgent,
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      timeoutMs: 30_000,
    });
    if (!res.ok) throw new Error(`SEC tickers HTTP ${res.status}`);
    const raw = (await res.json()) as unknown;
    const entries = parseSecPayload(raw);
    if (entries.length === 0) {
      throw new Error("SEC tickers payload parsed to zero entries");
    }
    const map = buildMap(entries);
    _cached = map;
    _lastFailAt = 0;
    return map;
  } catch (err) {
    _lastFailAt = Date.now();
    console.warn(
      "[sec-ticker-map] refresh failed — keeping stale map if present:",
      err instanceof Error ? err.message : err,
    );
    // Return the stale map if we have one; the caller can still
    // resolve tickers while we wait out the retry budget.
    return _cached;
  }
}

/**
 * Get the current ticker map, refreshing on first call and after
 * the TTL expires. Concurrent callers share a single in-flight
 * fetch. Never throws — returns `null` only when the very first
 * fetch fails and we have no fallback map at all.
 */
export async function getTickerMap(): Promise<CachedMap | null> {
  const now = Date.now();
  const fresh = _cached && now - _cached.loadedAt < TTL_MS;
  if (fresh) return _cached;

  // Back off on recent failures unless the map is totally missing —
  // if we've NEVER loaded a map we always try, because there's no
  // fallback to fall back to.
  const backedOff = now - _lastFailAt < RETRY_MS;
  if (backedOff && _cached) return _cached;

  if (_inflight) return _inflight;
  _inflight = refreshMap().finally(() => {
    _inflight = null;
  });
  return _inflight;
}

/**
 * Parse SEC's `company_tickers_exchange.json` shape:
 *
 *   { fields: ["cik", "name", "ticker", "exchange"],
 *     data:   [[320193, "Apple Inc.", "AAPL", "Nasdaq"], ...] }
 *
 * Robust to a few reasonable variants (extra columns, missing
 * exchange, `company_tickers.json`'s object-keyed format) so a
 * schema tweak on SEC's end degrades to "fewer tickers resolved"
 * rather than a crash.
 */
function parseSecPayload(raw: unknown): TickerEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;

  // Preferred shape: { fields: string[], data: unknown[][] }
  if (Array.isArray(obj.data) && Array.isArray(obj.fields)) {
    const fields = obj.fields as string[];
    const idxCik = fields.indexOf("cik");
    const idxName = fields.indexOf("name");
    const idxTicker = fields.indexOf("ticker");
    const idxExch = fields.indexOf("exchange");
    if (idxCik < 0 || idxName < 0 || idxTicker < 0) return [];
    const out: TickerEntry[] = [];
    for (const row of obj.data as unknown[][]) {
      const cikRaw = row[idxCik];
      const nameRaw = row[idxName];
      const tickerRaw = row[idxTicker];
      const exchRaw = idxExch >= 0 ? row[idxExch] : null;
      if (typeof cikRaw !== "number" && typeof cikRaw !== "string") continue;
      if (typeof nameRaw !== "string") continue;
      if (typeof tickerRaw !== "string" || tickerRaw.trim() === "") continue;
      out.push({
        cik: typeof cikRaw === "number" ? cikRaw : Number.parseInt(cikRaw, 10),
        name: nameRaw,
        ticker: tickerRaw.trim().toUpperCase(),
        exchange:
          typeof exchRaw === "string" && exchRaw.trim() !== ""
            ? exchRaw.trim()
            : null,
      });
    }
    return out;
  }

  // Fallback shape: `company_tickers.json` (no exchange column)
  // uses object keys like `"0": {cik_str, ticker, title}`.
  const out: TickerEntry[] = [];
  for (const v of Object.values(obj)) {
    if (!v || typeof v !== "object") continue;
    const row = v as Record<string, unknown>;
    const cikRaw = row.cik_str ?? row.cik;
    const name = row.title ?? row.name;
    const ticker = row.ticker;
    if (
      (typeof cikRaw !== "number" && typeof cikRaw !== "string") ||
      typeof name !== "string" ||
      typeof ticker !== "string"
    ) {
      continue;
    }
    out.push({
      cik: typeof cikRaw === "number" ? cikRaw : Number.parseInt(cikRaw, 10),
      name,
      ticker: ticker.trim().toUpperCase(),
      exchange: null,
    });
  }
  return out;
}

/**
 * Turn a flat entry list into fast lookup maps. Collisions on
 * either name key are resolved by preferring the entry whose
 * ticker looks like a common-share primary listing (shortest
 * ticker, prefer NYSE / Nasdaq over OTC). This avoids the
 * "APPLE INC" query returning some obscure warrant instead of AAPL.
 */
function buildMap(entries: TickerEntry[]): CachedMap {
  const byExact = new Map<string, TickerEntry>();
  const byNorm = new Map<string, TickerEntry>();
  const rankExchange = (e: string | null): number => {
    if (!e) return 3;
    const up = e.toUpperCase();
    if (up.includes("NASDAQ")) return 0;
    if (up.includes("NYSE")) return 0;
    if (up.includes("BATS") || up.includes("CBOE")) return 1;
    if (up.includes("OTC")) return 2;
    return 3;
  };
  const better = (candidate: TickerEntry, incumbent: TickerEntry): boolean => {
    const re = rankExchange(candidate.exchange) - rankExchange(incumbent.exchange);
    if (re !== 0) return re < 0;
    // Prefer shorter tickers (primary listings), then alphabetical
    // so the choice is stable across refreshes.
    if (candidate.ticker.length !== incumbent.ticker.length) {
      return candidate.ticker.length < incumbent.ticker.length;
    }
    return candidate.ticker.localeCompare(incumbent.ticker) < 0;
  };

  for (const e of entries) {
    const exactKey = e.name.toUpperCase().trim();
    const normKey = normalizeIssuerName(e.name);
    const prevExact = byExact.get(exactKey);
    if (!prevExact || better(e, prevExact)) byExact.set(exactKey, e);
    const prevNorm = byNorm.get(normKey);
    if (!prevNorm || better(e, prevNorm)) byNorm.set(normKey, e);
  }

  return {
    byExactName: byExact,
    byNormalizedName: byNorm,
    loadedAt: Date.now(),
    entryCount: entries.length,
  };
}

// ---------------------------------------------------------------------------
// Public resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a single issuer name to a ticker + exchange, or `null`
 * if we can't find a confident match. Never throws.
 */
export async function resolveTickerForIssuer(
  issuerName: string,
): Promise<TickerResolution | null> {
  if (!issuerName || issuerName.trim() === "") return null;
  const map = await getTickerMap();
  if (!map) return null;
  return resolveWithMap(issuerName, map);
}

/**
 * Batch variant — resolve many issuers against a single map load.
 * Used by 13F enrichment where we already know we're iterating
 * over a whole holdings list. Returns `null` per input on no match
 * (parallel array, same length as input).
 */
export async function resolveTickersForIssuers(
  issuerNames: readonly string[],
): Promise<Array<TickerResolution | null>> {
  const map = await getTickerMap();
  if (!map) return issuerNames.map(() => null);
  return issuerNames.map((n) => resolveWithMap(n, map));
}

/**
 * Pure resolution against a pre-loaded map. Exported so tests can
 * drive the resolver with a synthetic map without touching the
 * network.
 */
export function resolveWithMap(
  issuerName: string,
  map: CachedMap,
): TickerResolution | null {
  const exactKey = issuerName.toUpperCase().trim();
  const exact = map.byExactName.get(exactKey);
  if (exact) {
    return {
      ticker: exact.ticker,
      exchange: exact.exchange,
      confidence: "exact",
    };
  }
  const normKey = normalizeIssuerName(issuerName);
  if (!normKey) return null;
  const norm = map.byNormalizedName.get(normKey);
  if (norm) {
    return {
      ticker: norm.ticker,
      exchange: norm.exchange,
      confidence: "normalized",
    };
  }
  return null;
}

/**
 * Debug snapshot — used by health / diagnostics endpoints. Returns
 * null if the map hasn't been loaded yet.
 */
export function getTickerMapStats(): { entryCount: number; loadedAt: number } | null {
  if (!_cached) return null;
  return {
    entryCount: _cached.entryCount,
    loadedAt: _cached.loadedAt,
  };
}
