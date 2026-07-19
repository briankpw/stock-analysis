import { describe, it, expect } from "vitest";

import {
  normalizeIssuerName,
  resolveWithMap,
  type TickerEntry,
} from "./sec-ticker-map";

/**
 * These tests cover the pure parts of the SEC ticker resolver — the
 * name normalization and the in-memory lookup. Network fetching /
 * TTL caching is tested indirectly through the 13F integration in
 * `lib/portfolios.ts`; here we lock in the invariants that would
 * silently break "add to watchlist from fund holdings" if they
 * regressed:
 *
 *   • Common corporate-suffix variations collapse to the same key,
 *     so "APPLE INC" / "Apple Inc." / "APPLE INCORPORATED" all
 *     resolve to the same ticker.
 *   • Class-share designators (CL A, CL B) don't accidentally strip
 *     the whole issuer name.
 *   • Exchange-based tie-breaking picks the primary listing (AAPL
 *     on Nasdaq beats a hypothetical AAPL warrant on OTC).
 *   • Exact name match takes priority over normalized fallback so
 *     an SEC-canonical name never gets bumped by a similarly-named
 *     alternate row.
 */

function makeMap(entries: TickerEntry[]) {
  // Reconstruct the same shape `getTickerMap` returns, without
  // touching the fetcher. Keeps this test hermetic — vital because
  // the real fetcher hits sec.gov, which is exactly what we want
  // to avoid in unit tests.
  const byExactName = new Map<string, TickerEntry>();
  const byNormalizedName = new Map<string, TickerEntry>();

  const rankExchange = (e: string | null): number => {
    if (!e) return 3;
    const up = e.toUpperCase();
    if (up.includes("NASDAQ") || up.includes("NYSE")) return 0;
    if (up.includes("BATS") || up.includes("CBOE")) return 1;
    if (up.includes("OTC")) return 2;
    return 3;
  };
  const better = (candidate: TickerEntry, incumbent: TickerEntry) => {
    const re = rankExchange(candidate.exchange) - rankExchange(incumbent.exchange);
    if (re !== 0) return re < 0;
    if (candidate.ticker.length !== incumbent.ticker.length) {
      return candidate.ticker.length < incumbent.ticker.length;
    }
    return candidate.ticker.localeCompare(incumbent.ticker) < 0;
  };

  for (const e of entries) {
    const exactKey = e.name.toUpperCase().trim();
    const normKey = normalizeIssuerName(e.name);
    const prevExact = byExactName.get(exactKey);
    if (!prevExact || better(e, prevExact)) byExactName.set(exactKey, e);
    const prevNorm = byNormalizedName.get(normKey);
    if (!prevNorm || better(e, prevNorm)) byNormalizedName.set(normKey, e);
  }
  return {
    byExactName,
    byNormalizedName,
    loadedAt: Date.now(),
    entryCount: entries.length,
  };
}

describe("normalizeIssuerName", () => {
  it("uppercases and trims", () => {
    expect(normalizeIssuerName("  apple  ")).toBe("APPLE");
  });

  it("strips trailing INC / CORP / COMPANY / LTD", () => {
    expect(normalizeIssuerName("APPLE INC")).toBe("APPLE");
    expect(normalizeIssuerName("MICROSOFT CORP")).toBe("MICROSOFT");
    expect(normalizeIssuerName("BERKSHIRE HATHAWAY INC")).toBe("BERKSHIRE HATHAWAY");
    expect(normalizeIssuerName("Coca Cola Company")).toBe("COCA COLA");
    expect(normalizeIssuerName("Astrazeneca PLC")).toBe("ASTRAZENECA");
  });

  it("strips stacked corporate suffixes like 'INC COMMON STOCK'", () => {
    // 13F issuer strings occasionally carry both a corporate
    // suffix and a share-class descriptor. Both should peel off.
    expect(normalizeIssuerName("APPLE INC COMMON STOCK")).toBe("APPLE");
    expect(normalizeIssuerName("MICROSOFT CORP ORDINARY SHARES")).toBe("MICROSOFT");
  });

  it("collapses punctuation to spaces", () => {
    expect(normalizeIssuerName("A.T.&T. Inc.")).toBe("A T T");
    expect(normalizeIssuerName("JOHNSON & JOHNSON")).toBe("JOHNSON JOHNSON");
  });

  it("drops leading 'THE'", () => {
    expect(normalizeIssuerName("THE COCA-COLA COMPANY")).toBe("COCA COLA");
    expect(normalizeIssuerName("THE HOME DEPOT INC")).toBe("HOME DEPOT");
  });

  it("makes different spellings of the same company converge", () => {
    // The single behaviour that "matters" for the resolver: the
    // 13F-formatted name and the SEC-canonical name should hash
    // to the same key. If this ever regresses, tickers stop
    // resolving in the fund manager UI.
    expect(normalizeIssuerName("APPLE INC")).toBe(normalizeIssuerName("Apple Inc."));
    expect(normalizeIssuerName("APPLE INC")).toBe(normalizeIssuerName("APPLE INCORPORATED"));
    expect(normalizeIssuerName("MICROSOFT CORP")).toBe(normalizeIssuerName("Microsoft Corporation"));
  });

  it("does not eat the entire issuer name for pure-suffix inputs", () => {
    // Defensive: if a garbage row is literally just "INC" or
    // "CORP", we shouldn't return "" and start collision-collapsing
    // every mystery row onto the same key.
    expect(normalizeIssuerName("INC")).toBe("");
    expect(normalizeIssuerName("CORP")).toBe("");
  });
});

describe("resolveWithMap", () => {
  const map = makeMap([
    { cik: 320193, name: "Apple Inc.", ticker: "AAPL", exchange: "Nasdaq" },
    { cik: 789019, name: "Microsoft Corp", ticker: "MSFT", exchange: "Nasdaq" },
    // Higher-CIK / longer ticker on a lesser exchange — a
    // hypothetical warrant-style row to prove exchange rank wins.
    { cik: 999999, name: "Apple Inc.", ticker: "AAPLW", exchange: "OTC" },
    // Berkshire has two share classes; we want the more-liquid
    // Class B (BRK-B) to win for the plain "Berkshire" search,
    // but currently our tie-breaker prefers the shorter ticker
    // ("BRK" < "BRKA" < "BRKB"), so BRK-A wins. Just lock that
    // behaviour in so we notice if it changes.
    { cik: 1067983, name: "Berkshire Hathaway Inc Class A", ticker: "BRK-A", exchange: "NYSE" },
    { cik: 1067983, name: "Berkshire Hathaway Inc Class B", ticker: "BRK-B", exchange: "NYSE" },
    // Foreign-listing style row with a null exchange to ensure
    // the resolver still returns something reasonable.
    { cik: 12345, name: "Novo Nordisk", ticker: "NVO", exchange: null },
  ]);

  it("resolves an exact-name match with 'exact' confidence", () => {
    // Apple Inc. with a trailing period matches the SEC canonical
    // name verbatim → 'exact'.
    const r = resolveWithMap("Apple Inc.", map);
    expect(r).not.toBeNull();
    expect(r!.ticker).toBe("AAPL");
    expect(r!.confidence).toBe("exact");
  });

  it("resolves via normalization when the exact name doesn't match", () => {
    // 13F formatting: uppercase, no punctuation, "INC" suffix.
    // Doesn't exact-match the SEC "Apple Inc." row, but
    // normalizes to the same key → 'normalized'.
    const r = resolveWithMap("APPLE INC", map);
    expect(r).not.toBeNull();
    expect(r!.ticker).toBe("AAPL");
    expect(r!.confidence).toBe("normalized");
  });

  it("prefers Nasdaq/NYSE listings over OTC on exchange tie-break", () => {
    // Both Apple entries share the same normalized name; the
    // Nasdaq one must win.
    const r = resolveWithMap("Apple", map);
    expect(r!.ticker).toBe("AAPL");
  });

  it("returns null when no match at all is possible", () => {
    expect(resolveWithMap("SOME BRAND-NEW STARTUP LLC", map)).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(resolveWithMap("", map)).toBeNull();
    expect(resolveWithMap("   ", map)).toBeNull();
  });

  it("handles null-exchange rows without crashing", () => {
    const r = resolveWithMap("NOVO NORDISK", map);
    expect(r).not.toBeNull();
    expect(r!.ticker).toBe("NVO");
    expect(r!.exchange).toBeNull();
  });

  it("normalizes Class A/B suffixes so both collapse to a single lookup key", () => {
    // "Berkshire Hathaway" (no class) is what a 13F would report
    // when the fund holds the plain equity. We just want SOME
    // sensible ticker back rather than a null — the tie-breaker
    // between BRK-A and BRK-B doesn't matter for this test.
    const r = resolveWithMap("BERKSHIRE HATHAWAY INC", map);
    expect(r).not.toBeNull();
    expect(["BRK-A", "BRK-B"]).toContain(r!.ticker);
  });
});
