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
import { Pagination, usePagination } from "@/components/ui/pagination";
import {
  SortableTh,
  TableToolbar,
  useTableControls,
} from "@/components/ui/table-controls";
import { ErrorBanner, LoadingPage } from "@/components/loading";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import { AddIssuerToWatchlistButton } from "@/components/add-issuer-to-watchlist-button";
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
  PoliticianFilingStatus,
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

  const noHoldings = data.holdings.length === 0;
  const noTx = data.recentTransactions.length === 0;
  const filingsTotal =
    data.filingsParsed + data.filingsSkipped + data.filingsDerivativeOnly;

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
            <SmallStat
              label="Companies held"
              value={fmtInteger(data.holdings.length)}
              tone={noHoldings ? "warn" : "neu"}
            />
            <SmallStat
              label="Filings parsed"
              value={fmtInteger(data.filingsParsed)}
              tone={data.filingsParsed === 0 ? "warn" : "neu"}
            />
            <SmallStat
              label="Transactions"
              value={fmtInteger(data.recentTransactions.length)}
              tone={noTx ? "warn" : "neu"}
            />
          </div>
        </div>
      </Card>

      {noHoldings && noTx ? (
        <NoInsiderDataExplainer
          preset={preset}
          filingsParsed={data.filingsParsed}
          filingsSkipped={data.filingsSkipped}
          filingsDerivativeOnly={data.filingsDerivativeOnly}
          filingsTotal={filingsTotal}
        />
      ) : (
        <>
          <PersonHoldingsCard holdings={data.holdings} />
          <PersonTransactionsCard transactions={data.recentTransactions} />
        </>
      )}

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

/**
 * Diagnostic card for the "we parsed X filings but surfaced nothing"
 * state on an individual insider preset. Modelled on the politician
 * `NoHouseFilingsExplainer` — the goal is to tell users *why* the panel
 * is empty (which is almost always benign — Section 16 filers paid in
 * RSUs never generate non-derivative rows until they sell) and give them
 * a one-click way to sanity-check against the raw SEC feed.
 */
function NoInsiderDataExplainer({
  preset,
  filingsParsed,
  filingsSkipped,
  filingsDerivativeOnly,
  filingsTotal,
}: {
  preset: PersonPreset;
  filingsParsed: number;
  filingsSkipped: number;
  filingsDerivativeOnly: number;
  filingsTotal: number;
}) {
  const edgarSearchUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${preset.cik}&type=&dateb=&owner=include&count=40`;
  const rawSubmissionsUrl = `https://data.sec.gov/submissions/CIK${preset.cik}.json`;

  // Discriminate the four plausible states so the copy actually matches
  // what happened rather than dumping the whole possibility tree on the
  // user. Priority order matters — a preset can hit "some parsed, some
  // failed" in which case the mixed message is the useful one.
  //   noFilings      — EDGAR returned no Form 3/4/5 in the window at all
  //   allDerivative  — every parsed filing was options/RSUs only
  //   allFailed      — every filing failed to fetch/parse (rate-limit)
  //   mixed          — a bit of everything, none producing non-deriv rows
  const state: "noFilings" | "allDerivative" | "allFailed" | "mixed" =
    filingsTotal === 0
      ? "noFilings"
      : filingsSkipped === filingsTotal
        ? "allFailed"
        : filingsDerivativeOnly === filingsTotal - filingsSkipped &&
            filingsSkipped === 0
          ? "allDerivative"
          : "mixed";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nothing to show for {preset.name}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-3">
        <p>
          {state === "noFilings" && (
            <>
              SEC EDGAR returned <strong>no Form 3/4/5 filings</strong> for CIK{" "}
              <code className="text-xs">{preset.cik}</code> in the current window.
            </>
          )}
          {state === "allFailed" && (
            <>
              Found <strong>{filingsTotal}</strong> Form 3/4/5 filing
              {filingsTotal === 1 ? "" : "s"} on EDGAR, but couldn't fetch or
              parse any of them (all {filingsSkipped} skipped). This is almost
              always rate-limiting — retry in a minute.
            </>
          )}
          {state === "allDerivative" && (
            <>
              Parsed <strong>{filingsDerivativeOnly}</strong> Form 3/4/5 filing
              {filingsDerivativeOnly === 1 ? "" : "s"} for {preset.name}, but
              none contained any{" "}
              <TermTip term="Non-Derivative">non-derivative</TermTip> rows —
              everything reported was options, warrants, or RSUs (the derivative
              table, which we omit by design).
            </>
          )}
          {state === "mixed" && (
            <>
              Read <strong>{filingsTotal}</strong> Form 3/4/5 filing
              {filingsTotal === 1 ? "" : "s"} but surfaced nothing:{" "}
              {filingsDerivativeOnly} contained only derivative rows
              (options / RSUs) and {filingsSkipped} couldn't be fetched or
              parsed.
            </>
          )}
        </p>

        <p className="text-muted-foreground">Common reasons:</p>
        <ul className="text-xs text-muted-foreground space-y-1.5 pl-4 list-disc">
          <li>
            <strong className="text-foreground">
              Compensation is mostly equity awards.
            </strong>{" "}
            Tech-executive Form 4s are dominated by RSU grants and vests (Form 4
            code <code>A</code>/<code>M</code>) which live in the{" "}
            <TermTip term="Derivative">derivative table</TermTip>. Until the
            insider sells the underlying shares (a code <code>S</code>{" "}
            sale, which generates a non-derivative row), the parser sees
            nothing to show here.
          </li>
          <li>
            <strong className="text-foreground">Every position was closed.</strong>{" "}
            The most recent filing may have reported{" "}
            <code>sharesOwnedFollowing = 0</code> for every issuer — legit if
            the insider has fully exited but retains the Section 16 relationship.
          </li>
          <li>
            <strong className="text-foreground">Wrong or stale CIK.</strong>{" "}
            The CIK on this preset may point to a trust, family office, or
            former entity rather than the person's current insider CIK. Check
            the EDGAR search below to confirm.
          </li>
          <li>
            <strong className="text-foreground">EDGAR rate-limited us.</strong>{" "}
            SEC caps public traffic at ~10 requests/sec per IP. If several
            people/funds are refreshed simultaneously we may drop filings;
            retrying in a minute usually clears it.
          </li>
        </ul>

        <p className="text-xs text-muted-foreground">
          Sanity-check against the source:{" "}
          <a
            href={edgarSearchUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            EDGAR filings for CIK {preset.cik}
          </a>
          {" · "}
          <a
            href={rawSubmissionsUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            raw submissions JSON
          </a>
          .
        </p>
      </CardContent>
    </Card>
  );
}

function PersonHoldingsCard({ holdings }: { holdings: InsiderHolding[] }) {
  const t = useT();
  // Search over issuer + ticker + CIK — the three fields a user
  // is likely to have in mind when hunting for a specific row.
  // Sort defaults to nothing (source order = "most recent filing
  // first" from the backend), but users can click any of the four
  // numeric / date columns to override.
  const controls = useTableControls<InsiderHolding, "shares" | "lastFiling" | "filings">(
    holdings,
    {
      searchFields: (h) => [h.issuerName, h.issuerTicker, h.issuerCik],
      sorters: {
        shares: (a, b) => (a.sharesHeld ?? 0) - (b.sharesHeld ?? 0),
        // Missing filing dates sort to the bottom under desc, top under
        // asc — feed a sentinel epoch instead of NaN so the sort stays
        // stable rather than triggering "NaN vs number" comparisons.
        lastFiling: (a, b) => {
          const ta = a.lastFilingDate ? new Date(a.lastFilingDate).getTime() : 0;
          const tb = b.lastFilingDate ? new Date(b.lastFilingDate).getTime() : 0;
          return ta - tb;
        },
        filings: (a, b) => (a.totalFilingsSeen ?? 0) - (b.totalFilingsSeen ?? 0),
      },
    },
  );
  // Portfolio tables can get long (200+ trades for an active politician,
  // 100+ 13F positions for a large fund). Paginate at 25 rows so a full
  // "page" fits in one viewport on a laptop without the user scrolling
  // through 100+ rows to find the last-known holding.
  const pager = usePagination(controls.rows, 25);
  // Snap back to page 1 whenever the filter changes, otherwise a user
  // paging through the tail of the unfiltered list and then typing a
  // search would land on an empty "page 6 of 1" until the pagination
  // hook's clamp effect fires on the next paint.
  React.useEffect(() => {
    pager.setPage(1);
  }, [controls.query, controls.sort, pager.setPage]);
  if (holdings.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Current holdings</CardTitle></CardHeader>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No non-derivative holdings on file — but recent transactions were
          parsed below. This typically means every reported position has
          been closed while option / RSU activity continues in the derivative
          table (which is intentionally omitted).
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader><CardTitle>Current holdings ({holdings.length})</CardTitle></CardHeader>
      <TableToolbar
        controls={controls}
        placeholder={t("table.searchPlaceholder")}
        clearLabel={t("table.clearFilters")}
        formatMatchHint={(n, m) => t("table.matchHint", { visible: n, total: m })}
      />
      <div className="table-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[0.7rem] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="px-4 py-3 font-semibold">Issuer</th>
              <th className="px-4 py-3 font-semibold">Ticker</th>
              <SortableTh controls={controls} sortKey="shares" className="px-4 py-3 font-semibold text-right" sortLabelPrefix={t("table.sortBy")}>Shares held</SortableTh>
              <SortableTh controls={controls} sortKey="lastFiling" className="px-4 py-3 font-semibold" sortLabelPrefix={t("table.sortBy")}>Last filing</SortableTh>
              <SortableTh controls={controls} sortKey="filings" className="px-4 py-3 font-semibold text-right" sortLabelPrefix={t("table.sortBy")}># filings</SortableTh>
            </tr>
          </thead>
          <tbody>
            {pager.visibleItems.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {t("table.noMatches")}
                </td>
              </tr>
            ) : pager.visibleItems.map((h) => (
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
      <Pagination
        page={pager.page}
        pageCount={pager.pageCount}
        total={pager.total}
        range={pager.range}
        onPageChange={pager.setPage}
        pageSize={pager.pageSize}
        onPageSizeChange={pager.setPageSize}
        pageSizeOptions={[10, 25, 50, 100, 0]}
        pageSizeLabel={t("pager.pageSizeLabel")}
        allLabel={t("pager.all")}
        className="px-4 py-3 border-t border-border"
        label={t("pager.holdings")}
      />
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
  const t = useT();
  // Search over issuer + ticker so a user can jump straight to
  // "the AAPL row" in a multi-hundred-row tape. Sort on the four
  // numeric / date columns — Date is the natural default and
  // matches the pre-existing "most recent first" source order,
  // but users can flip to price/shares to find outliers fast.
  const controls = useTableControls<
    InsiderTransaction,
    "date" | "shares" | "price" | "postTrade"
  >(transactions, {
    searchFields: (tx) => [tx.issuerName, tx.issuerTicker, tx.formType, tx.transactionCode],
    sorters: {
      date: (a, b) => {
        const ta = a.transactionDate
          ? new Date(a.transactionDate).getTime()
          : a.filingDate ? new Date(a.filingDate).getTime() : 0;
        const tb = b.transactionDate
          ? new Date(b.transactionDate).getTime()
          : b.filingDate ? new Date(b.filingDate).getTime() : 0;
        return ta - tb;
      },
      shares: (a, b) => (a.shares ?? 0) - (b.shares ?? 0),
      price: (a, b) => (a.pricePerShare ?? 0) - (b.pricePerShare ?? 0),
      postTrade: (a, b) => (a.sharesOwnedFollowing ?? 0) - (b.sharesOwnedFollowing ?? 0),
    },
  });
  // 25 per page — same rhythm as the holdings table above. Pagination
  // replaces the previous "showing 100 of N" cap so long histories
  // (multi-year Form 4 tapes on active insiders like Bezos, Musk) are
  // fully browsable instead of silently truncated.
  const pager = usePagination(controls.rows, 25);
  React.useEffect(() => {
    pager.setPage(1);
  }, [controls.query, controls.sort, pager.setPage]);
  if (transactions.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Recent transactions</CardTitle></CardHeader>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No non-derivative transactions parsed — but current holdings show
          above. Recent Form 4 activity was likely all derivative (option
          grants / vests / exercises) rather than open-market share trades.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader><CardTitle>Recent transactions ({transactions.length})</CardTitle></CardHeader>
      <TableToolbar
        controls={controls}
        placeholder={t("table.searchPlaceholder")}
        clearLabel={t("table.clearFilters")}
        formatMatchHint={(n, m) => t("table.matchHint", { visible: n, total: m })}
      />
      <div className="table-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[0.7rem] uppercase tracking-wider text-muted-foreground border-b border-border">
              <SortableTh controls={controls} sortKey="date" className="px-4 py-3 font-semibold" sortLabelPrefix={t("table.sortBy")}>Date</SortableTh>
              <th className="px-4 py-3 font-semibold">Form</th>
              <th className="px-4 py-3 font-semibold">Issuer</th>
              <th className="px-4 py-3 font-semibold">Action</th>
              <SortableTh controls={controls} sortKey="shares" className="px-4 py-3 font-semibold text-right" sortLabelPrefix={t("table.sortBy")}>Shares</SortableTh>
              <SortableTh controls={controls} sortKey="price" className="px-4 py-3 font-semibold text-right" sortLabelPrefix={t("table.sortBy")}>Price</SortableTh>
              <SortableTh controls={controls} sortKey="postTrade" className="px-4 py-3 font-semibold text-right" sortLabelPrefix={t("table.sortBy")}>Post-trade</SortableTh>
              <th className="px-4 py-3 font-semibold">Filing</th>
            </tr>
          </thead>
          <tbody>
            {pager.visibleItems.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {t("table.noMatches")}
                </td>
              </tr>
            ) : pager.visibleItems.map((tx, i) => (
              <InsiderTxRow key={`${tx.accessionNumber}-${pager.range[0] + i}`} t={tx} />
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={pager.page}
        pageCount={pager.pageCount}
        total={pager.total}
        range={pager.range}
        onPageChange={pager.setPage}
        pageSize={pager.pageSize}
        onPageSizeChange={pager.setPageSize}
        pageSizeOptions={[10, 25, 50, 100, 0]}
        pageSizeLabel={t("pager.pageSizeLabel")}
        allLabel={t("pager.all")}
        className="px-4 py-3 border-t border-border"
        label={t("pager.transactions")}
      />
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
        {((data.filingsNoStockRows ?? 0) > 0 || (data.filingsFetchFailed ?? 0) > 0) && (
          <div className="text-[0.7rem] text-muted-foreground mt-3 space-y-1.5">
            {(data.filingsNoStockRows ?? 0) > 0 && (
              <p className="border-l-2 border-primary/40 pl-2">
                <span className="text-foreground font-medium">
                  {data.filingsNoStockRows} filing
                  {data.filingsNoStockRows === 1 ? "" : "s"} parsed cleanly but
                  had no stock-ticker rows.
                </span>{" "}
                Almost always because the filing lists only bonds, mutual
                funds, options, or private-company holdings — none of which
                trade under an exchange ticker. Click the filing to see the
                original PDF; the trades are there, they just aren&#39;t
                individual equity positions we can chart.
              </p>
            )}
            {(data.filingsFetchFailed ?? 0) > 0 && (
              <p className="border-l-2 border-warning/40 pl-2">
                <span className="text-foreground font-medium">
                  {data.filingsFetchFailed} filing
                  {data.filingsFetchFailed === 1 ? "" : "s"} couldn&#39;t be
                  read automatically.
                </span>{" "}
                Usually a scanned or handwritten PDF, or a transient network
                error. Click any filing below to view the original — retry
                in a minute if it&#39;s the network.
              </p>
            )}
          </div>
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
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
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
                      </div>
                      <FilingStatusChip status={f.parseStatus} />
                    </div>
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
                <>
                  <iframe
                    key={selected.docId}
                    // Load the PDF via our same-origin proxy instead
                    // of hitting `disclosures-clerk.house.gov`
                    // directly. The upstream site sends
                    // `X-Frame-Options` / `frame-ancestors` headers
                    // that flat-out refuse cross-origin embedding,
                    // which is why the raw URL opens fine in a new
                    // tab but shows an error inside an <iframe>.
                    // `/api/portfolios/ptr-pdf` fetches the same PDF
                    // server-side and streams it back with iframe-
                    // friendly headers. The "Open PDF" link above
                    // still points at the original URL so deep-
                    // linkers / archivists get the source.
                    src={`/api/portfolios/ptr-pdf?year=${encodeURIComponent(
                      String(selected.year),
                    )}&docId=${encodeURIComponent(selected.docId)}`}
                    title={`PTR filing ${selected.docId}`}
                    className="w-full flex-1 min-h-[60vh] bg-white"
                  />
                  {/* Fallback hint. Some mobile browsers (notably
                      iOS Safari) refuse to render PDFs in an
                      <iframe> at all — they show a blank frame
                      with no error. Signposting the "Open PDF"
                      button here means those users don't sit
                      staring at a blank white area wondering
                      what went wrong. */}
                  <p className="px-4 py-1.5 text-[0.65rem] text-muted-foreground border-t border-border/60 text-center">
                    Preview not loading? Use{" "}
                    <a
                      href={selected.pdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-0.5"
                    >
                      Open PDF <ExternalLink className="h-2.5 w-2.5" />
                    </a>{" "}
                    to view the source file directly.
                  </p>
                </>
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

/**
 * Compact status chip rendered next to each filing button. Colour +
 * copy are chosen so the two "we couldn't chart this" states read
 * distinctly:
 *   ok           — trades parsed cleanly (no chip; the default state
 *                  is quiet so scanning down the list is easy)
 *   no_rows      — PDF read fine but held only non-equity positions;
 *                  clicking still shows the raw filing
 *   fetch_failed — real failure (scanned PDF / network); user should
 *                  fall back to the original PDF
 *   unparsed     — outside the parseLimit window, we didn't try
 */
function FilingStatusChip({ status }: { status: PoliticianFilingStatus | undefined }) {
  // Undefined status = older cached snapshot from before this feature
  // shipped, or a code path that constructs filings without going
  // through `fetchPoliticianTrades`. Rendering "not analysed" for
  // those would be misleading, so we stay silent — same as an "ok"
  // filing.
  if (!status || status === "ok") return null;
  const label =
    status === "no_rows"
      ? "no stock rows"
      : status === "fetch_failed"
        ? "unreadable"
        : "not analysed";
  const tone =
    status === "fetch_failed"
      ? "border-warning/40 text-warning"
      : "border-border text-muted-foreground";
  const tooltip =
    status === "no_rows"
      ? "PDF read cleanly but had no stock-ticker rows (bonds, mutual funds, options, or private holdings)."
      : status === "fetch_failed"
        ? "The PDF couldn't be fetched or scanned automatically. Open the PDF to view it directly."
        : "This filing sits outside the parse window — no analysis attempted.";
  return (
    <span
      title={tooltip}
      className={cn(
        "shrink-0 self-start rounded-full border px-1.5 py-[1px] text-[0.6rem] leading-tight",
        tone,
      )}
    >
      {label}
    </span>
  );
}

function PoliticianHoldingsCard({ holdings }: { holdings: PoliticianHolding[] }) {
  const t = useT();
  // Sort defaults come from the backend ("largest activity first"),
  // but users often want to flip to "biggest net" or "most recent"
  // to spot the interesting rows. Search over ticker + company for
  // the "did they touch AAPL?" query.
  const controls = useTableControls<
    PoliticianHolding,
    "buys" | "sells" | "net" | "lastTrade"
  >(holdings, {
    searchFields: (h) => [h.ticker, h.assetName],
    sorters: {
      buys: (a, b) => a.buyCount - b.buyCount,
      sells: (a, b) => a.sellCount - b.sellCount,
      // Net estimate is a range. Sort on the midpoint so a
      // definitively-positive position (both bounds > 0) ranks
      // above a straddling range, and a definitively-negative
      // one ranks last — the shape the user probably has in mind
      // when they click "Net estimate desc".
      net: (a, b) => {
        const midA = (a.netEstimateLow + a.netEstimateHigh) / 2;
        const midB = (b.netEstimateLow + b.netEstimateHigh) / 2;
        return midA - midB;
      },
      lastTrade: (a, b) => {
        const ta = a.lastTradeDate ? new Date(a.lastTradeDate).getTime() : 0;
        const tb = b.lastTradeDate ? new Date(b.lastTradeDate).getTime() : 0;
        return ta - tb;
      },
    },
  });
  // Politicians with hundreds of tickers touched (Nancy Pelosi, Dan
  // Crenshaw) benefit most from pagination — the previous silent 100-row
  // cap hid interesting long-tail positions.
  const pager = usePagination(controls.rows, 25);
  React.useEffect(() => {
    pager.setPage(1);
  }, [controls.query, controls.sort, pager.setPage]);
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
      <TableToolbar
        controls={controls}
        placeholder={t("table.searchPlaceholder")}
        clearLabel={t("table.clearFilters")}
        formatMatchHint={(n, m) => t("table.matchHint", { visible: n, total: m })}
      />
      <div className="table-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[0.7rem] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="px-4 py-3 font-semibold">Ticker</th>
              <th className="px-4 py-3 font-semibold">Company</th>
              <SortableTh controls={controls} sortKey="buys" className="px-4 py-3 font-semibold text-right" sortLabelPrefix={t("table.sortBy")}>Buys</SortableTh>
              <SortableTh controls={controls} sortKey="sells" className="px-4 py-3 font-semibold text-right" sortLabelPrefix={t("table.sortBy")}>Sells</SortableTh>
              <th className="px-4 py-3 font-semibold text-right">Bought (range)</th>
              <th className="px-4 py-3 font-semibold text-right">Sold (range)</th>
              <SortableTh controls={controls} sortKey="net" className="px-4 py-3 font-semibold text-right" sortLabelPrefix={t("table.sortBy")}>Net estimate</SortableTh>
              <SortableTh controls={controls} sortKey="lastTrade" className="px-4 py-3 font-semibold" sortLabelPrefix={t("table.sortBy")}>Last trade</SortableTh>
            </tr>
          </thead>
          <tbody>
            {pager.visibleItems.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {t("table.noMatches")}
                </td>
              </tr>
            ) : pager.visibleItems.map((h) => (
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
      <Pagination
        page={pager.page}
        pageCount={pager.pageCount}
        total={pager.total}
        range={pager.range}
        onPageChange={pager.setPage}
        pageSize={pager.pageSize}
        onPageSizeChange={pager.setPageSize}
        pageSizeOptions={[10, 25, 50, 100, 0]}
        pageSizeLabel={t("pager.pageSizeLabel")}
        allLabel={t("pager.all")}
        className="px-4 py-3 border-t border-border"
        label={t("pager.positions")}
      />
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
  const t = useT();
  // Trades default to "most recent first" from the backend. Sort
  // lets users flip to oldest-first or largest-amount-first.
  // Search matches on the asset name, ticker, and owner code so
  // "spouse trades" or "AAPL trades" narrow fast.
  const controls = useTableControls<PoliticianTrade, "date" | "amount">(trades, {
    searchFields: (tr) => [tr.assetName, tr.ticker, tr.ownerCode, tr.assetClass],
    sorters: {
      date: (a, b) => {
        const ta = a.transactionDate
          ? new Date(a.transactionDate).getTime()
          : a.filingDate ? new Date(a.filingDate).getTime() : 0;
        const tb = b.transactionDate
          ? new Date(b.transactionDate).getTime()
          : b.filingDate ? new Date(b.filingDate).getTime() : 0;
        return ta - tb;
      },
      // Trades disclose a bracket rather than a point amount. Use
      // the midpoint of the reported range as the sort key — the
      // same fiction the "Net estimate" column already uses.
      amount: (a, b) => {
        const midA = (a.amountLow + a.amountHigh) / 2;
        const midB = (b.amountLow + b.amountHigh) / 2;
        return midA - midB;
      },
    },
  });
  // 25 per page. Individual-trade tables can hit 200+ rows for a
  // 2-year window on active traders; the previous silent 200-row cap
  // would drop rows for a handful of extreme cases (Pelosi, Crenshaw).
  const pager = usePagination(controls.rows, 25);
  React.useEffect(() => {
    pager.setPage(1);
  }, [controls.query, controls.sort, pager.setPage]);
  if (trades.length === 0) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Individual trades ({trades.length})</CardTitle></CardHeader>
      <TableToolbar
        controls={controls}
        placeholder={t("table.searchPlaceholder")}
        clearLabel={t("table.clearFilters")}
        formatMatchHint={(n, m) => t("table.matchHint", { visible: n, total: m })}
      />
      <div className="table-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[0.7rem] uppercase tracking-wider text-muted-foreground border-b border-border">
              <SortableTh controls={controls} sortKey="date" className="px-4 py-3 font-semibold" sortLabelPrefix={t("table.sortBy")}>Date</SortableTh>
              <th className="px-4 py-3 font-semibold">Owner</th>
              <th className="px-4 py-3 font-semibold">Asset</th>
              <th className="px-4 py-3 font-semibold">Ticker</th>
              <th className="px-4 py-3 font-semibold">Action</th>
              <SortableTh controls={controls} sortKey="amount" className="px-4 py-3 font-semibold text-right" sortLabelPrefix={t("table.sortBy")}>Amount</SortableTh>
              <th className="px-4 py-3 font-semibold">Filing</th>
            </tr>
          </thead>
          <tbody>
            {pager.visibleItems.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {t("table.noMatches")}
                </td>
              </tr>
            ) : pager.visibleItems.map((t, i) => {
              const meta = t.action ? TRADE_ACTION_META[t.action] : null;
              return (
                <tr
                  key={`${t.filingDocId}-${t.ticker ?? "notk"}-${pager.range[0] + i}`}
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
      <Pagination
        page={pager.page}
        pageCount={pager.pageCount}
        total={pager.total}
        range={pager.range}
        onPageChange={pager.setPage}
        pageSize={pager.pageSize}
        onPageSizeChange={pager.setPageSize}
        pageSizeOptions={[10, 25, 50, 100, 0]}
        pageSizeLabel={t("pager.pageSizeLabel")}
        allLabel={t("pager.all")}
        className="px-4 py-3 border-t border-border"
        label={t("pager.trades")}
      />
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

  // 13F filings routinely list hundreds of positions (Berkshire is under
  // 100 but is the exception; most managers file 200-800 rows). Paginate
  // at 25 with the ranks preserved across pages so page 2 shows #26 →
  // #50 by portfolio weight.
  //
  // `useMemo` on the empty fallback so `usePagination` sees a stable
  // reference before `data` resolves — otherwise the hook would ping-
  // pong between two identity arrays on the first render.
  const emptyHoldings = React.useMemo(
    () => [] as Array<FundHolding & { portfolioRank: number }>,
    [],
  );
  // Freeze the portfolio-weight rank onto each holding once, so that
  // the "#" column keeps reporting "this is the #7 position by value"
  // even after the user sorts by shares or filters to "APH". Without
  // this the rank would silently mean "row index on the current
  // sorted/filtered view", which is nearly meaningless and would
  // reset numbering as the user typed.
  const rankedHoldings = React.useMemo(() => {
    if (!data) return emptyHoldings;
    // `data.holdings` is already sorted by value desc in the backend
    // (see `fetchFund13F`), so the incoming index IS the rank.
    return data.holdings.map((h, i) => ({ ...h, portfolioRank: i + 1 }));
  }, [data, emptyHoldings]);

  const controls = useTableControls<
    FundHolding & { portfolioRank: number },
    "shares" | "value" | "pct"
  >(rankedHoldings, {
    // Match on issuer, CUSIP, and the resolver-populated ticker
    // (see `lib/sec-ticker-map.ts`) so the user can search by any
    // of the three ways they might identify a position.
    searchFields: (h) => [h.issuer, h.cusip, h.resolvedTicker, h.titleOfClass],
    sorters: {
      shares: (a, b) => a.shares - b.shares,
      value: (a, b) => a.value - b.value,
      // `pctOfPortfolio` is nullable; sentinel-to-zero keeps the
      // sort stable rather than comparing NaN.
      pct: (a, b) => (a.pctOfPortfolio ?? 0) - (b.pctOfPortfolio ?? 0),
    },
  });
  const pager = usePagination(controls.rows, 25);
  React.useEffect(() => {
    pager.setPage(1);
  }, [controls.query, controls.sort, pager.setPage]);

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
          <TableToolbar
            controls={controls}
            placeholder={t("table.searchPlaceholder")}
            clearLabel={t("table.clearFilters")}
            formatMatchHint={(n, m) => t("table.matchHint", { visible: n, total: m })}
          />
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[0.7rem] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="px-4 py-3 font-semibold">#</th>
                  <th className="px-4 py-3 font-semibold">Issuer</th>
                  <th className="px-4 py-3 font-semibold">Class</th>
                  <SortableTh controls={controls} sortKey="shares" className="px-4 py-3 font-semibold text-right" sortLabelPrefix={t("table.sortBy")}>Shares</SortableTh>
                  <SortableTh controls={controls} sortKey="value" className="px-4 py-3 font-semibold text-right" sortLabelPrefix={t("table.sortBy")}>Value</SortableTh>
                  <SortableTh controls={controls} sortKey="pct" className="px-4 py-3 font-semibold text-right" sortLabelPrefix={t("table.sortBy")}>% of portfolio</SortableTh>
                  <th className="px-4 py-3 font-semibold">Put/Call</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pager.visibleItems.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      {t("table.noMatches")}
                    </td>
                  </tr>
                ) : pager.visibleItems.map((h) => (
                  // Ranks come from `portfolioRank` — the position
                  // in the ORIGINAL value-desc sort of the whole
                  // filing. Sort/search never changes this label
                  // because "this is the fund's 7th largest
                  // position" is a stable factual claim that
                  // shouldn't depend on how the user is currently
                  // browsing the list.
                  <HoldingRow key={`${h.cusip}-${h.portfolioRank}`} rank={h.portfolioRank} h={h} />
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={pager.page}
            pageCount={pager.pageCount}
            total={pager.total}
            range={pager.range}
            onPageChange={pager.setPage}
            pageSize={pager.pageSize}
            onPageSizeChange={pager.setPageSize}
            pageSizeOptions={[10, 25, 50, 100, 0]}
            pageSizeLabel={t("pager.pageSizeLabel")}
            allLabel={t("pager.all")}
            className="px-4 py-3 border-t border-border"
            label={t("pager.positions")}
          />
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
  // The 13F filing schema has no ticker column — SEC deliberately
  // publishes CUSIP + issuer name only, since CUSIPs are IP-protected
  // by CUSIP Global Services. `resolvedTicker` is a server-side
  // name-normalised lookup against SEC's company-tickers file (see
  // lib/sec-ticker-map.ts). When populated we can offer the standard
  // one-click add-to-watchlist / open-in-analysis flow; when it
  // isn't (foreign listings, private placements, unusual naming)
  // we fall back to the manual-ticker popover as before.
  const hasTicker = !!h.resolvedTicker;
  const ticker = h.resolvedTicker ?? "";
  return (
    <tr className="border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3 tabular-nums text-muted-foreground">{rank}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="font-medium truncate max-w-[16rem]" title={h.issuer}>
            {h.issuer || DASH}
          </div>
          {hasTicker && (
            <span
              className="chip chip-neu font-mono text-[0.65rem] px-1.5 py-0"
              title={
                h.resolvedExchange
                  ? `${ticker} · ${h.resolvedExchange}${
                      h.resolvedConfidence === "normalized"
                        ? " (matched by normalized name)"
                        : ""
                    }`
                  : ticker
              }
            >
              {ticker}
            </span>
          )}
        </div>
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
        {hasTicker ? (
          // Auto-resolved path: matches the politician-trades row
          // (see line ~514) so the whole app stays consistent —
          // "Add to watchlist" + "Watch this trade / open analysis"
          // side-by-side.
          <div className="inline-flex items-center gap-1.5">
            <AddToWatchlistButton symbol={ticker} displayName={h.issuer} />
            <WatchTradeButton
              kind="ticker"
              ticker={ticker}
              displayName={h.issuer}
            />
          </div>
        ) : (
          // Unresolved fallback: keep the Yahoo lookup and the
          // manual-entry popover so the user can still add the
          // symbol themselves. This is the pre-existing UX for
          // holdings we can't confidently map.
          <div className="inline-flex items-center gap-2">
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
            <AddIssuerToWatchlistButton issuerName={h.issuer} />
          </div>
        )}
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
  tone: "bull" | "bear" | "neu" | "warn";
}) {
  const border =
    tone === "bull" ? "border-l-success" :
    tone === "bear" ? "border-l-danger" :
    tone === "warn" ? "border-l-warning" :
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
