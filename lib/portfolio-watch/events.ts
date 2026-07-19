/**
 * Convert each source's report (politicians PTR, insiders Form 4, funds
 * 13F) into a common `PortfolioEvent` shape so the watcher engine can
 * match watches uniformly across categories.
 *
 * The `id` field is deterministic across re-fetches — it must be, because
 * that's the primary key of the notifications table (our dedup surface).
 * Two identical trades from two different fetches MUST produce the same
 * `id`. Never include timestamps or fetch nonces in the `id`.
 */

import type {
  FundReport,
  InsiderTransaction,
  PersonReport,
  PoliticianReport,
  PoliticianTrade,
} from "@/lib/portfolios";

export type EventCategory = "people" | "politicians" | "funds";
export type EventAction = "BUY" | "SELL" | "OTHER";

export interface PortfolioEvent {
  /** Stable across re-fetches (see file header). */
  id: string;
  category: EventCategory;
  presetId: string;
  presetName: string;
  /** Uppercase, may be null if the row didn't carry a ticker (e.g. mutual fund). */
  ticker: string | null;
  companyName: string;
  action: EventAction;
  /** Human label like "Buy", "Sell (partial)", "New 13F position". */
  actionLabel: string;
  tradeDate: string | null;      // ISO
  filingDate: string | null;     // ISO
  amountLabel: string;
  sourceUrl: string;
}

// ---------------------------------------------------------------------------
// Politician events — one per parsed trade row
// ---------------------------------------------------------------------------

const POL_ACTION: Record<Exclude<PoliticianTrade["action"], null>, {
  action: EventAction; label: string;
}> = {
  P:         { action: "BUY",   label: "Buy"            },
  S:         { action: "SELL",  label: "Sell"           },
  S_PARTIAL: { action: "SELL",  label: "Sell (partial)" },
  E:         { action: "OTHER", label: "Exchange"       },
};

export function politicianEvents(report: PoliticianReport): PortfolioEvent[] {
  const out: PortfolioEvent[] = [];
  for (const t of report.parsedTrades) {
    if (!t.action) continue;
    const meta = POL_ACTION[t.action];
    // Only emit BUY / SELL — user picked "buys and sells" and the OTHER
    // codes (Exchange) are usually intra-portfolio and less signal-y.
    if (meta.action === "OTHER") continue;

    const id = [
      "pol",
      report.preset.id,
      t.filingDocId,
      // ticker may be null (e.g. mutual funds) — use asset-name digest fallback.
      t.ticker ?? assetSlug(t.assetName),
      t.action,
      t.transactionDate ?? "no-date",
      t.amountLow,
    ].join(":");

    out.push({
      id,
      category: "politicians",
      presetId: report.preset.id,
      presetName: report.preset.name,
      ticker: t.ticker,
      companyName: t.assetName,
      action: meta.action,
      actionLabel: meta.label,
      tradeDate: t.transactionDate,
      filingDate: t.filingDate,
      amountLabel: t.amountLabel,
      sourceUrl: t.pdfUrl,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Insider events — one per non-derivative Form 4 transaction row
// ---------------------------------------------------------------------------

/**
 * SEC insider transaction codes. See:
 *   https://www.sec.gov/about/forms/form4data.pdf
 * We only map the codes that are meaningful "buy/sell" signals for the
 * user. Grants, gifts, and tax-withholding transactions are noisy and
 * intentionally routed to `OTHER` (which is filtered out below).
 */
const INS_ACTION: Record<string, { action: EventAction; label: string }> = {
  P: { action: "BUY",   label: "Open-market buy" },
  S: { action: "SELL",  label: "Open-market sell" },
  A: { action: "OTHER", label: "Grant / award" },
  M: { action: "OTHER", label: "Option exercise" },
  F: { action: "OTHER", label: "Tax withholding" },
  G: { action: "OTHER", label: "Gift" },
  D: { action: "SELL",  label: "Sale to issuer" },
  X: { action: "OTHER", label: "Option exercise" },
};

export function insiderEvents(report: PersonReport): PortfolioEvent[] {
  const out: PortfolioEvent[] = [];
  for (const t of report.recentTransactions) {
    const code = t.transactionCode ?? "";
    const meta = INS_ACTION[code];
    if (!meta || meta.action === "OTHER") continue;

    const id = insiderEventId(report.preset.id, t);

    out.push({
      id,
      category: "people",
      presetId: report.preset.id,
      presetName: report.preset.name,
      ticker: t.issuerTicker,
      companyName: t.issuerName,
      action: meta.action,
      actionLabel: meta.label,
      tradeDate: t.transactionDate,
      filingDate: t.filingDate,
      amountLabel: formatInsiderAmount(t),
      sourceUrl: t.filingUrl,
    });
  }
  return out;
}

function insiderEventId(presetId: string, t: InsiderTransaction): string {
  return [
    "ins",
    presetId,
    t.accessionNumber,
    t.issuerCik ?? "no-cik",
    t.transactionCode ?? "no-code",
    t.transactionDate ?? "no-date",
    Math.round(t.shares || 0),
  ].join(":");
}

function formatInsiderAmount(t: InsiderTransaction): string {
  if (!t.shares) return "—";
  const sh = t.shares.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (t.pricePerShare === null) return `${sh} sh`;
  const px = t.pricePerShare.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
  const total = (t.shares * t.pricePerShare).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  return `${sh} sh @ ${px} · ${total}`;
}

// ---------------------------------------------------------------------------
// Fund events — 13F filings snap once per quarter. We emit one event per
// distinct filing (accessionNumber) so watchers get notified when a new
// 13F drops. Per-position deltas would need us to persist the prior
// snapshot, which is more work than fits this MVP — the accession-level
// event still lets ticker watches match because the event carries all
// holdings' tickers (see `fundEvents`).
// ---------------------------------------------------------------------------

export function fundEvents(report: FundReport): PortfolioEvent[] {
  if (!report.accessionNumber || report.holdings.length === 0) return [];
  const out: PortfolioEvent[] = [];

  // Emit a synthetic event per top holding so ticker-scoped watches can
  // match. This is coarse (we can't tell "new" from "held-since-last-Q"
  // without a prior snapshot) but users will still see NVDA activity if
  // Berkshire's latest 13F contains NVDA.
  //
  // Cap to top 25 by value so a heavy filer doesn't spam the poller
  // during first-time backfill.
  const topHoldings = [...report.holdings]
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 25);

  for (const h of topHoldings) {
    if (!h.cusip) continue;
    const id = [
      "fund",
      report.preset.id,
      report.accessionNumber,
      h.cusip,
    ].join(":");

    // 13F holdings historically only carried CUSIPs. Now that the
    // fetch orchestrator resolves issuer names → tickers via the
    // SEC company-tickers file (see `lib/sec-ticker-map.ts`), we
    // can surface a real ticker when we have one — that lets
    // ticker-scoped watchers (e.g. "notify me when any fund I
    // follow files NVDA") match against these events and puts a
    // useful symbol in the Telegram message. Falls back to `null`
    // for unresolved holdings, preserving the pre-existing behaviour.
    out.push({
      id,
      category: "funds",
      presetId: report.preset.id,
      presetName: `${report.preset.manager} (${report.preset.firm})`,
      ticker: h.resolvedTicker,
      companyName: h.issuer,
      action: "BUY", // Coarse: any 13F position is a long position → treat as BUY
      actionLabel: "13F position",
      tradeDate: report.reportPeriod,
      filingDate: report.filedAt,
      amountLabel: `${h.shares.toLocaleString("en-US", { maximumFractionDigits: 0 })} sh · ${(h.value ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`,
      sourceUrl: report.filingUrl ?? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${report.preset.cik}&type=13F&dateb=&owner=include&count=40`,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assetSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}
