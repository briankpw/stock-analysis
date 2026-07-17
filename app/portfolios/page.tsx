"use client";

/**
 * Portfolios — detail view for the currently-selected preset.
 *
 * The preset picker (the "rail") lives in the app sidebar
 * (`components/portfolios-rail.tsx`) so it's available from every route
 * in Portfolio mode. Selection state is shared via the Zustand store in
 * `lib/portfolios-state.ts`.
 *
 * This page reads the current selection from the store and renders the
 * matching detail panel — one of PersonDetail / PoliticianDetail /
 * FundDetail. Auto-selection on first visit lives here too, so the
 * detail area isn't blank when the user first lands on /portfolios.
 *
 * See:
 *   - `lib/portfolios.ts` for the data-source facade
 *   - `lib/portfolio-presets.ts` for custom-preset persistence
 *   - `hooks/use-portfolios.ts` for the shared client cache + mutations
 */

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
import { KeyTerms } from "@/components/key-terms";
import { TermTip } from "@/components/term-tip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ErrorBanner, LoadingPage } from "@/components/loading";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import { useT } from "@/lib/i18n";
import { WatchTradeButton } from "@/components/watch-trade-button";
import {
  entriesForCategory,
  PARTY_META,
} from "@/components/portfolios-rail";
import {
  useFundReport,
  usePersonReport,
  usePoliticianReport,
  usePortfolioIndex,
} from "@/hooks/use-portfolios";
import {
  usePortfolios,
  type Selection,
} from "@/lib/portfolios-state";
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
  FundPresetView,
  InsiderHolding,
  InsiderTransaction,
  PersonPreset,
  PersonPresetView,
  PoliticianHolding,
  PoliticianPreset,
  PoliticianPresetView,
  PoliticianTrade,
  PortfolioIndex,
} from "@/lib/portfolios";

// ---------------------------------------------------------------------------
// Detail panels — one per category
// ---------------------------------------------------------------------------

function PersonDetail({ preset }: { preset: PersonPreset }) {
  const { data, loading, error, sourceUnavailable, reload } = usePersonReport(preset);
  const t = useT();

  if (loading) return <LoadingPage label={t("loading.personFilings", { name: preset.name })} />;
  if (sourceUnavailable) {
    return <ErrorBanner message={t("portfolios.sec.throttled")} retry={reload} />;
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
          <div className="flex flex-wrap gap-3 items-start">
            <WatchTradeButton
              kind="person"
              category="people"
              presetId={preset.id}
              displayName={preset.name}
              variant="label"
            />
            <SmallStat label="Companies held" value={fmtInteger(data.holdings.length)} tone="neu" />
            <SmallStat label="Filings parsed" value={fmtInteger(data.filingsParsed)} tone="neu" />
            <SmallStat label="Transactions" value={fmtInteger(data.recentTransactions.length)} tone="neu" />
          </div>
        </div>
      </Card>

      <PersonHoldingsCard holdings={data.holdings} />
      <PersonTransactionsCard transactions={data.recentTransactions} />

      <p className="text-xs text-muted-foreground text-center">
        Source: <a href={data.source} target="_blank" rel="noreferrer" className="underline">SEC EDGAR submissions API</a>.
        Only <TermTip term="Non-Derivative"><strong>non-derivative</strong></TermTip> holdings
        (common / preferred stock) are shown; options, warrants and RSUs from the derivative
        table are omitted. <TermTip term="Section 16">Section 16</TermTip> insider filings
        only capture companies where {preset.name} is an officer, director, or ≥10% owner.
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
            <WatchTradeButton kind="ticker" ticker={t.issuerTicker} displayName={t.issuerName} />
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

// -------------------- Politician detail --------------------

function PoliticianDetail({ preset }: { preset: PoliticianPreset }) {
  const { data, loading, error, sourceUnavailable, reload } = usePoliticianReport(preset);
  const [selectedDocId, setSelectedDocId] = React.useState<string | null>(null);
  const partyMeta = PARTY_META[preset.party];
  const t = useT();

  React.useEffect(() => {
    setSelectedDocId(null);
  }, [preset.id]);

  if (loading) return <LoadingPage label={t("loading.politicianFilings", { name: preset.name })} />;
  if (sourceUnavailable) return <StockActUnavailable onRetry={reload} />;
  if (error) return <ErrorBanner message={error} retry={reload} />;
  if (!data) return null;

  if (data.chamberUnsupported) return <SenateNotSupported preset={preset} />;

  const selected = selectedDocId ? data.filings.find((f) => f.docId === selectedDocId) ?? null : null;

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
              {data.totalCount} Periodic Transaction Report{data.totalCount === 1 ? "" : "s"} on file (current + prior calendar year)
            </p>
          </div>
          <div className="flex flex-wrap gap-3 items-start">
            <WatchTradeButton
              kind="person"
              category="politicians"
              presetId={preset.id}
              displayName={preset.name}
              variant="label"
            />
            <SmallStat label="PTR filings" value={fmtInteger(data.totalCount)} tone="neu" />
            <SmallStat label="Parsed trades" value={fmtInteger(data.parsedTrades.length)} tone="neu" />
            <SmallStat label="Tickers touched" value={fmtInteger(data.holdings.length)} tone="neu" />
          </div>
        </div>
        {data.filingsSkipped > 0 && (
          <p className="text-[0.7rem] text-muted-foreground mt-3 border-l-2 border-warning/40 pl-2">
            {data.filingsSkipped} filing{data.filingsSkipped === 1 ? "" : "s"} could not be parsed automatically
            (usually scanned/handwritten PDFs). Click any filing below to view the original.
          </p>
        )}
      </Card>

      <PoliticianHoldingsCard holdings={data.holdings} />
      <PoliticianTradesCard trades={data.parsedTrades} onOpenFiling={(docId) => setSelectedDocId(docId)} />

      <Card className="p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/20">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="metric-label">Filings ({data.filings.length})</span>
        </div>
        {data.filings.length === 0 ? (
          <NoHouseFilingsExplainer preset={preset} />
        ) : (
          <div className="grid gap-0 lg:grid-cols-[minmax(0,20rem)_1fr]">
            <ul className="divide-y divide-border/50 lg:max-h-[75vh] lg:overflow-y-auto border-r border-border/50">
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

            <div className="min-h-[40vh] flex flex-col overflow-hidden">
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
                      Pick a filing on the left to preview it inline.
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
                  Each PDF lists every trade in that report — ticker, buy/sell/exchange,
                  amount range, and transaction date.
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        Source:{" "}
        <a href={data.source} target="_blank" rel="noreferrer" className="underline">
          House Clerk Financial Disclosure
        </a>{" "}
        — official STOCK Act PTR filings. Trades are parsed from the PDF text
        (typed filings parse cleanly; scanned/handwritten ones are skipped).
        The House PTR form only reports dollar ranges, so net-position estimates
        are ranges, not exact figures.
        Fetched {new Date(data.fetchedAt).toLocaleString()}.
      </p>
    </div>
  );
}

const TRADE_ACTION_META: Record<
  Exclude<PoliticianTrade["action"], null>,
  { label: string; chip: string }
> = {
  P:         { label: "Buy",           chip: "chip-bull" },
  S:         { label: "Sell",          chip: "chip-bear" },
  S_PARTIAL: { label: "Sell (partial)",chip: "chip-bear" },
  E:         { label: "Exchange",      chip: "chip-neu"  },
};

function PoliticianHoldingsCard({ holdings }: { holdings: PoliticianHolding[] }) {
  if (holdings.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Positions touched</CardTitle></CardHeader>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No tickers surfaced from the parsed PTR PDFs. This is common when the
          filings are handwritten or contain only non-equity transactions
          (Treasury notes, mutual funds).
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Positions touched ({holdings.length})</CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Aggregated per ticker across every parsed PTR. Dollar ranges are the
          disclosed brackets — the true net position sits somewhere between
          "low" and "high".
        </p>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[0.7rem] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="px-4 py-3 font-semibold">Ticker</th>
              <th className="px-4 py-3 font-semibold">Company</th>
              <th className="px-4 py-3 font-semibold text-right">Buys</th>
              <th className="px-4 py-3 font-semibold text-right">Sells</th>
              <th className="px-4 py-3 font-semibold text-right">Bought (range)</th>
              <th className="px-4 py-3 font-semibold text-right">Sold (range)</th>
              <th className="px-4 py-3 font-semibold text-right">Net estimate</th>
              <th className="px-4 py-3 font-semibold">Last trade</th>
            </tr>
          </thead>
          <tbody>
            {holdings.slice(0, 100).map((h) => (
              <tr
                key={h.ticker}
                className="border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors"
              >
                <td className="px-4 py-3 font-mono">
                  <div className="inline-flex items-center gap-1.5">
                    <span className="chip chip-neu">{h.ticker}</span>
                    <AddToWatchlistButton symbol={h.ticker} displayName={h.assetName} />
                    <WatchTradeButton kind="ticker" ticker={h.ticker} displayName={h.assetName} />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium truncate max-w-[18rem]" title={h.assetName}>
                    {h.assetName || DASH}
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-success">
                  {h.buyCount ? h.buyCount : DASH}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-danger">
                  {h.sellCount ? h.sellCount : DASH}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-xs">
                  {h.buyCount ? (
                    <>
                      {fmtCompactCurrency(h.totalBuyLow)}
                      <div className="opacity-70">to {fmtCompactCurrency(h.totalBuyHigh)}</div>
                    </>
                  ) : DASH}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-xs">
                  {h.sellCount ? (
                    <>
                      {fmtCompactCurrency(h.totalSellLow)}
                      <div className="opacity-70">to {fmtCompactCurrency(h.totalSellHigh)}</div>
                    </>
                  ) : DASH}
                </td>
                <td className={cn(
                  "px-4 py-3 text-right tabular-nums text-xs font-semibold",
                  h.netEstimateLow >= 0 ? "text-success" : h.netEstimateHigh < 0 ? "text-danger" : "text-warning",
                )}>
                  {h.netEstimateLow >= 0 ? "+" : ""}{fmtCompactCurrency(h.netEstimateLow)}
                  <div className="opacity-70 font-normal">
                    to {h.netEstimateHigh >= 0 ? "+" : ""}{fmtCompactCurrency(h.netEstimateHigh)}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                  {h.lastTradeDate ? (
                    <>
                      {new Date(h.lastTradeDate).toLocaleDateString()}
                      <div className="opacity-70">{relativeTime(h.lastTradeDate)}</div>
                    </>
                  ) : DASH}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PoliticianTradesCard({
  trades,
  onOpenFiling,
}: {
  trades: PoliticianTrade[];
  onOpenFiling: (docId: string) => void;
}) {
  if (trades.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Individual trades ({trades.length})</CardTitle></CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[0.7rem] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="px-4 py-3 font-semibold">Date</th>
              <th className="px-4 py-3 font-semibold">Owner</th>
              <th className="px-4 py-3 font-semibold">Asset</th>
              <th className="px-4 py-3 font-semibold">Ticker</th>
              <th className="px-4 py-3 font-semibold">Action</th>
              <th className="px-4 py-3 font-semibold text-right">Amount</th>
              <th className="px-4 py-3 font-semibold">Filing</th>
            </tr>
          </thead>
          <tbody>
            {trades.slice(0, 200).map((t, i) => {
              const meta = t.action ? TRADE_ACTION_META[t.action] : null;
              return (
                <tr
                  key={`${t.filingDocId}-${t.ticker ?? "notk"}-${i}`}
                  className="border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {t.transactionDate ? new Date(t.transactionDate).toLocaleDateString() : DASH}
                    {t.filingDate && (
                      <div className="opacity-70">filed {relativeTime(t.filingDate)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {t.ownerCode ?? "Self"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium truncate max-w-[16rem]" title={t.assetName}>
                      {t.assetName}
                    </div>
                    {t.assetClass && (
                      <div className="text-[0.65rem] uppercase text-muted-foreground mt-0.5">
                        [{t.assetClass}]
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {t.ticker ? (
                      <div className="inline-flex items-center gap-1.5">
                        <span className="chip chip-neu">{t.ticker}</span>
                        <AddToWatchlistButton symbol={t.ticker} displayName={t.assetName} />
                        <WatchTradeButton kind="ticker" ticker={t.ticker} displayName={t.assetName} />
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {meta ? (
                      <span className={cn("chip", meta.chip)}>{meta.label}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-xs">
                    {t.amountLabel}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <button
                      onClick={() => onOpenFiling(t.filingDocId)}
                      className="text-primary hover:underline inline-flex items-center gap-1"
                      title="Open the source PDF filing"
                    >
                      Doc {t.filingDocId} <ExternalLink className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {trades.length > 200 && (
        <div className="px-4 py-3 text-xs text-muted-foreground border-t border-border">
          Showing 200 of {trades.length} trades.
        </div>
      )}
    </Card>
  );
}

function NoHouseFilingsExplainer({ preset }: { preset: PoliticianPreset }) {
  const encodedName = encodeURIComponent(preset.name);
  return (
    <div className="py-6 px-4 text-sm space-y-3">
      <p>
        No House Clerk PTR filings found for <strong>{preset.name}</strong> in the current +
        prior calendar year window.
      </p>
      <p className="text-muted-foreground">Common reasons:</p>
      <ul className="text-xs text-muted-foreground space-y-1.5 pl-4 list-disc">
        <li>
          <strong className="text-foreground">Not a House Representative.</strong>{" "}
          This module reads from the U.S. House Clerk feed only. Senators, the President,
          Cabinet secretaries, and other executive-branch officials file with different
          agencies (OGE Form 278 for the executive branch,{" "}
          <a
            href={`https://efdsearch.senate.gov/search/?searchtype=ptr&fullname=${encodedName}`}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            efdsearch.senate.gov
          </a>{" "}
          for Senators) that aren't scraped here.
        </li>
        <li>
          <strong className="text-foreground">Name mismatch.</strong>{" "}
          Matching is <em>first-name prefix</em> + <em>last-name contains</em>. If the
          Clerk's spelling differs (e.g. hyphen vs space, initials), rename the preset to
          match how it appears on the source.
        </li>
        <li>
          <strong className="text-foreground">No trades this window.</strong>{" "}
          House members only file a PTR when they trade — some don't, or haven't recently.
        </li>
      </ul>
      <p className="text-xs text-muted-foreground">
        Sanity-check on the source:{" "}
        <a
          href={`https://disclosures-clerk.house.gov/PublicDisclosure/FinancialDisclosure#Search`}
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          House Clerk search page
        </a>
        .
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

// -------------------- Fund manager detail --------------------

function FundDetail({ preset }: { preset: FundPreset }) {
  const t = useT();
  const { data, loading, error, sourceUnavailable, reload } = useFundReport(preset);

  if (loading) return <LoadingPage label={t("loading.fund13F", { firm: preset.firm })} />;
  if (sourceUnavailable) {
    return <ErrorBanner message={t("portfolios.sec.throttled")} retry={reload} />;
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
          <div className="flex flex-wrap gap-3 items-start">
            <WatchTradeButton
              kind="person"
              category="funds"
              presetId={preset.id}
              displayName={`${preset.manager} · ${preset.firm}`}
              variant="label"
            />
            <SmallStat
              label="Reporting period"
              value={data.reportPeriod ? new Date(data.reportPeriod).toLocaleDateString() : DASH}
              tone="neu"
            />
            <SmallStat label="Positions" value={fmtInteger(data.positionCount)} tone="neu" />
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

// -------------------- Shared bits --------------------

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
// Page shell — just the detail view. The rail lives in the app sidebar.
// ---------------------------------------------------------------------------

function resolveSelection(
  index: PortfolioIndex,
  sel: Selection,
): PersonPresetView | PoliticianPresetView | FundPresetView | null {
  if (sel.category === "people") return index.people.find((p) => p.id === sel.id) ?? null;
  if (sel.category === "politicians") return index.politicians.find((p) => p.id === sel.id) ?? null;
  return index.funds.find((f) => f.id === sel.id) ?? null;
}

/**
 * Fills the icon slot in the empty-state hint so the user can tell
 * which category buttons are which even before opening a section.
 */
const CATEGORY_HINT = {
  people:      { icon: Users,     label: "People",         accent: "text-sky-500" },
  politicians: { icon: Landmark,  label: "Politicians",    accent: "text-amber-500" },
  funds:       { icon: Building2, label: "Fund managers",  accent: "text-emerald-500" },
} as const;

export default function PortfoliosPage() {
  const { data: index, loading, error } = usePortfolioIndex();
  const selection = usePortfolios((s) => s.selection);
  const setSelection = usePortfolios((s) => s.setSelection);
  const prefs = usePortfolios((s) => s.prefs);
  const setAddDialogCategory = usePortfolios((s) => s.setAddDialogCategory);
  const t = useT();

  // Auto-select on first load. Priority: last-viewed (if still present)
  // → first available preset in the user's preferred category order.
  React.useEffect(() => {
    if (!index || selection) return;
    const lastSeen = prefs.recent.find((s) => resolveSelection(index, s) !== null);
    if (lastSeen) {
      setSelection(lastSeen);
      return;
    }
    for (const category of prefs.order) {
      const first = entriesForCategory(index, category)[0];
      if (first) {
        setSelection({ category, id: first.id });
        return;
      }
    }
  }, [index, selection, prefs.order, prefs.recent, setSelection]);

  const selected = index && selection ? resolveSelection(index, selection) : null;

  return (
    <div className="mx-auto max-w-[110rem]">
      <header className="pb-6 border-b border-border mb-6">
        <p className="metric-label mb-1">{t("portfolios.title")}</p>
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">
          {t("portfolios.heading")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("portfolios.subheading")}
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          {t("portfolios.railHint")}
        </p>
      </header>
      <PageIntro pageKey="portfolios" />

      {error && <ErrorBanner message={error} />}
      {loading && !index && <LoadingPage label={t("loading.presetList")} />}

      {index && (
        <div className="min-w-0">
          {!selected ? (
            <EmptyDetail onAdd={setAddDialogCategory} />
          ) : selection!.category === "people" ? (
            <PersonDetail preset={selected as PersonPreset} />
          ) : selection!.category === "politicians" ? (
            <PoliticianDetail preset={selected as PoliticianPreset} />
          ) : (
            <FundDetail preset={selected as FundPreset} />
          )}
        </div>
      )}

      <KeyTerms
        terms={[
          "STOCK Act",
          "PTR",
          "House Clerk",
          "Form 3",
          "Form 4",
          "Form 5",
          "Form 13F",
          "13F-HR",
          "Section 16",
          "Non-Derivative",
          "Derivative",
          "Reporting Owner",
          "Direct",
          "Indirect",
          "CIK",
          "Cusip",
          "Accession",
        ]}
      />
    </div>
  );
}

/**
 * Rendered when the user has zero presets in every category — walks
 * them through adding the first one.
 */
function EmptyDetail({
  onAdd,
}: {
  onAdd: (category: "people" | "politicians" | "funds") => void;
}) {
  const t = useT();
  return (
    <Card>
      <CardContent className="py-12 space-y-6 text-center">
        <div>
          <h3 className="text-lg font-semibold">{t("portfolios.empty.title")}</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {t("portfolios.empty.body")}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {(["people", "politicians", "funds"] as const).map((cat) => {
            const meta = CATEGORY_HINT[cat];
            const Icon = meta.icon;
            const singular = t(`portfolios.cat.${cat}.singular`);
            return (
              <Button
                key={cat}
                variant="outline"
                size="sm"
                onClick={() => onAdd(cat)}
                className="gap-2"
              >
                <Icon className={cn("h-3.5 w-3.5", meta.accent)} />
                {t("portfolios.empty.add", { label: singular })}
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
