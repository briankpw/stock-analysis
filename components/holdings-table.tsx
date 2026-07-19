"use client";

/**
 * HoldingsTable — the "list down all the details" view.
 *
 * Renders every row from the imported CSV with rich filtering. This is
 * the *raw* view: no aggregation, no cost-basis math, no PnL. Each row
 * is either a portfolio-header watch entry (Type = —) or a Buy / Sell
 * transaction, and appears exactly as it was in the CSV plus a couple
 * of tiny UX affordances (colour-coded side chips, formatted numbers,
 * click-to-set-active-ticker).
 *
 * Filter controls above the table:
 *   • Search — matches Symbol OR Name (fuzzy substring).
 *   • Portfolio — narrows to a single broker/account.
 *   • Type — All / Buys / Sells / Watch entries.
 *   • Order — Newest first (default) or original CSV order.
 *
 * The table itself is horizontally scrollable at narrow widths so
 * every column stays legible on mobile without hiding data.
 */

import * as React from "react";
import { Search, ArrowUpDown, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { useHoldingsView } from "@/lib/holdings-state";
import { useUi } from "@/lib/state";
import { useT } from "@/lib/i18n";
import type { HoldingRow, HoldingType } from "@/lib/portfolio-import";
import { extractIsoDate } from "@/lib/portfolio-import";
import { cn } from "@/lib/utils";

type TypeFilter = "all" | "buy" | "sell" | "watch";
type SortMode = "newest" | "oldest" | "csv";

// ---------------------------------------------------------------------------
// Small formatting helpers — local to this file so we don't grow
// lib/format.ts with one-off currency/multi-decimal cases.
// ---------------------------------------------------------------------------

const DASH = "—";

function fmtMoney(v: number | null, decimals = 2): string {
  if (v === null || !Number.isFinite(v)) return DASH;
  return v.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Shares can be fractional (crypto, splits) — show up to 4 decimals but
 *  strip trailing zeros so `32.87` stays clean. */
function fmtShares(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return DASH;
  const s = v.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
  return s;
}

// ---------------------------------------------------------------------------
// The header row that fires the currently-visible cost/side computation
// ---------------------------------------------------------------------------

interface FilterState {
  search: string;
  portfolio: string; // "" = all
  type: TypeFilter;
  sort: SortMode;
}

function filterAndSort(rows: HoldingRow[], f: FilterState): HoldingRow[] {
  const q = f.search.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (f.portfolio && r.portfolio !== f.portfolio) return false;
    if (f.type === "buy" && r.type !== "Buy") return false;
    if (f.type === "sell" && r.type !== "Sell") return false;
    if (f.type === "watch" && r.type !== null) return false;
    if (q.length > 0) {
      const hay = `${r.symbol} ${r.name}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (f.sort === "csv") return filtered;

  // Order by ISO date+time; missing dates float to the bottom.
  const withKey = filtered.map((r) => {
    const iso = extractIsoDate(r.transactionDate);
    // ISO date + HH:mm:ss packs lexicographically into a sortable key.
    // Rows without a date get an empty key so they cluster together.
    const key = iso ? `${iso}T${r.transactionTime ?? "00:00:00"}` : "";
    return { r, key };
  });

  withKey.sort((a, b) => {
    // Rows without a date go last regardless of sort order.
    if (!a.key && !b.key) return 0;
    if (!a.key) return 1;
    if (!b.key) return -1;
    return f.sort === "newest" ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key);
  });
  return withKey.map((x) => x.r);
}

// ---------------------------------------------------------------------------
// Row rendering
// ---------------------------------------------------------------------------

function TypeChip({ type }: { type: HoldingType | null }) {
  const t = useT();
  if (type === null) {
    return (
      <span className="chip chip-neu text-[0.6rem]" title={t("myPortfolio.table.watchTooltip")}>
        {t("myPortfolio.table.watch")}
      </span>
    );
  }
  if (type === "Buy") {
    return (
      <span className="chip chip-bull text-[0.6rem]">
        {t("myPortfolio.table.buy")}
      </span>
    );
  }
  return (
    <span className="chip chip-bear text-[0.6rem]">
      {t("myPortfolio.table.sell")}
    </span>
  );
}

function SymbolCell({ symbol, name, currency }: { symbol: string; name: string; currency: string }) {
  const setTicker = useUi((s) => s.setTicker);
  // Left click on a symbol sets it as the active ticker so a user can
  // hop from "here's what I own" to the Charts / Signal pages without
  // re-typing. Doesn't navigate — deliberate: the user is inspecting
  // their portfolio, we shouldn't yank them away.
  return (
    <div className="flex flex-col min-w-0">
      <button
        type="button"
        onClick={() => setTicker(symbol)}
        className="text-left font-semibold hover:text-primary transition-colors truncate"
        title={`Set active ticker to ${symbol}`}
      >
        {symbol}
      </button>
      <span className="text-[0.65rem] text-muted-foreground truncate" title={name}>
        {name}
      </span>
      {currency && (
        <span className="text-[0.6rem] text-muted-foreground tabular-nums">
          {currency}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function HoldingsTable() {
  const t = useT();
  // Filtered view — same forex handling as the Positions tab so both
  // tabs stay consistent. See `useHoldingsView` for the split.
  const view = useHoldingsView();
  const rows = view.rows;

  const [filter, setFilter] = React.useState<FilterState>({
    search: "",
    portfolio: "",
    type: "all",
    sort: "newest",
  });

  const portfolios = React.useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) s.add(r.portfolio);
    return [...s].sort();
  }, [rows]);

  const visible = React.useMemo(() => filterAndSort(rows, filter), [rows, filter]);

  // Some broker CSV exports (MSP with free-trade brokers, most crypto
  // exports) never populate the Commission column. Rendering "—" in a
  // column that's *always* empty is pure clutter, so we detect the
  // empty case and hide the column entirely. Users whose imports DO
  // include commission still see it — no config knob needed.
  //
  // Checked against `rows` (the raw store) rather than `visible` (post-
  // filter) so applying a filter doesn't accidentally toggle the
  // column on/off between renders — the column layout should be
  // stable across filter changes.
  const hasCommissionData = React.useMemo(
    () => rows.some((r) => (r.commission ?? 0) > 0),
    [rows],
  );

  // Pagination — transactions lists can easily hit 1000+ rows on
  // long-lived brokerage accounts, and rendering that many <tr>s
  // strand the page below (uploader, KeyTerms) behind a marathon
  // scroll. Default 50/page is a reasonable dense-table sweet spot;
  // the `0` sentinel in `pageSizeOptions` preserves the old "All"
  // behaviour for anyone who wants it.
  const pager = usePagination(visible, 50);
  const setPage = pager.setPage;
  // Reset to page 1 on filter change — otherwise the user can end
  // up on a page that no longer exists in the new filter context
  // (the hook clamps overrun a render later, causing a brief flash
  // of "no rows here"). We don't reset on pageSize change because
  // `usePagination.setPageSize` already anchors the current top row.
  React.useEffect(() => {
    setPage(1);
  }, [filter, setPage]);

  return (
    <div className="space-y-4">
      {/* Filter controls
          The import-metadata bar (imported when, filename, row count,
          Clear button) lives one level up in `HoldingsMetaBar` so both
          the Positions tab and this Transactions tab share the same
          strip without duplicating it. */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="relative">
              <span className="sr-only">{t("myPortfolio.filter.searchLabel")}</span>
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                value={filter.search}
                onChange={(e) => setFilter({ ...filter, search: e.target.value })}
                placeholder={t("myPortfolio.filter.searchPlaceholder")}
                className="w-full h-9 rounded-md border border-border bg-card pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">
                {t("myPortfolio.filter.portfolio")}
              </span>
              <select
                value={filter.portfolio}
                onChange={(e) => setFilter({ ...filter, portfolio: e.target.value })}
                className="h-9 rounded-md border border-border bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">{t("myPortfolio.filter.allPortfolios")}</option>
                {portfolios.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">
                {t("myPortfolio.filter.type")}
              </span>
              <select
                value={filter.type}
                onChange={(e) => setFilter({ ...filter, type: e.target.value as TypeFilter })}
                className="h-9 rounded-md border border-border bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="all">{t("myPortfolio.filter.typeAll")}</option>
                <option value="buy">{t("myPortfolio.filter.typeBuy")}</option>
                <option value="sell">{t("myPortfolio.filter.typeSell")}</option>
                <option value="watch">{t("myPortfolio.filter.typeWatch")}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">
                {t("myPortfolio.filter.sort")}
              </span>
              <select
                value={filter.sort}
                onChange={(e) => setFilter({ ...filter, sort: e.target.value as SortMode })}
                className="h-9 rounded-md border border-border bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="newest">{t("myPortfolio.filter.sortNewest")}</option>
                <option value="oldest">{t("myPortfolio.filter.sortOldest")}</option>
                <option value="csv">{t("myPortfolio.filter.sortCsv")}</option>
              </select>
            </label>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground flex-wrap">
            <p>
              {t("myPortfolio.table.showing", {
                shown: visible.length,
                total: rows.length,
              })}
              {view.hideForex && view.forexRowCount > 0 && (
                <span
                  className="ml-1 opacity-70"
                  title={view.forexSymbols.join(", ")}
                >
                  {t("myPortfolio.table.forexHiddenNote", {
                    n: view.forexRowCount,
                  })}
                </span>
              )}
            </p>
            {(filter.search || filter.portfolio || filter.type !== "all") && (
              <button
                type="button"
                onClick={() =>
                  setFilter({ search: "", portfolio: "", type: "all", sort: filter.sort })
                }
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <RefreshCcw className="h-3 w-3" />
                {t("myPortfolio.filter.reset")}
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Details table */}
      {visible.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {rows.length === 0
              ? t("myPortfolio.table.emptyStore")
              : t("myPortfolio.table.emptyFilter")}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-[0.6rem] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">
                    {t("myPortfolio.col.symbol")}
                  </th>
                  <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">
                    {t("myPortfolio.col.portfolio")}
                  </th>
                  <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">
                    {t("myPortfolio.col.exchange")}
                  </th>
                  <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">
                    {t("myPortfolio.col.type")}
                  </th>
                  <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">
                    {t("myPortfolio.col.shares")}
                  </th>
                  <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">
                    {t("myPortfolio.col.cost")}
                  </th>
                  <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">
                    {t("myPortfolio.col.gross")}
                  </th>
                  {hasCommissionData && (
                    <th className="text-right px-3 py-2 font-semibold whitespace-nowrap">
                      {t("myPortfolio.col.commission")}
                    </th>
                  )}
                  <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <ArrowUpDown className="h-3 w-3" />
                      {t("myPortfolio.col.date")}
                    </span>
                  </th>
                  <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">
                    {t("myPortfolio.col.fx")}
                  </th>
                  <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">
                    {t("myPortfolio.col.accounting")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {pager.visibleItems.map((r) => {
                  const isMissing = r.type === null;
                  const gross =
                    r.shares !== null && r.costPerShare !== null
                      ? r.shares * r.costPerShare
                      : null;
                  return (
                    <tr
                      key={r.id}
                      className={cn(
                        "border-t border-border/40 hover:bg-muted/20 transition-colors",
                        isMissing && "opacity-70",
                      )}
                    >
                      <td className="px-3 py-2 max-w-[10rem]">
                        <SymbolCell symbol={r.symbol} name={r.name} currency={r.currency} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="chip chip-neu text-[0.6rem]">{r.portfolio}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {r.exchange || DASH}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <TypeChip type={r.type} />
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                        {fmtShares(r.shares)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                        {fmtMoney(r.costPerShare)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                        {fmtMoney(gross)}
                      </td>
                      {hasCommissionData && (
                        <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                          {fmtMoney(r.commission, 2)}
                        </td>
                      )}
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex flex-col leading-tight">
                          <span className="font-mono tabular-nums">
                            {extractIsoDate(r.transactionDate) ?? DASH}
                          </span>
                          {r.transactionTime && (
                            <span className="text-[0.6rem] text-muted-foreground font-mono tabular-nums">
                              {r.transactionTime}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {r.purchaseExchangeRate !== null
                          ? `${fmtMoney(r.purchaseExchangeRate, 4)}${r.purchaseExchangeCurrencies ? ` ${r.purchaseExchangeCurrencies}` : ""}`
                          : DASH}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {r.accounting || DASH}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Pagination footer for the transactions table. Only
              rendered when there are enough rows to actually be
              worth paging — a 20-transaction history doesn't need
              the chrome. First/Last chevrons come for free from
              `<Pagination>` now that they're on by default. */}
          {visible.length > 25 && (
            <div className="border-t border-border/60 px-3 py-2">
              <Pagination
                page={pager.page}
                pageCount={pager.pageCount}
                total={pager.total}
                range={pager.range}
                onPageChange={pager.setPage}
                pageSize={pager.pageSize}
                onPageSizeChange={pager.setPageSize}
                pageSizeOptions={[25, 50, 100, 200, 0]}
                pageSizeLabel={t("pager.pageSizeLabel")}
                allLabel={t("pager.all")}
                label={t("myPortfolio.pager.transactionsLabel")}
              />
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
