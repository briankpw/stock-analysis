"use client";

import * as React from "react";
import {
  Building2,
  ExternalLink,
  FileText,
  Landmark,
  Search,
  Users,
} from "lucide-react";
import { PageIntro } from "@/components/page-intro";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBanner, LoadingPage } from "@/components/loading";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import {
  useFundReport,
  usePersonReport,
  usePoliticianReport,
  usePortfolioIndex,
} from "@/hooks/use-portfolios";
import {
  fmtCompactCurrency,
  fmtInteger,
  fmtNumber,
  fmtPercent,
  fmtVolume,
  relativeTime,
  DASH,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  FundHolding,
  FundPreset,
  InsiderHolding,
  InsiderTransaction,
  PersonPreset,
  PersonReport,
  PoliticianFiling,
  PoliticianPreset,
} from "@/lib/portfolios";

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const PARTY_META: Record<"D" | "R" | "I", { chip: string; label: string }> = {
  D: { chip: "bg-blue-500/15 text-blue-500 border-blue-500/40", label: "Democrat" },
  R: { chip: "bg-red-500/15 text-red-500 border-red-500/40", label: "Republican" },
  I: { chip: "bg-purple-500/15 text-purple-500 border-purple-500/40", label: "Independent" },
};

// ---------------------------------------------------------------------------
// Preset grid — the picker for both tabs
// ---------------------------------------------------------------------------

function PresetGrid<T extends { id: string }>({
  items,
  selectedId,
  onSelect,
  renderItem,
}: {
  items: readonly T[];
  selectedId: string | null;
  onSelect: (item: T) => void;
  renderItem: (item: T, active: boolean) => React.ReactNode;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const active = selectedId === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item)}
            className={cn(
              "text-left rounded-xl border p-3 transition-all",
              active
                ? "border-primary bg-primary/10 shadow-sm"
                : "border-border bg-card hover:bg-muted/50 hover:border-border/80",
            )}
          >
            {renderItem(item, active)}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Politician detail view
// ---------------------------------------------------------------------------

function PoliticianDetail({ preset }: { preset: PoliticianPreset }) {
  const { data, loading, error, sourceUnavailable, reload } = usePoliticianReport(preset);
  const [selectedDocId, setSelectedDocId] = React.useState<string | null>(null);
  const partyMeta = PARTY_META[preset.party];

  // Auto-preview the most recent filing when the politician (or their data) changes.
  React.useEffect(() => {
    setSelectedDocId(data?.filings[0]?.docId ?? null);
  }, [data]);

  if (loading) return <LoadingPage label={`Loading filings for ${preset.name}…`} />;
  if (sourceUnavailable) return <StockActUnavailable onRetry={reload} />;
  if (error) return <ErrorBanner message={error} retry={reload} />;
  if (!data) return null;

  if (data.chamberUnsupported) return <SenateNotSupported preset={preset} />;

  const selected = data.filings.find((f) => f.docId === selectedDocId) ?? null;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className={cn("chip", partyMeta.chip)}>{partyMeta.label}</span>
              <span className="text-xs text-muted-foreground">
                {preset.chamber} · {preset.role ?? "Member"}
              </span>
            </div>
            <h2 className="text-xl font-semibold">{preset.name}</h2>
            <p className="text-xs text-muted-foreground mt-1">
              {data.totalCount} Periodic Transaction Reports on file (last 2 years)
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <SmallStat label="PTR filings" value={fmtInteger(data.totalCount)} tone="neu" />
            <SmallStat
              label="Most recent"
              value={
                data.filings[0]?.filingDate
                  ? new Date(data.filings[0].filingDate).toLocaleDateString()
                  : DASH
              }
              tone="neu"
            />
          </div>
        </div>
      </Card>

      {data.filings.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No Periodic Transaction Reports found for <strong>{preset.name}</strong> in the
            current window (current + prior calendar year).
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
          <Card className="p-0 max-h-[75vh] overflow-y-auto">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border sticky top-0 bg-card/95 backdrop-blur">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="metric-label">Filings ({data.filings.length})</span>
            </div>
            <ul className="divide-y divide-border/50">
              {data.filings.map((f) => (
                <li key={f.docId}>
                  <button
                    onClick={() => setSelectedDocId(f.docId)}
                    className={cn(
                      "w-full text-left px-3 py-3 hover:bg-muted/30 transition-colors",
                      selectedDocId === f.docId && "bg-primary/10",
                    )}
                  >
                    <div className="text-sm font-medium">
                      {f.filingDate
                        ? new Date(f.filingDate).toLocaleDateString()
                        : "unknown date"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Doc {f.docId} · {f.stateDst || "House"}
                    </div>
                    {f.filingDate && (
                      <div className="text-[0.7rem] text-muted-foreground opacity-70 mt-0.5">
                        filed {relativeTime(f.filingDate)}
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="min-h-[60vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-3 justify-between">
              <div className="text-sm min-w-0 truncate">
                {selected ? (
                  <>
                    <span className="font-medium">Doc {selected.docId}</span>
                    <span className="text-muted-foreground ml-2">
                      {selected.filingDate
                        ? new Date(selected.filingDate).toLocaleDateString()
                        : "unknown date"}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    Pick a filing on the left to preview it.
                  </span>
                )}
              </div>
              {selected && (
                <a
                  href={selected.pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1 text-xs shrink-0"
                >
                  Open PDF <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            {selected ? (
              <iframe
                key={selected.docId}
                src={selected.pdfUrl}
                title={`PTR filing ${selected.docId}`}
                className="w-full flex-1 min-h-[60vh] bg-white"
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-8 text-center">
                Filings appear here inline. Each PDF lists every trade in that report —
                ticker, buy/sell/exchange, amount range, and transaction date.
              </div>
            )}
          </Card>
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center">
        Source:{" "}
        <a href={data.source} target="_blank" rel="noreferrer" className="underline">
          House Clerk Financial Disclosure
        </a>{" "}
        — official STOCK Act PTR filings.
        Fetched {new Date(data.fetchedAt).toLocaleString()}.
      </p>
    </div>
  );
}

function SenateNotSupported({ preset }: { preset: PoliticianPreset }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Senate filings aren't wired in yet</CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-3">
        <p>
          <strong>{preset.name}</strong> is a Senator, but the Senate's Electronic Financial
          Disclosure portal (<code className="text-xs">efdsearch.senate.gov</code>) requires an
          interactive click-through session before it serves data — the House's plain XML dump
          doesn't have a Senate equivalent.
        </p>
        <p className="text-muted-foreground">
          You can view Senate PTRs directly at{" "}
          <a
            href={`https://efdsearch.senate.gov/search/?searchtype=ptr&fullname=${encodeURIComponent(preset.name)}`}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            efdsearch.senate.gov
          </a>
          . Only House members are covered inside this dashboard for now.
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Fund detail view
// ---------------------------------------------------------------------------

function FundDetail({ preset }: { preset: FundPreset }) {
  const { data, loading, error, sourceUnavailable, reload } = useFundReport(preset);

  if (loading) return <LoadingPage label={`Loading 13F for ${preset.firm}…`} />;
  if (sourceUnavailable) {
    return (
      <ErrorBanner
        message="SEC EDGAR is throttling us. Try again in a minute."
        retry={reload}
      />
    );
  }
  if (error) return <ErrorBanner message={error} retry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Landmark className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">13F-HR · SEC filing</span>
            </div>
            <h2 className="text-xl font-semibold">{preset.manager}</h2>
            <p className="text-sm text-muted-foreground">{preset.firm}</p>
            {preset.note && (
              <p className="text-xs text-muted-foreground mt-1">{preset.note}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <SmallStat
              label="Reporting period"
              value={data.reportPeriod ? new Date(data.reportPeriod).toLocaleDateString() : DASH}
              tone="neu"
            />
            <SmallStat
              label="Positions"
              value={fmtInteger(data.positionCount)}
              tone="neu"
            />
            <SmallStat
              label="Portfolio value"
              value={fmtCompactCurrency(data.totalValue)}
              tone="neu"
            />
          </div>
        </div>
      </Card>

      {data.holdings.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            <p>No 13F filing parsed for <strong>{preset.firm}</strong>.</p>
            <p className="mt-2 text-xs">
              SEC EDGAR may be throttling us, or the manager doesn't file 13Fs
              (some hedge funds fall under different reporting thresholds).
              Try again in a minute.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[0.7rem] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="px-4 py-3 font-semibold">#</th>
                  <th className="px-4 py-3 font-semibold">Issuer</th>
                  <th className="px-4 py-3 font-semibold">Class</th>
                  <th className="px-4 py-3 font-semibold text-right">Shares</th>
                  <th className="px-4 py-3 font-semibold text-right">Value</th>
                  <th className="px-4 py-3 font-semibold text-right">% of portfolio</th>
                  <th className="px-4 py-3 font-semibold">Put/Call</th>
                  <th className="px-4 py-3 font-semibold">Look up</th>
                </tr>
              </thead>
              <tbody>
                {data.holdings.slice(0, 100).map((h, i) => (
                  <HoldingRow key={`${h.cusip}-${i}`} rank={i + 1} h={h} />
                ))}
              </tbody>
            </table>
          </div>
          {data.holdings.length > 100 && (
            <div className="px-4 py-3 text-xs text-muted-foreground border-t border-border">
              Showing top 100 of {data.holdings.length} positions by value.
            </div>
          )}
        </Card>
      )}

      <p className="text-xs text-muted-foreground text-center">
        Source: SEC EDGAR 13F-HR filing
        {data.filingUrl && (
          <>
            {" "}·{" "}
            <a href={data.filingUrl} target="_blank" rel="noreferrer" className="underline">
              accession {data.accessionNumber}
            </a>
          </>
        )}
        . 13F reports are filed quarterly (within 45 days of quarter-end) and only
        cover long US equity positions — short positions and non-US holdings are excluded.
        Fetched {new Date(data.fetchedAt).toLocaleString()}.
      </p>
    </div>
  );
}

function HoldingRow({ rank, h }: { rank: number; h: FundHolding }) {
  const searchQuery = encodeURIComponent(`${h.issuer} stock ticker`);
  return (
    <tr className="border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3 tabular-nums text-muted-foreground">{rank}</td>
      <td className="px-4 py-3">
        <div className="font-medium">{h.issuer || DASH}</div>
        <div className="text-[0.7rem] text-muted-foreground font-mono">{h.cusip}</div>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{h.titleOfClass || DASH}</td>
      <td className="px-4 py-3 text-right tabular-nums">
        {fmtVolume(h.shares)}
        <div className="text-[0.65rem] uppercase text-muted-foreground">{h.shareType}</div>
      </td>
      <td className="px-4 py-3 text-right tabular-nums font-semibold">
        {fmtCompactCurrency(h.value)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {fmtPercent(h.pctOfPortfolio)}
      </td>
      <td className="px-4 py-3 text-xs">
        {h.putCall ? (
          <span className={cn("chip", h.putCall.toLowerCase() === "put" ? "chip-bear" : "chip-bull")}>
            {h.putCall.toUpperCase()}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <a
          href={`https://finance.yahoo.com/lookup?s=${searchQuery}`}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-primary inline-flex items-center gap-1 text-xs"
          title="Look up ticker on Yahoo Finance"
        >
          <Search className="h-3 w-3" />
          find
        </a>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// People detail view — SEC Form 3/4/5 insider filings
// ---------------------------------------------------------------------------

/**
 * Plain-English label + colour for the single-letter transaction codes
 * from Form 4. Sourced from the SEC's Form 4 code sheet — see comment on
 * the `InsiderTransaction.transactionCode` field.
 */
const TX_CODE_META: Record<string, { label: string; tone: "bull" | "bear" | "neu" }> = {
  P: { label: "Buy",              tone: "bull" },
  S: { label: "Sell",             tone: "bear" },
  A: { label: "Grant / award",    tone: "bull" },
  M: { label: "Option exercise",  tone: "bull" },
  F: { label: "Tax withholding",  tone: "bear" },
  G: { label: "Gift",             tone: "neu"  },
  D: { label: "Sale to issuer",   tone: "bear" },
  X: { label: "Option exercise",  tone: "bull" },
  I: { label: "Discretionary",    tone: "neu"  },
  J: { label: "Other acquisition",tone: "neu"  },
  K: { label: "Equity swap",      tone: "neu"  },
  L: { label: "Small acquisition",tone: "bull" },
  V: { label: "Voluntary report", tone: "neu"  },
};

function PersonDetail({ preset }: { preset: PersonPreset }) {
  const { data, loading, error, sourceUnavailable, reload } = usePersonReport(preset);

  if (loading) return <LoadingPage label={`Loading SEC filings for ${preset.name}…`} />;
  if (sourceUnavailable) {
    return (
      <ErrorBanner
        message="SEC EDGAR is throttling us. Try again in a minute."
        retry={reload}
      />
    );
  }
  if (error) return <ErrorBanner message={error} retry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">SEC Form 3/4/5 · Insider filings</span>
            </div>
            <h2 className="text-xl font-semibold">{preset.name}</h2>
            <p className="text-sm text-muted-foreground">{preset.role}</p>
            <p className="text-[0.7rem] text-muted-foreground mt-1 font-mono">
              CIK {preset.cik}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <SmallStat
              label="Companies held"
              value={fmtInteger(data.holdings.length)}
              tone="neu"
            />
            <SmallStat
              label="Filings parsed"
              value={fmtInteger(data.filingsParsed)}
              tone="neu"
            />
            <SmallStat
              label="Transactions"
              value={fmtInteger(data.recentTransactions.length)}
              tone="neu"
            />
          </div>
        </div>
      </Card>

      <PersonHoldingsCard holdings={data.holdings} />
      <PersonTransactionsCard transactions={data.recentTransactions} />

      <p className="text-xs text-muted-foreground text-center">
        Source: <a href={data.source} target="_blank" rel="noreferrer" className="underline">SEC EDGAR submissions API</a>.
        Only <strong>non-derivative</strong> holdings (common / preferred stock) are shown;
        options, warrants and RSUs from the derivative table are omitted.
        These are Section 16 insider filings, so this view only captures companies
        where {preset.name} is an officer, director, or ≥10% owner.
        Fetched {new Date(data.fetchedAt).toLocaleString()}.
      </p>
    </div>
  );
}

function PersonHoldingsCard({ holdings }: { holdings: InsiderHolding[] }) {
  if (holdings.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Current holdings</CardTitle></CardHeader>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No non-derivative holdings surfaced in the last parsed filings. This
          person may only hold options / RSUs (from the derivative table),
          or have exited every reported position.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader><CardTitle>Current holdings ({holdings.length})</CardTitle></CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[0.7rem] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="px-4 py-3 font-semibold">Issuer</th>
              <th className="px-4 py-3 font-semibold">Ticker</th>
              <th className="px-4 py-3 font-semibold text-right">Shares held</th>
              <th className="px-4 py-3 font-semibold">Last filing</th>
              <th className="px-4 py-3 font-semibold text-right"># filings</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => (
              <tr
                key={`${h.issuerCik ?? h.issuerName}-${h.issuerTicker ?? ""}`}
                className="border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="font-medium">{h.issuerName || DASH}</div>
                  {h.issuerCik && (
                    <div className="text-[0.7rem] text-muted-foreground font-mono">CIK {h.issuerCik}</div>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs">
                  {h.issuerTicker ? (
                    <div className="inline-flex items-center gap-1.5">
                      <span className="chip chip-neu">{h.issuerTicker}</span>
                      <AddToWatchlistButton symbol={h.issuerTicker} displayName={h.issuerName} />
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">
                  {fmtNumber(h.sharesHeld, 0)}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                  {h.lastFilingDate ? (
                    <>
                      {new Date(h.lastFilingDate).toLocaleDateString()}
                      <div className="opacity-70">{relativeTime(h.lastFilingDate)}</div>
                    </>
                  ) : DASH}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-xs text-muted-foreground">
                  {h.totalFilingsSeen}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PersonTransactionsCard({ transactions }: { transactions: InsiderTransaction[] }) {
  if (transactions.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Recent transactions</CardTitle></CardHeader>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No non-derivative transactions parsed.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader><CardTitle>Recent transactions ({transactions.length})</CardTitle></CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[0.7rem] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="px-4 py-3 font-semibold">Date</th>
              <th className="px-4 py-3 font-semibold">Form</th>
              <th className="px-4 py-3 font-semibold">Issuer</th>
              <th className="px-4 py-3 font-semibold">Action</th>
              <th className="px-4 py-3 font-semibold text-right">Shares</th>
              <th className="px-4 py-3 font-semibold text-right">Price</th>
              <th className="px-4 py-3 font-semibold text-right">Post-trade</th>
              <th className="px-4 py-3 font-semibold">Filing</th>
            </tr>
          </thead>
          <tbody>
            {transactions.slice(0, 100).map((t, i) => (
              <InsiderTxRow key={`${t.accessionNumber}-${i}`} t={t} />
            ))}
          </tbody>
        </table>
      </div>
      {transactions.length > 100 && (
        <div className="px-4 py-3 text-xs text-muted-foreground border-t border-border">
          Showing 100 of {transactions.length} transactions.
        </div>
      )}
    </Card>
  );
}

function InsiderTxRow({ t }: { t: InsiderTransaction }) {
  const code = t.transactionCode ?? "";
  const meta = TX_CODE_META[code];
  const chipClass = !meta
    ? "chip-neu"
    : meta.tone === "bull" ? "chip-bull"
    : meta.tone === "bear" ? "chip-bear"
    : "chip-neu";
  const label = meta?.label ?? (code ? `Code ${code}` : "Holding");

  return (
    <tr className="border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
        {t.transactionDate
          ? new Date(t.transactionDate).toLocaleDateString()
          : DASH}
        {t.filingDate && (
          <div className="opacity-70">filed {relativeTime(t.filingDate)}</div>
        )}
      </td>
      <td className="px-4 py-3 text-xs">
        <span className="chip chip-neu">{t.formType}</span>
      </td>
      <td className="px-4 py-3">
        <div className="font-medium truncate max-w-[16rem]" title={t.issuerName}>
          {t.issuerName || DASH}
        </div>
        {t.issuerTicker && (
          <div className="mt-1 inline-flex items-center gap-1.5 font-mono text-xs">
            <span className="chip chip-neu">{t.issuerTicker}</span>
            <AddToWatchlistButton symbol={t.issuerTicker} displayName={t.issuerName} />
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-xs">
        <span className={cn("chip", chipClass)} title={code ? `SEC code ${code}` : undefined}>
          {label}
        </span>
        {t.directOrIndirect && (
          <div className="text-[0.65rem] text-muted-foreground mt-1">
            {t.directOrIndirect === "D" ? "Direct" : "Indirect"}
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {t.shares ? fmtNumber(t.shares, 0) : DASH}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
        {t.pricePerShare !== null ? fmtCompactCurrency(t.pricePerShare) : DASH}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-xs">
        {t.sharesOwnedFollowing !== null ? fmtNumber(t.sharesOwnedFollowing, 0) : DASH}
      </td>
      <td className="px-4 py-3">
        <a
          href={t.filingUrl}
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline inline-flex items-center gap-1 text-xs"
          title="Open on SEC EDGAR"
        >
          SEC <ExternalLink className="h-3 w-3" />
        </a>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// STOCK Act source unavailable panel
// ---------------------------------------------------------------------------

function StockActUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>House Clerk feed unreachable</CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-3">
        <p>
          The official House Clerk disclosure feed{" "}
          (<code className="text-xs">disclosures-clerk.house.gov</code>) didn't respond just now.
          This is rare — the endpoint is a legal disclosure requirement and normally stays up.
        </p>
        <p className="text-muted-foreground">
          Try again in a moment, or verify network reachability to{" "}
          <a
            href="https://disclosures-clerk.house.gov/FinancialDisclosure"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            disclosures-clerk.house.gov
          </a>
          .
        </p>
        <button
          onClick={onRetry}
          className="mt-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted/50 transition-colors"
        >
          Retry
        </button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Small stat pill used inside the header cards
// ---------------------------------------------------------------------------

function SmallStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "bull" | "bear" | "neu";
}) {
  const border =
    tone === "bull" ? "border-l-success" :
    tone === "bear" ? "border-l-danger" :
    "border-l-border";
  return (
    <div className={cn("rounded-lg border border-border border-l-4 px-3 py-2 bg-card", border)}>
      <div className="metric-label">{label}</div>
      <div className="text-sm font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PortfoliosPage() {
  const { data: index, loading, error } = usePortfolioIndex();
  const [politician, setPolitician] = React.useState<PoliticianPreset | null>(null);
  const [fund, setFund] = React.useState<FundPreset | null>(null);
  const [person, setPerson] = React.useState<PersonPreset | null>(null);

  return (
    <div className="mx-auto max-w-7xl">
      <header className="pb-6 border-b border-border mb-6">
        <p className="metric-label mb-1">Portfolios</p>
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">
          Whose trades are you following?
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          House-side STOCK Act disclosures (PTR filings), SEC 13F institutional holdings,
          and individual insider filings (Forms 3/4/5) — all pulled straight from the
          official sources.
        </p>
      </header>
      <PageIntro pageKey="portfolios" />

      {error && <ErrorBanner message={error} />}
      {loading && !index && <LoadingPage label="Loading preset list…" />}

      {index && (
        <Tabs defaultValue="people">
          <TabsList>
            <TabsTrigger value="people">
              <Users className="h-3.5 w-3.5 mr-1.5" />
              People ({index.people.length})
            </TabsTrigger>
            <TabsTrigger value="politicians">
              <Landmark className="h-3.5 w-3.5 mr-1.5" />
              Politicians ({index.politicians.length})
            </TabsTrigger>
            <TabsTrigger value="funds">
              <Building2 className="h-3.5 w-3.5 mr-1.5" />
              Fund managers ({index.funds.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="people">
            <Card className="mb-4">
              <CardHeader>
                <CardTitle>Pick a person</CardTitle>
              </CardHeader>
              <CardContent>
                <PresetGrid
                  items={index.people}
                  selectedId={person?.id ?? null}
                  onSelect={setPerson}
                  renderItem={(p) => (
                    <div>
                      <div className="font-semibold">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{p.role}</div>
                      {p.note && <div className="text-[0.7rem] text-muted-foreground mt-1">{p.note}</div>}
                    </div>
                  )}
                />
              </CardContent>
            </Card>

            {person ? (
              <PersonDetail preset={person} />
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                Choose someone above to see their Section 16 insider holdings.
              </p>
            )}
          </TabsContent>

          <TabsContent value="politicians">
            <Card className="mb-4">
              <CardHeader>
                <CardTitle>Pick a politician</CardTitle>
              </CardHeader>
              <CardContent>
                <PresetGrid
                  items={index.politicians}
                  selectedId={politician?.id ?? null}
                  onSelect={setPolitician}
                  renderItem={(p) => {
                    const meta = PARTY_META[p.party];
                    return (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold">{p.name}</span>
                          <span className={cn("chip", meta.chip)}>{p.party}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {p.chamber}
                          {p.role ? ` · ${p.role}` : ""}
                        </div>
                      </div>
                    );
                  }}
                />
              </CardContent>
            </Card>

            {politician ? (
              <PoliticianDetail preset={politician} />
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                Choose someone above to see their STOCK Act disclosures.
              </p>
            )}
          </TabsContent>

          <TabsContent value="funds">
            <Card className="mb-4">
              <CardHeader>
                <CardTitle>Pick a fund manager</CardTitle>
              </CardHeader>
              <CardContent>
                <PresetGrid
                  items={index.funds}
                  selectedId={fund?.id ?? null}
                  onSelect={setFund}
                  renderItem={(f) => (
                    <div>
                      <div className="font-semibold">{f.manager}</div>
                      <div className="text-xs text-muted-foreground">{f.firm}</div>
                      {f.note && <div className="text-[0.7rem] text-muted-foreground mt-1">{f.note}</div>}
                    </div>
                  )}
                />
              </CardContent>
            </Card>

            {fund ? (
              <FundDetail preset={fund} />
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                Choose a fund manager above to see their latest 13F holdings.
              </p>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
