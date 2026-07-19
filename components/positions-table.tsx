"use client";

/**
 * PositionsTable — the "how much do I hold and how much am I making"
 * view. This is the grouped-by-stock rollup the user actually sees
 * first when they open /my-portfolio.
 *
 * For each (portfolio, symbol) pair we show:
 *   • Shares held (net)  — bought − sold
 *   • Avg cost / share   — weighted running-average
 *   • Live price + today's change (via /api/quotes)
 *   • Market value       — price × shares
 *   • Unrealized P&L     — (price − avgCost) × shares
 *   • Today's $ change   — (price − prevClose) × shares
 *   • Realized P&L       — profit already booked from past sells
 *   • Total P&L          — realized + unrealized
 *
 * Fully-closed positions (0 shares held) still appear at the bottom
 * with their realized P&L so users can see historical wins/losses.
 *
 * A grand-totals bar at the top rolls everything up **per currency**
 * — never across FX. Users with mixed USD / HKD portfolios see two
 * separate totals rather than a fake converted number.
 *
 * Live quotes auto-refresh every 60s while the tab is visible so
 * "today's change" stays fresh without a full page reload.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Search, RefreshCcw, Info, CircleDot, ChevronDown, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import { PortfolioWinnersLosers } from "@/components/portfolio-winners-losers";
import { useHoldingsView } from "@/lib/holdings-state";
import { useUi } from "@/lib/state";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  aggregatePositions,
  attachLiveQuotes,
  totalsByCurrency,
  uniqueOpenSymbols,
  type Position,
  type CurrencyTotals,
  type LiveQuote,
  type TradeEvent,
} from "@/lib/portfolio-aggregate";
import type { QuotesResponse } from "@/app/api/quotes/route";

// ---------------------------------------------------------------------------
// Number formatting — kept local so the rest of the app's formatters
// aren't retrofitted with mixed-currency signed-percent quirks.
// ---------------------------------------------------------------------------

const DASH = "—";

/**
 * Locale-agnostic money format. Portfolio numbers can be huge or tiny
 * (a $12,000 position beside a $0.42 penny stock) so we always show 2
 * decimals for prices and P&L, but shares get variable precision.
 */
function fmtMoney(v: number | null, opts?: { signed?: boolean }): string {
  if (v === null || !Number.isFinite(v)) return DASH;
  const abs = Math.abs(v);
  const s = abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (opts?.signed) return `${v > 0 ? "+" : v < 0 ? "-" : ""}${s}`;
  return v < 0 ? `-${s}` : s;
}

function fmtShares(v: number): string {
  if (!Number.isFinite(v)) return DASH;
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function fmtPct(v: number | null, opts?: { signed?: boolean }): string {
  if (v === null || !Number.isFinite(v)) return DASH;
  const pct = v * 100;
  const abs = Math.abs(pct);
  const s = abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const suffix = "%";
  if (opts?.signed) return `${pct > 0 ? "+" : pct < 0 ? "-" : ""}${s}${suffix}`;
  return pct < 0 ? `-${s}${suffix}` : `${s}${suffix}`;
}

/**
 * Pick a text colour class for a signed P&L value.
 *   null      → muted    (data missing)
 *   zero      → foreground (flat)
 *   positive  → success
 *   negative  → danger
 */
function pnlTone(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "text-muted-foreground";
  if (v > 0) return "text-success";
  if (v < 0) return "text-danger";
  return "text-foreground";
}

// ---------------------------------------------------------------------------
// Live-quote hook — batched fetch + 60s auto-refresh
// ---------------------------------------------------------------------------

interface QuotesState {
  bySymbol: Record<string, LiveQuote>;
  loading: boolean;
  error: string | null;
  fetchedAt: string | null;
  rateLimited: boolean;
}

/**
 * Fetch live quotes for a set of symbols. Debounces list changes and
 * auto-refreshes every `intervalMs` while the tab is visible.
 *
 * Kept intentionally minimal (no SWR / react-query dep) — the batch
 * endpoint already de-dupes upstream, so a tiny in-hook cache is
 * enough. Callers just pass `symbols` and read `bySymbol`.
 */
function useLiveQuotes(symbols: string[], intervalMs = 60_000): QuotesState & { reload: () => void } {
  const [state, setState] = React.useState<QuotesState>({
    bySymbol: {},
    loading: symbols.length > 0,
    error: null,
    fetchedAt: null,
    rateLimited: false,
  });
  const [nonce, setNonce] = React.useState(0);
  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  // Serialize the list so effect only reruns on real changes.
  const key = symbols.join(",");

  React.useEffect(() => {
    if (!key) {
      setState({
        bySymbol: {},
        loading: false,
        error: null,
        fetchedAt: null,
        rateLimited: false,
      });
      return;
    }

    let cancelled = false;
    const run = async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const res = await fetch(
          `/api/quotes?tickers=${encodeURIComponent(key)}${nonce > 0 ? `&_=${nonce}` : ""}`,
          { cache: "no-store" },
        );
        const body: QuotesResponse | { error?: string } = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`;
          setState((s) => ({ ...s, loading: false, error: msg }));
          return;
        }
        const parsed = body as QuotesResponse;
        const bySymbol: Record<string, LiveQuote> = {};
        for (const q of parsed.quotes) {
          if (q.status === "ok") {
            bySymbol[q.ticker] = { price: q.price, previousClose: q.previousClose };
          }
        }
        setState({
          bySymbol,
          loading: false,
          error: null,
          fetchedAt: parsed.fetchedAt,
          rateLimited: parsed.rateLimited,
        });
      } catch (e) {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        }));
      }
    };

    void run();
    // Auto-refresh — but only when the tab is visible so background
    // tabs don't burn through Yahoo's rate limit.
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setNonce((n) => n + 1);
    }, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [key, nonce, intervalMs]);

  return { ...state, reload };
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

/**
 * Highlighted stat block for the top totals bar. Colour comes from the
 * caller so we can bake in "positive = green / negative = red" without
 * a giant tone lookup per stat.
 */
function TotalTile({
  label,
  value,
  sub,
  tone,
  currency,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: string;
  currency?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/60 px-3 py-2.5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.6rem] uppercase tracking-wider text-muted-foreground truncate">
          {label}
        </p>
        {currency && (
          <span className="text-[0.55rem] font-mono text-muted-foreground/70 shrink-0">
            {currency}
          </span>
        )}
      </div>
      <p className={cn("text-lg font-bold tabular-nums mt-0.5 truncate", tone)}>
        {value}
      </p>
      {sub && (
        <p className="text-[0.65rem] text-muted-foreground truncate mt-0.5">
          {sub}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grand totals — per-currency bar at the top
// ---------------------------------------------------------------------------

function CurrencyTotalsBar({ totals }: { totals: CurrencyTotals[] }) {
  const t = useT();

  if (totals.length === 0) return null;

  return (
    <div className="space-y-3">
      {totals.map((b) => (
        <Card key={b.currency}>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="chip chip-neu text-[0.65rem] font-mono">
                  {b.currency}
                </span>
                <p className="text-xs text-muted-foreground">
                  {t("myPortfolio.summary.positionsSummary", {
                    open: b.openPositions,
                    closed: b.closedPositions,
                  })}
                </p>
              </div>
            </div>
            {/* When the imported CSV has no commission data for this
                currency (common for MSP users on free-trade brokers),
                the "Commissions" tile is nothing but a zero value and
                pure clutter. Suppress it and shrink the grid to 5
                columns so the remaining tiles stay evenly sized. */}
            {(() => {
              const showCommissions = b.commissions !== 0;
              return (
                <div
                  className={cn(
                    "grid grid-cols-2 sm:grid-cols-3 gap-2",
                    showCommissions ? "lg:grid-cols-6" : "lg:grid-cols-5",
                  )}
                >
                  <TotalTile
                    label={t("myPortfolio.summary.marketValue")}
                    value={fmtMoney(b.marketValue)}
                    sub={t("myPortfolio.summary.investedSub", { v: fmtMoney(b.invested) })}
                  />
                  <TotalTile
                    label={t("myPortfolio.summary.dayChange")}
                    value={fmtMoney(b.dayChange, { signed: true })}
                    sub={fmtPct(b.dayChangePct, { signed: true })}
                    tone={pnlTone(b.dayChange)}
                  />
                  <TotalTile
                    label={t("myPortfolio.summary.unrealized")}
                    value={fmtMoney(b.unrealizedPnl, { signed: true })}
                    tone={pnlTone(b.unrealizedPnl)}
                  />
                  <TotalTile
                    label={t("myPortfolio.summary.realized")}
                    value={fmtMoney(b.realizedPnl, { signed: true })}
                    tone={pnlTone(b.realizedPnl)}
                  />
                  <TotalTile
                    label={t("myPortfolio.summary.totalPnl")}
                    value={fmtMoney(b.totalPnl, { signed: true })}
                    tone={pnlTone(b.totalPnl)}
                  />
                  {showCommissions && (
                    <TotalTile
                      label={t("myPortfolio.summary.commissions")}
                      value={fmtMoney(b.commissions)}
                      sub={t("myPortfolio.summary.commissionsSub")}
                    />
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-position row — the meat of the table
// ---------------------------------------------------------------------------

/**
 * Positions card = a collapsible container. The header is the summary
 * row (shares, cost, live P&L). Clicking anywhere on the header (or
 * pressing Enter / Space when focused) toggles a drilldown panel that
 * shows the trade timeline underneath.
 *
 * Clicking the ticker symbol itself is captured as a nested button so
 * it can call `setTicker` without also toggling the row — a small
 * `stopPropagation` keeps the two intents separate.
 */
function PositionRow({
  position,
  onSelectTicker,
  active,
  expanded,
  onToggle,
}: {
  position: Position;
  onSelectTicker: (symbol: string) => void;
  active: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  const p = position;

  const closed = p.netShares <= 0 && p.boughtShares > 0;
  const watchOnly = p.buyCount === 0 && p.sellCount === 0;

  const drilldownId = `pos-drill-${p.portfolio}-${p.symbol}`.replace(/\s+/g, "-");

  return (
    <div
      className={cn(
        "rounded-lg border transition-colors overflow-hidden",
        active
          ? "border-primary/60 bg-primary/5"
          : expanded
            ? "border-primary/40 bg-muted/20"
            : "border-border bg-card/40 hover:border-primary/40 hover:bg-muted/30",
      )}
    >
      {/* Summary header — clickable row. Kept as a div (not a
          <button>) so the ticker button below can nest cleanly
          without an interactive-in-interactive HTML5 violation.
          Keyboard support is added manually via `role="button"`,
          `tabIndex={0}`, and an Enter/Space keydown handler. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={expanded}
        aria-controls={drilldownId}
        className="grid grid-cols-12 gap-2 items-center px-3 py-2.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
      >
        {/* Symbol + name + chevron (5 cols) */}
        <div className="col-span-12 sm:col-span-5 lg:col-span-4 min-w-0">
          <div className="flex items-start gap-2 min-w-0">
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground mt-0.5 shrink-0 transition-transform",
                expanded && "rotate-180",
              )}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                {/* Real <button> for the ticker action so it stays
                    keyboard-focusable and screen-reader-friendly.
                    `stopPropagation` prevents the row toggle from
                    firing on the same click / Enter. */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectTicker(p.symbol);
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="font-mono font-semibold text-sm truncate hover:text-primary focus-visible:outline-none focus-visible:text-primary underline decoration-transparent hover:decoration-primary/50 underline-offset-2 cursor-pointer bg-transparent p-0 border-0"
                  title={t("myPortfolio.pos.viewInsights")}
                >
                  {p.displaySymbol ?? p.symbol}
                </button>
                {/* Watchlist add — the button's own onClick calls
                    `stopPropagation` so tapping "+" doesn't also toggle
                    the row drilldown. Wrapping in a keydown-stop makes
                    keyboard focus behave identically. */}
                <span
                  onKeyDown={(e) => e.stopPropagation()}
                  className="shrink-0"
                >
                  <AddToWatchlistButton
                    symbol={p.symbol}
                    displayName={p.name || p.symbol}
                  />
                </span>
                {closed && (
                  <span className="chip chip-neu text-[0.55rem] px-1.5 py-0 shrink-0">
                    {t("myPortfolio.pos.closed")}
                  </span>
                )}
                {watchOnly && (
                  <span className="chip chip-neu text-[0.55rem] px-1.5 py-0 shrink-0">
                    {t("myPortfolio.pos.watch")}
                  </span>
                )}
                <span className="text-[0.55rem] font-mono text-muted-foreground/70 shrink-0">
                  {p.currency}
                </span>
              </div>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {p.name}
              </p>
              <p className="text-[0.6rem] text-muted-foreground/70 truncate mt-0.5">
                <span className="opacity-70">{p.portfolio}</span>
                {" · "}
                {t("myPortfolio.pos.tradeSummary", {
                  buys: p.buyCount,
                  sells: p.sellCount,
                })}
              </p>
            </div>
          </div>
        </div>

        {/* Shares + avg cost (2 cols) */}
        <div className="col-span-6 sm:col-span-3 lg:col-span-2 min-w-0">
          <p className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">
            {t("myPortfolio.pos.holding")}
          </p>
          <p className="text-sm font-semibold tabular-nums truncate">
            {p.netShares > 0 ? fmtShares(p.netShares) : DASH}
          </p>
          <p className="text-[0.65rem] text-muted-foreground tabular-nums truncate">
            {p.avgCost != null
              ? t("myPortfolio.pos.avgCost", { v: fmtMoney(p.avgCost) })
              : DASH}
          </p>
        </div>

        {/* Live price + today's change (2 cols) */}
        <div className="col-span-6 sm:col-span-4 lg:col-span-2 min-w-0">
          <p className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">
            {t("myPortfolio.pos.priceToday")}
          </p>
          <p className="text-sm font-semibold tabular-nums truncate">
            {fmtMoney(p.price)}
          </p>
          <p className={cn("text-[0.65rem] tabular-nums truncate", pnlTone(p.dayChange))}>
            {p.dayChange !== null ? (
              <>
                {fmtMoney(p.dayChange, { signed: true })}
                <span className="opacity-70 ml-1">
                  ({fmtPct(p.dayChangePct, { signed: true })})
                </span>
              </>
            ) : (
              DASH
            )}
          </p>
        </div>

        {/* Market value + unrealized (2 cols) */}
        <div className="col-span-6 sm:col-span-6 lg:col-span-2 min-w-0">
          <p className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">
            {t("myPortfolio.pos.marketValue")}
          </p>
          <p className="text-sm font-semibold tabular-nums truncate">
            {fmtMoney(p.marketValue)}
          </p>
          <p className={cn("text-[0.65rem] tabular-nums truncate", pnlTone(p.unrealizedPnl))}>
            {p.unrealizedPnl !== null ? (
              <>
                {fmtMoney(p.unrealizedPnl, { signed: true })}
                <span className="opacity-70 ml-1">
                  ({fmtPct(p.unrealizedPnlPct, { signed: true })})
                </span>
              </>
            ) : (
              DASH
            )}
          </p>
        </div>

        {/* Realized + total P&L (2 cols) */}
        <div className="col-span-6 sm:col-span-6 lg:col-span-2 min-w-0">
          <p className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">
            {t("myPortfolio.pos.pnl")}
          </p>
          <p className={cn("text-sm font-semibold tabular-nums truncate", pnlTone(p.realizedPnl))}>
            {p.realizedPnl !== 0
              ? fmtMoney(p.realizedPnl, { signed: true })
              : DASH}
            <span className="text-[0.55rem] text-muted-foreground ml-1 font-normal">
              {t("myPortfolio.pos.realizedTag")}
            </span>
          </p>
          <p className={cn("text-[0.65rem] tabular-nums truncate", pnlTone(p.totalPnl))}>
            {p.totalPnl !== null
              ? t("myPortfolio.pos.totalTag", {
                  v: fmtMoney(p.totalPnl, { signed: true }),
                })
              : DASH}
          </p>
        </div>
      </div>

      {/* Drilldown panel — only rendered when expanded so we don't
          waste DOM on the (many) collapsed rows. */}
      {expanded && (
        <div
          id={drilldownId}
          className="border-t border-border/60 bg-card/20 animate-fade-in"
        >
          <PositionDrilldown position={p} onSelectTicker={onSelectTicker} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Position drilldown — the "how many shares did I buy at what price and
// when" breakdown that appears below an expanded row.
// ---------------------------------------------------------------------------

function TypeChip({ type }: { type: TradeEvent["type"] }) {
  const t = useT();
  if (type === "Buy") {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider bg-success/15 text-success">
        {t("myPortfolio.table.buy")}
      </span>
    );
  }
  if (type === "Sell") {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider bg-danger/15 text-danger">
        {t("myPortfolio.table.sell")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider bg-muted/40 text-muted-foreground">
      {t("myPortfolio.table.watch")}
    </span>
  );
}

/**
 * Small pill next to a Buy row's TypeChip showing whether the FIFO
 * lot opened by that buy is still open, partially drained by later
 * sells, or fully closed. Uses subtle borders/backgrounds so the
 * chip reads as a status indicator rather than as another action.
 *
 * The three states map to different colour tones:
 *   • open    → primary/blue tint  (nothing sold yet)
 *   • partial → warning/amber tint (some sold, some still held)
 *   • closed  → muted/grey tint    (all shares from this buy sold)
 */
function LotStatusChip({ status }: { status: "open" | "partial" | "closed" }) {
  const t = useT();
  const label = t(`myPortfolio.drill.lotStatus.${status}`);
  const tone =
    status === "open"
      ? "border-primary/30 bg-primary/10 text-primary"
      : status === "partial"
        ? "border-warning/30 bg-warning/10 text-warning"
        : "border-border bg-muted/40 text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-[1px] text-[0.55rem] font-medium uppercase tracking-wider",
        tone,
      )}
      title={t(`myPortfolio.drill.lotStatus.${status}Tooltip`)}
    >
      {label}
    </span>
  );
}

/**
 * Extract the date portion of the raw MSP timestamp (`YYYY-MM-DD
 * GMT+ZZZZ` → `YYYY-MM-DD`) for compact display. Falls back to the
 * raw string when the format doesn't match so no data is lost.
 */
function tradeDateLabel(row: TradeEvent["row"]): string {
  const raw = row.transactionDate ?? "";
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  const date = m ? m[1] : raw || DASH;
  const time = row.transactionTime;
  return time ? `${date} ${time}` : date;
}

function PositionDrilldown({
  position,
  onSelectTicker,
}: {
  position: Position;
  onSelectTicker: (symbol: string) => void;
}) {
  const t = useT();
  const p = position;
  // Auto-hide the Commission column + mobile row when this position
  // has no commission on any trade. Same condition used above for the
  // Commission snapshot tile, so the two never disagree.
  const showCommission = p.totalCommission > 0;

  // Newest trade first — matches the "recent activity" mental model
  // (users usually want to see their last trade at a glance). The
  // running-state columns are still meaningful because each row shows
  // the state *after* that trade was applied — the top row therefore
  // reflects the current running state.
  const timeline = React.useMemo(() => [...p.trades].reverse(), [p.trades]);

  return (
    <div className="p-4 space-y-4">
      {/* Position snapshot — the numbers that stay true regardless of
          per-trade detail (bought/sold, total invested, commissions,
          date range). Denominated in the stock's own currency.

          Commission tile is auto-hidden when this position has no
          commission on any trade (broker's a free-trade shop, or the
          CSV export just doesn't carry the column). When hidden, the
          date-range info that used to ride on the commission tile's
          sub-line moves to `totalProceeds` so we don't lose it. */}
      {(() => {
        // `showCommission` is hoisted to the component scope (used
        // below by the timeline table + mobile cards too); reuse it
        // here so the whole drilldown makes the same decision.
        const dateRangeSub =
          p.firstTradeDate && p.lastTradeDate
            ? t("myPortfolio.drill.dateRange", {
                from: (p.firstTradeDate.match(/^(\d{4}-\d{2}-\d{2})/) ?? [p.firstTradeDate])[0],
                to: (p.lastTradeDate.match(/^(\d{4}-\d{2}-\d{2})/) ?? [p.lastTradeDate])[0],
              })
            : null;
        return (
          <div
            className={cn(
              "grid grid-cols-2 sm:grid-cols-3 gap-2",
              showCommission ? "lg:grid-cols-6" : "lg:grid-cols-5",
            )}
          >
            <SnapshotTile
              label={t("myPortfolio.drill.bought")}
              value={p.boughtShares > 0 ? fmtShares(p.boughtShares) : DASH}
              sub={t("myPortfolio.drill.buyCount", { n: p.buyCount })}
            />
            <SnapshotTile
              label={t("myPortfolio.drill.sold")}
              value={p.soldShares > 0 ? fmtShares(p.soldShares) : DASH}
              sub={t("myPortfolio.drill.sellCount", { n: p.sellCount })}
            />
            <SnapshotTile
              label={t("myPortfolio.drill.netHeld")}
              value={p.netShares > 0 ? fmtShares(p.netShares) : DASH}
              sub={
                p.avgCost != null
                  ? t("myPortfolio.pos.avgCost", { v: `${fmtMoney(p.avgCost)} ${p.currency}` })
                  : t("myPortfolio.drill.flat")
              }
            />
            <SnapshotTile
              label={t("myPortfolio.drill.totalInvested")}
              value={fmtMoney(p.totalInvested)}
              sub={p.currency}
            />
            <SnapshotTile
              label={t("myPortfolio.drill.totalProceeds")}
              value={fmtMoney(p.totalProceeds)}
              // Absorb the date range here when the commission tile
              // (its usual home) is suppressed, so users never lose
              // the "traded from X to Y" context. Falls back to just
              // the currency when we have no trades at all.
              sub={
                !showCommission && dateRangeSub
                  ? `${p.currency} · ${dateRangeSub}`
                  : p.currency
              }
            />
            {showCommission && (
              <SnapshotTile
                label={t("myPortfolio.drill.commissions")}
                value={fmtMoney(p.totalCommission)}
                sub={dateRangeSub ?? undefined}
              />
            )}
          </div>
        );
      })()}

      {/* Trade timeline — the "trade-by-trade" list, most recent
          first. Renders as a table on md+ (best density for cross-
          column comparison) and stacks into cards on mobile so wide
          columns don't cause horizontal scroll pain. */}
      {timeline.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">
          {t("myPortfolio.drill.noTrades")}
        </p>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <p className="text-[0.7rem] uppercase tracking-wider text-muted-foreground">
              {t("myPortfolio.drill.timelineTitle")}
            </p>
            <button
              type="button"
              onClick={() => onSelectTicker(p.symbol)}
              className="inline-flex items-center gap-1 text-[0.7rem] text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            >
              {t("myPortfolio.drill.openInAnalysis", {
                symbol: p.displaySymbol ?? p.symbol,
              })}
              <ExternalLink className="h-3 w-3" />
            </button>
          </div>

          {/* Desktop / tablet: a real <table> for scannability. */}
          <div className="hidden md:block overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-muted-foreground">
                <tr>
                  <th className="text-left px-2.5 py-1.5 font-medium">
                    {t("myPortfolio.drill.col.date")}
                  </th>
                  <th className="text-left px-2.5 py-1.5 font-medium">
                    {t("myPortfolio.drill.col.type")}
                  </th>
                  <th className="text-right px-2.5 py-1.5 font-medium">
                    {t("myPortfolio.drill.col.shares")}
                  </th>
                  <th className="text-right px-2.5 py-1.5 font-medium">
                    {t("myPortfolio.drill.col.price")}
                  </th>
                  {showCommission && (
                    <th className="text-right px-2.5 py-1.5 font-medium">
                      {t("myPortfolio.drill.col.commission")}
                    </th>
                  )}
                  <th className="text-right px-2.5 py-1.5 font-medium">
                    {t("myPortfolio.drill.col.cashFlow")}
                  </th>
                  <th
                    className="text-right px-2.5 py-1.5 font-medium border-l border-border/60"
                    title={t("myPortfolio.drill.col.afterHint")}
                  >
                    {t("myPortfolio.drill.col.afterShares")}
                  </th>
                  <th
                    className="text-right px-2.5 py-1.5 font-medium"
                    title={t("myPortfolio.drill.col.afterHint")}
                  >
                    {t("myPortfolio.drill.col.afterAvg")}
                  </th>
                  {/* Two P&L lenses side-by-side.

                      Realized on a Buy row shows FIFO-lot P&L: the
                      profit later sells extracted from *this specific
                      buy lot*. Sells still show their own realized
                      (weighted-avg vs. running basis at time of sell).

                      Unrealized on a Buy row shows the mark-to-market
                      on shares from *this lot* that are still held.
                      Sells (fully closed by definition) show DASH. */}
                  <th
                    className="text-right px-2.5 py-1.5 font-medium border-l border-border/60"
                    title={t("myPortfolio.drill.col.unrealizedHint")}
                  >
                    {t("myPortfolio.drill.col.unrealized")}
                  </th>
                  <th
                    className="text-right px-2.5 py-1.5 font-medium"
                    title={t("myPortfolio.drill.col.realizedHint")}
                  >
                    {t("myPortfolio.drill.col.realized")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {timeline.map((ev, idx) => {
                  // Lot-level unrealized: only meaningful on Buy rows
                  // with live-price data AND shares still open. All
                  // other cases render as DASH.
                  const lotUnrealized =
                    ev.type === "Buy" &&
                    p.price != null &&
                    ev.lotCostPerShare != null &&
                    ev.lotSharesRemaining != null &&
                    ev.lotSharesRemaining > 1e-9
                      ? (p.price - ev.lotCostPerShare) * ev.lotSharesRemaining
                      : null;
                  // Lot-level realized: on Buy rows, sum of FIFO
                  // attributions from later sells. On Sell rows, keep
                  // the sell's own realizedPnl (cash-flow truth).
                  const lotRealized =
                    ev.type === "Buy"
                      ? ev.lotRealizedPnl
                      : ev.realizedPnl !== 0
                        ? ev.realizedPnl
                        : null;
                  return (
                    <tr
                      key={`${ev.row.id}-${idx}`}
                      className={cn(
                        "border-t border-border/50",
                        ev.type === "Buy" && "bg-success/5",
                        ev.type === "Sell" && "bg-danger/5",
                      )}
                    >
                      <td className="px-2.5 py-1.5 whitespace-nowrap font-mono tabular-nums text-[0.7rem]">
                        {tradeDateLabel(ev.row)}
                      </td>
                      <td className="px-2.5 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <TypeChip type={ev.type} />
                          {ev.type === "Buy" && ev.lotStatus && (
                            <LotStatusChip status={ev.lotStatus} />
                          )}
                        </div>
                      </td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">
                        {ev.shares != null ? fmtShares(ev.shares) : DASH}
                      </td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">
                        {fmtMoney(ev.price)}
                      </td>
                      {showCommission && (
                        <td className="px-2.5 py-1.5 text-right tabular-nums text-muted-foreground">
                          {ev.commission > 0 ? fmtMoney(ev.commission) : DASH}
                        </td>
                      )}
                      <td
                        className={cn(
                          "px-2.5 py-1.5 text-right tabular-nums",
                          pnlTone(ev.cashFlow),
                        )}
                      >
                        {fmtMoney(ev.cashFlow, { signed: true })}
                      </td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums font-medium border-l border-border/60">
                        {ev.runningShares > 0 ? fmtShares(ev.runningShares) : DASH}
                      </td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums font-medium">
                        {ev.runningAvgCost != null ? fmtMoney(ev.runningAvgCost) : DASH}
                      </td>
                      <td
                        className={cn(
                          "px-2.5 py-1.5 text-right tabular-nums border-l border-border/60",
                          pnlTone(lotUnrealized),
                        )}
                        title={
                          ev.type === "Buy" && ev.lotSharesRemaining != null
                            ? t("myPortfolio.drill.col.unrealizedTooltip", {
                                shares: fmtShares(ev.lotSharesRemaining),
                                cost:
                                  ev.lotCostPerShare != null
                                    ? fmtMoney(ev.lotCostPerShare)
                                    : DASH,
                              })
                            : undefined
                        }
                      >
                        {lotUnrealized != null
                          ? fmtMoney(lotUnrealized, { signed: true })
                          : DASH}
                      </td>
                      <td
                        className={cn(
                          "px-2.5 py-1.5 text-right tabular-nums font-medium",
                          pnlTone(lotRealized),
                        )}
                        title={
                          ev.type === "Buy" && ev.lotSharesSold != null && ev.lotSharesSold > 1e-9
                            ? t("myPortfolio.drill.col.realizedTooltip", {
                                sold: fmtShares(ev.lotSharesSold),
                                original:
                                  ev.lotOriginalShares != null
                                    ? fmtShares(ev.lotOriginalShares)
                                    : DASH,
                              })
                            : undefined
                        }
                      >
                        {lotRealized != null
                          ? fmtMoney(lotRealized, { signed: true })
                          : DASH}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: stacked cards so no horizontal scroll. */}
          <div className="md:hidden space-y-2">
            {timeline.map((ev, idx) => {
              const lotUnrealized =
                ev.type === "Buy" &&
                p.price != null &&
                ev.lotCostPerShare != null &&
                ev.lotSharesRemaining != null &&
                ev.lotSharesRemaining > 1e-9
                  ? (p.price - ev.lotCostPerShare) * ev.lotSharesRemaining
                  : null;
              const lotRealized =
                ev.type === "Buy"
                  ? ev.lotRealizedPnl
                  : ev.realizedPnl !== 0
                    ? ev.realizedPnl
                    : null;
              return (
                <div
                  key={`${ev.row.id}-${idx}`}
                  className={cn(
                    "rounded-md border p-2.5",
                    ev.type === "Buy"
                      ? "border-success/30 bg-success/5"
                      : ev.type === "Sell"
                        ? "border-danger/30 bg-danger/5"
                        : "border-border bg-card/50",
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <TypeChip type={ev.type} />
                        {ev.type === "Buy" && ev.lotStatus && (
                          <LotStatusChip status={ev.lotStatus} />
                        )}
                      </div>
                      <p className="text-[0.7rem] text-muted-foreground mt-0.5 font-mono tabular-nums truncate">
                        {tradeDateLabel(ev.row)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={cn("text-sm font-semibold tabular-nums", pnlTone(ev.cashFlow))}>
                        {fmtMoney(ev.cashFlow, { signed: true })}
                      </p>
                      <p className="text-[0.6rem] text-muted-foreground">
                        {p.currency}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[0.7rem] tabular-nums">
                    <p>
                      <span className="text-muted-foreground">{t("myPortfolio.drill.col.shares")}: </span>
                      {ev.shares != null ? fmtShares(ev.shares) : DASH}
                      <span className="text-muted-foreground"> @ {fmtMoney(ev.price)}</span>
                    </p>
                    {showCommission && (
                      <p>
                        <span className="text-muted-foreground">{t("myPortfolio.drill.col.commission")}: </span>
                        {ev.commission > 0 ? fmtMoney(ev.commission) : DASH}
                      </p>
                    )}
                    <p>
                      <span className="text-muted-foreground">{t("myPortfolio.drill.col.afterShares")}: </span>
                      <span className="font-medium">
                        {ev.runningShares > 0 ? fmtShares(ev.runningShares) : DASH}
                      </span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">{t("myPortfolio.drill.col.afterAvg")}: </span>
                      <span className="font-medium">
                        {ev.runningAvgCost != null ? fmtMoney(ev.runningAvgCost) : DASH}
                      </span>
                    </p>
                    {lotUnrealized != null && (
                      <p>
                        <span className="text-muted-foreground">
                          {t("myPortfolio.drill.col.unrealized")}:{" "}
                        </span>
                        <span className={cn("font-semibold", pnlTone(lotUnrealized))}>
                          {fmtMoney(lotUnrealized, { signed: true })}
                        </span>
                      </p>
                    )}
                    {lotRealized != null && lotRealized !== 0 && (
                      <p>
                        <span className="text-muted-foreground">
                          {t("myPortfolio.drill.col.realized")}:{" "}
                        </span>
                        <span className={cn("font-semibold", pnlTone(lotRealized))}>
                          {fmtMoney(lotRealized, { signed: true })}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-[0.65rem] text-muted-foreground mt-2 flex items-start gap-1">
            <Info className="h-3 w-3 shrink-0 mt-0.5" />
            {t("myPortfolio.drill.timelineFootnote")}
          </p>
          <p className="text-[0.65rem] text-muted-foreground mt-1 flex items-start gap-1">
            <Info className="h-3 w-3 shrink-0 mt-0.5" />
            {t("myPortfolio.drill.lotFootnote")}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Compact stat tile for the drilldown snapshot row. Kept local (not
 * TotalTile) because the styling is subtly different — smaller, no
 * tone/currency chip, always foreground text.
 */
function SnapshotTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-card/40 px-2.5 py-1.5 min-w-0">
      <p className="text-[0.55rem] uppercase tracking-wider text-muted-foreground truncate">
        {label}
      </p>
      <p className="text-sm font-semibold tabular-nums mt-0.5 truncate">
        {value}
      </p>
      {sub && (
        <p className="text-[0.6rem] text-muted-foreground truncate mt-0.5">
          {sub}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type StatusFilter = "all" | "open" | "closed";
type SortKey = "value" | "pnl" | "day" | "alpha";

export function PositionsTable() {
  const t = useT();
  const router = useRouter();
  // Use the filtered view so forex rows never leak into the equity
  // P&L math. Consumers who genuinely need every row (e.g. the CSV
  // uploader's dedupe pass) still call `useHoldings` directly — see
  // `useHoldingsView`'s docstring for the split.
  const view = useHoldingsView();
  const rows = view.rows;
  const currentTicker = useUi((s) => s.ticker);
  const setTicker = useUi((s) => s.setTicker);

  // "Open in analysis" — set the global ticker AND navigate away from
  // /my-portfolio to the ticker-scoped Overview page. Before this we
  // only updated the store, leaving the user stranded on /my-portfolio
  // with no visible change (the reported "Open KEYS in analysis doesn't
  // work" bug). `/overview` is the natural entry into the analysis flow.
  const openInAnalysis = React.useCallback(
    (symbol: string) => {
      setTicker(symbol);
      router.push("/overview");
    },
    [router, setTicker],
  );

  const [search, setSearch] = React.useState("");
  const [portfolioFilter, setPortfolioFilter] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("open");
  const [sortKey, setSortKey] = React.useState<SortKey>("value");

  // Drilldown state — accordion style, only one position expanded at a
  // time so the viewport doesn't drown in trade tables. Key is
  // `portfolio\u0000symbol` to match the row identity.
  const [expandedKey, setExpandedKey] = React.useState<string | null>(null);
  const toggleExpand = React.useCallback(
    (key: string) => setExpandedKey((cur) => (cur === key ? null : key)),
    [],
  );

  // ---- Aggregate -------------------------------------------------------
  const rawPositions = React.useMemo(() => aggregatePositions(rows), [rows]);
  const symbols = React.useMemo(() => uniqueOpenSymbols(rawPositions), [rawPositions]);
  const { bySymbol, loading, error, fetchedAt, rateLimited, reload } = useLiveQuotes(symbols);

  const positions = React.useMemo(
    () => attachLiveQuotes(rawPositions, bySymbol),
    [rawPositions, bySymbol],
  );
  const totals = React.useMemo(() => totalsByCurrency(positions), [positions]);

  // ---- Filter + sort ---------------------------------------------------
  const portfolios = React.useMemo(() => {
    const s = new Set<string>();
    for (const p of positions) s.add(p.portfolio);
    return [...s].sort();
  }, [positions]);

  const visible = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = positions.filter((p) => {
      if (portfolioFilter && p.portfolio !== portfolioFilter) return false;
      const isOpen = p.netShares > 0;
      const isClosed = !isOpen && p.boughtShares > 0;
      if (statusFilter === "open" && !isOpen) return false;
      if (statusFilter === "closed" && !isClosed) return false;
      if (q) {
        const hay = `${p.symbol} ${p.displaySymbol ?? ""} ${p.name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // Descending sort by the picked key. `null`-valued rows (no live
    // quote yet) fall to the bottom via a two-tier compare so we never
    // trip `-Infinity − -Infinity = NaN`.
    filtered.sort((a, b) => {
      const pick = (p: Position): number | null => {
        switch (sortKey) {
          case "value":
            return p.marketValue ?? p.investedNow;
          case "pnl":
            return p.totalPnl ?? p.realizedPnl;
          case "day":
            return p.dayChange;
          case "alpha":
            return null;
        }
      };
      if (sortKey === "alpha") return a.symbol.localeCompare(b.symbol);
      const av = pick(a);
      const bv = pick(b);
      const aNull = av === null || !Number.isFinite(av);
      const bNull = bv === null || !Number.isFinite(bv);
      if (aNull && bNull) return a.symbol.localeCompare(b.symbol);
      if (aNull) return 1;
      if (bNull) return -1;
      return (bv as number) - (av as number);
    });
    return filtered;
  }, [positions, search, portfolioFilter, statusFilter, sortKey]);

  // ---- Pagination ------------------------------------------------------
  // `usePagination` handles page overrun (list shrinks under you) but
  // NOT context change — if the user was on page 4 of an "all" listing
  // and then applies a filter that leaves 15 results, they'd land on
  // page 4 of a 1-page list which the hook then snaps back to page 1
  // one render later. That flash is jarring, so we reset explicitly
  // when the *filter identity* changes. Page-size changes are handled
  // inside `usePagination.setPageSize` (which anchors on the current
  // top row) so no explicit reset is needed for them.
  //
  // The `0` entry in `pageSizeOptions` below activates the "All"
  // rendering — everything on one page, no scroll trap.
  const pager = usePagination(visible, 20);
  const setPage = pager.setPage;
  React.useEffect(() => {
    setPage(1);
  }, [search, portfolioFilter, statusFilter, sortKey, setPage]);

  // If the user expands a row and then moves off that page, collapse
  // it so a returning visitor doesn't find a phantom `expandedKey`
  // sitting invisibly on another page.
  const pagedKeys = React.useMemo(
    () => new Set(pager.visibleItems.map((p) => `${p.portfolio}\u0000${p.symbol}`)),
    [pager.visibleItems],
  );
  React.useEffect(() => {
    if (expandedKey && !pagedKeys.has(expandedKey)) setExpandedKey(null);
  }, [expandedKey, pagedKeys]);

  // ---- Render ----------------------------------------------------------
  const isEmpty = rawPositions.length === 0;

  return (
    <div className="space-y-4">
      {/* Winners & losers — sits above the main positions list so the
          user sees the "who's up / who's down" summary before scanning
          the full holdings. Shares the same aggregated `positions`
          array as the table below (no duplicate quote fetch). */}
      <PortfolioWinnersLosers
        positions={positions}
        onSelectTicker={openInAnalysis}
      />

      <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <CircleDot className="h-4 w-4 text-primary" />
            {t("myPortfolio.positions.title")}
          </CardTitle>
          <div className="flex items-center gap-2 text-[0.7rem] text-muted-foreground">
            {fetchedAt && (
              <span title={new Date(fetchedAt).toLocaleString()}>
                {t("myPortfolio.positions.updatedAt", {
                  when: new Date(fetchedAt).toLocaleTimeString(),
                })}
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={reload}
              disabled={loading}
              aria-label={t("common.refresh")}
            >
              <RefreshCcw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {t("myPortfolio.positions.subtitle")}
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Grand totals per currency */}
        <CurrencyTotalsBar totals={totals} />

        {/* Rate-limit banner */}
        {rateLimited && (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning flex items-start gap-2">
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <p>{t("myPortfolio.positions.rateLimited")}</p>
          </div>
        )}

        {/* Error banner (non-blocking — cached data may still be shown) */}
        {error && !loading && (
          <div className="rounded-md border border-danger/40 bg-danger/10 p-2.5 text-xs text-danger">
            {error}
          </div>
        )}

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
          <label className="relative sm:col-span-2">
            <span className="sr-only">{t("myPortfolio.filter.searchLabel")}</span>
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("myPortfolio.filter.searchPlaceholder")}
              className="w-full h-9 rounded-md border border-border bg-card pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <select
            value={portfolioFilter}
            onChange={(e) => setPortfolioFilter(e.target.value)}
            className="h-9 rounded-md border border-border bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={t("myPortfolio.filter.portfolio")}
          >
            <option value="">{t("myPortfolio.filter.allPortfolios")}</option>
            {portfolios.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="h-9 rounded-md border border-border bg-card px-2 text-sm flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label={t("myPortfolio.positions.statusLabel")}
            >
              <option value="open">{t("myPortfolio.positions.statusOpen")}</option>
              <option value="closed">{t("myPortfolio.positions.statusClosed")}</option>
              <option value="all">{t("myPortfolio.positions.statusAll")}</option>
            </select>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="h-9 rounded-md border border-border bg-card px-2 text-sm flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label={t("myPortfolio.filter.sort")}
            >
              <option value="value">{t("myPortfolio.positions.sortValue")}</option>
              <option value="pnl">{t("myPortfolio.positions.sortPnl")}</option>
              <option value="day">{t("myPortfolio.positions.sortDay")}</option>
              <option value="alpha">{t("myPortfolio.positions.sortAlpha")}</option>
            </select>
          </div>
        </div>

        {/* Position rows.
            Empty-state discrimination:
              1. `isEmpty` — store has no equity rows for us to render.
                 If the underlying store *did* contain something and it
                 was 100 % forex hidden by the current toggle, tell the
                 user so they don't think the page is broken (they can
                 flip the toggle in the meta bar above).
              2. `visible.length === 0` — we have rows but the current
                 filter combination (search / portfolio / status) hides
                 them all. That's usually the "closed only" case. */}
        {isEmpty ? (
          view.forexRowCount > 0 && view.hideForex ? (
            <div className="text-center py-8 space-y-1">
              <p className="text-sm text-muted-foreground">
                {t("myPortfolio.table.emptyForexOnly", {
                  n: view.forexRowCount,
                })}
              </p>
              <p className="text-[0.7rem] text-muted-foreground opacity-70">
                {t("myPortfolio.table.emptyForexOnlyHint")}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">
              {t("myPortfolio.table.emptyStore")}
            </p>
          )
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            {t("myPortfolio.table.emptyFilter")}
          </p>
        ) : (
          <>
            <div className="space-y-2">
              {pager.visibleItems.map((p) => {
                const key = `${p.portfolio}\u0000${p.symbol}`;
                return (
                  <PositionRow
                    key={key}
                    position={p}
                    onSelectTicker={openInAnalysis}
                    active={currentTicker.toUpperCase() === p.symbol.toUpperCase()}
                    expanded={expandedKey === key}
                    onToggle={() => toggleExpand(key)}
                  />
                );
              })}
            </div>

            {/* Pagination footer — the built-in `<Pagination>` control
                now renders the page-size selector inline, so the whole
                "list navigation" cluster stays visually grouped without
                a bespoke wrapper. Only shown when there's actually
                something to page — a portfolio of 5 stocks doesn't
                need controls. */}
            {visible.length > 10 && (
              <div className="pt-2 border-t border-border/60">
                <Pagination
                  page={pager.page}
                  pageCount={pager.pageCount}
                  total={pager.total}
                  range={pager.range}
                  onPageChange={pager.setPage}
                  pageSize={pager.pageSize}
                  onPageSizeChange={pager.setPageSize}
                  pageSizeOptions={[10, 20, 50, 100, 0]}
                  pageSizeLabel={t("pager.pageSizeLabel")}
                  allLabel={t("pager.all")}
                  label={t("myPortfolio.pager.positionsLabel")}
                />
              </div>
            )}
          </>
        )}

        <p className="text-[0.65rem] text-muted-foreground flex items-start gap-1.5">
          <Info className="h-3 w-3 shrink-0 mt-0.5" />
          {t("myPortfolio.positions.footnote")}
        </p>
      </CardContent>
    </Card>
    </div>
  );
}
