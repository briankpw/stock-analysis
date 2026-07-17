"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { fmtCurrency, fmtSignedPercent } from "@/lib/format";
import { useBundle } from "@/hooks/use-bundle";
import { useUi } from "@/lib/state";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { WatchStockButton } from "./watch-stock-button";

/** Shared price header shown across most pages. */
/**
 * Shared header. Callers may pass either a raw `pageTitle` (already
 * localized by the page) or a `pageTitleKey` that we resolve through the
 * i18n dict — both are supported so the migration to i18n keys can be
 * incremental.
 */
export function PageHeader({
  pageTitle,
  pageTitleKey,
}: {
  pageTitle?: string;
  pageTitleKey?: string;
}) {
  const { data, loading, reload } = useBundle();
  // Individual selectors keep zustand's `useSyncExternalStore` snapshot stable.
  const period = useUi((s) => s.period);
  const setPeriod = useUi((s) => s.setPeriod);
  const interval = useUi((s) => s.interval);
  const setInterval = useUi((s) => s.setInterval);
  const t = useT();
  const title = pageTitleKey ? t(pageTitleKey) : pageTitle ?? "";

  const price = data?.quote.price;
  const changePct = data?.quote.changePercent ?? null;
  const dir = changePct === null ? 0 : Math.sign(changePct);

  return (
    <header className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 lg:gap-4 pb-5 lg:pb-6 border-b border-border mb-5 lg:mb-6">
      <div className="min-w-0 w-full lg:w-auto">
        <p className="metric-label mb-1">{title}</p>
        <div className="flex items-baseline gap-2 sm:gap-3 flex-wrap">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight min-w-0">
            <span className="align-baseline">{data?.ticker ?? "—"}</span>
            {data?.companyName && data.companyName !== data.ticker && (
              <span className="text-muted-foreground font-normal text-sm sm:text-base lg:text-lg ml-2 align-baseline">
                {data.companyName}
              </span>
            )}
          </h1>
          {price !== undefined && price !== null && (
            <div className="flex items-baseline gap-2 shrink-0">
              <span className="text-lg sm:text-xl lg:text-2xl font-semibold tabular-nums">{fmtCurrency(price)}</span>
              {changePct !== null && (
                <span
                  className={cn(
                    "chip tabular-nums",
                    dir > 0 ? "chip-bull" : dir < 0 ? "chip-bear" : "chip-neu",
                  )}
                >
                  {fmtSignedPercent(changePct)}
                </span>
              )}
            </div>
          )}
        </div>
        {data?.sector && (
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            {data.sector}
            {data.industry ? ` · ${data.industry}` : ""}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap w-full lg:w-auto lg:justify-end">
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="h-9 flex-1 sm:flex-none min-w-[4.5rem] rounded-md border border-border bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label={t("ticker.periodLabel")}
        >
          {["1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"].map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select
          value={interval}
          onChange={(e) => setInterval(e.target.value)}
          className="h-9 flex-1 sm:flex-none min-w-[4.5rem] rounded-md border border-border bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label={t("ticker.intervalLabel")}
        >
          {["1d", "1wk", "1mo"].map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        {data?.ticker && <WatchStockButton ticker={data.ticker} />}
        <Button variant="outline" size="icon" onClick={reload} disabled={loading} aria-label={t("common.retry")}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </div>
    </header>
  );
}
