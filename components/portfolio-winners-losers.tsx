"use client";

/**
 * Top winners & losers among the user's OPEN positions.
 *
 * Ranks the current holdings by unrealized performance so the user can
 * instantly see which stocks are pulling the portfolio up (winners) and
 * which are dragging it down (losers). Closed positions are excluded —
 * their realized P&L is history, not "current winner / loser".
 *
 * The toggle switches the primary ranking key:
 *   • "By %"  — sort by `unrealizedPnlPct`. The default because a small
 *     position doubling isn't drowned out by a huge one moving 1 %.
 *   • "By $"  — sort by `unrealizedPnl`. The "how much money" view.
 *
 * Positions are passed in from the parent (`PositionsTable`) so we share
 * the same aggregation + live-quote fetch and never fire a second
 * `/api/quotes` request.
 */

import * as React from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Position } from "@/lib/portfolio-aggregate";

const TOP_N = 10;
const DASH = "—";

type SortMode = "pct" | "abs";

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

function fmtPct(v: number | null, opts?: { signed?: boolean }): string {
  if (v === null || !Number.isFinite(v)) return DASH;
  const abs = Math.abs(v) * 100;
  const s = `${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
  if (opts?.signed) return `${v > 0 ? "+" : v < 0 ? "-" : ""}${s}`;
  return v < 0 ? `-${s}` : s;
}

export function PortfolioWinnersLosers({
  positions,
  onSelectTicker,
}: {
  positions: Position[];
  onSelectTicker: (symbol: string) => void;
}) {
  const t = useT();
  const [sortBy, setSortBy] = React.useState<SortMode>("pct");

  // Restrict to OPEN positions with a live P&L figure. Closed positions
  // have `unrealizedPnl == null`; positions without a live quote also
  // have null and are excluded so the ranking is comparable.
  const eligible = React.useMemo(
    () =>
      positions.filter(
        (p) =>
          p.netShares > 0 &&
          p.unrealizedPnl !== null &&
          Number.isFinite(p.unrealizedPnl),
      ),
    [positions],
  );

  const { winners, losers } = React.useMemo(() => {
    const keyOf = (p: Position): number => {
      const v = sortBy === "pct" ? p.unrealizedPnlPct : p.unrealizedPnl;
      return v !== null && Number.isFinite(v) ? v : 0;
    };
    const positive: Position[] = [];
    const negative: Position[] = [];
    for (const p of eligible) {
      const k = keyOf(p);
      if (k > 0) positive.push(p);
      else if (k < 0) negative.push(p);
    }
    positive.sort((a, b) => keyOf(b) - keyOf(a));
    negative.sort((a, b) => keyOf(a) - keyOf(b));
    return {
      winners: positive.slice(0, TOP_N),
      losers: negative.slice(0, TOP_N),
    };
  }, [eligible, sortBy]);

  if (eligible.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-success" />
            {t("myPortfolio.winners.title")}
          </CardTitle>
          <div
            role="tablist"
            aria-label={t("myPortfolio.winners.sortByLabel")}
            className="inline-flex rounded-md border border-border bg-muted/20 p-0.5"
          >
            <SortToggle
              active={sortBy === "pct"}
              onClick={() => setSortBy("pct")}
              label={t("myPortfolio.winners.byPct")}
            />
            <SortToggle
              active={sortBy === "abs"}
              onClick={() => setSortBy("abs")}
              label={t("myPortfolio.winners.byAbs")}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {t("myPortfolio.winners.subtitle", { n: TOP_N })}
        </p>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <WinnersLosersList
          title={t("myPortfolio.winners.winners")}
          rows={winners}
          tone="bull"
          sortBy={sortBy}
          empty={t("myPortfolio.winners.emptyWinners")}
          onSelectTicker={onSelectTicker}
        />
        <WinnersLosersList
          title={t("myPortfolio.winners.losers")}
          rows={losers}
          tone="bear"
          sortBy={sortBy}
          empty={t("myPortfolio.winners.emptyLosers")}
          onSelectTicker={onSelectTicker}
        />
      </CardContent>
    </Card>
  );
}

function SortToggle({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 text-[0.7rem] font-medium rounded-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-card text-foreground shadow-sm border border-border"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function WinnersLosersList({
  title,
  rows,
  tone,
  sortBy,
  empty,
  onSelectTicker,
}: {
  title: string;
  rows: Position[];
  tone: "bull" | "bear";
  sortBy: SortMode;
  empty: string;
  onSelectTicker: (symbol: string) => void;
}) {
  const t = useT();
  const Icon = tone === "bull" ? TrendingUp : TrendingDown;
  const iconTone = tone === "bull" ? "text-success" : "text-danger";
  const borderTone = tone === "bull" ? "border-success/30" : "border-danger/30";
  const bgTone = tone === "bull" ? "bg-success/5" : "bg-danger/5";
  const numTone = tone === "bull" ? "text-success" : "text-danger";

  return (
    <div className={cn("rounded-lg border p-3", borderTone, bgTone)}>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className={cn("h-3.5 w-3.5", iconTone)} />
        <span className="text-[0.7rem] uppercase tracking-wider font-semibold text-muted-foreground">
          {title}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">{empty}</p>
      ) : (
        <ol className="space-y-0.5">
          {rows.map((p, idx) => {
            const pnl = p.unrealizedPnl;
            const pnlPct = p.unrealizedPnlPct;
            const primaryText =
              sortBy === "pct"
                ? fmtPct(pnlPct, { signed: true })
                : fmtMoney(pnl, { signed: true });
            const secondaryText =
              sortBy === "pct"
                ? fmtMoney(pnl, { signed: true })
                : fmtPct(pnlPct, { signed: true });
            const key = `${p.portfolio}\u0000${p.symbol}`;
            return (
              <li key={key}>
                <div className="flex items-center gap-2 py-1 px-1 rounded-md hover:bg-card/70 transition-colors">
                  <span className="tabular-nums text-[0.65rem] text-muted-foreground w-4 text-right shrink-0">
                    {idx + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => onSelectTicker(p.symbol)}
                    title={t("myPortfolio.pos.viewInsights")}
                    className="min-w-0 flex-1 flex items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm py-0.5"
                  >
                    <span className="font-mono font-semibold text-xs shrink-0">
                      {p.displaySymbol ?? p.symbol}
                    </span>
                    <span className="text-[0.65rem] text-muted-foreground truncate min-w-0">
                      {p.name}
                    </span>
                  </button>
                  <div className="text-right shrink-0">
                    <div className={cn("text-xs font-semibold tabular-nums", numTone)}>
                      {primaryText}
                    </div>
                    <div className="text-[0.6rem] text-muted-foreground tabular-nums">
                      {secondaryText}
                    </div>
                  </div>
                  <AddToWatchlistButton
                    symbol={p.symbol}
                    displayName={p.name || p.symbol}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
