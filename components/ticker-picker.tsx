"use client";

import * as React from "react";
import { useUi } from "@/lib/state";
import { Button } from "./ui/button";
import { Bell, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { useWatchlist } from "@/hooks/use-watchlist";
import { useStockWatches } from "@/hooks/use-stock-watches";

/**
 * Sidebar ticker picker — reads and mutates the watchlist through the
 * shared `useWatchlist` hook, so an "Add to watchlist" click on any page
 * (Portfolios politicians view, Paper Trading, …) is reflected here
 * instantly, without a page reload.
 */
export function TickerPicker({ className }: { className?: string }) {
  // Select each slice individually so zustand returns stable primitive
  // references. Selecting an inline object literal returns a new reference
  // on every render, which trips React 18's `useSyncExternalStore`
  // "getServerSnapshot should be cached" invariant and produces an infinite
  // update loop.
  const ticker = useUi((s) => s.ticker);
  const setTicker = useUi((s) => s.setTicker);
  const { entries, error: fetchError, add, remove } = useWatchlist();
  const { isTickerWatched } = useStockWatches();
  const [pendingSymbol, setPendingSymbol] = React.useState("");
  const [pendingName, setPendingName] = React.useState("");
  const [mutationError, setMutationError] = React.useState<string | null>(null);
  const t = useT();

  const error = mutationError ?? fetchError;

  // Snap the active ticker to the first list entry if it disappeared.
  React.useEffect(() => {
    if (entries.length > 0 && !entries.find((e) => e.symbol === ticker)) {
      setTicker(entries[0].symbol);
    }
  }, [entries, ticker, setTicker]);

  const onAdd = async () => {
    if (!pendingSymbol.trim()) return;
    setMutationError(null);
    try {
      const sym = pendingSymbol.trim().toUpperCase();
      await add(sym, pendingName || undefined);
      setTicker(sym);
      setPendingSymbol("");
      setPendingName("");
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : String(e));
    }
  };

  const onRemove = async (symbol: string) => {
    setMutationError(null);
    try {
      await remove(symbol);
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      <label className="metric-label">{t("ticker.header")}</label>
      <select
        value={ticker}
        onChange={(e) => setTicker(e.target.value)}
        className="w-full h-9 rounded-md border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {entries.length > 0
          ? entries.map((e) => (
              <option key={e.symbol} value={e.symbol}>
                {e.symbol === e.displayName ? e.symbol : `${e.symbol} — ${e.displayName}`}
              </option>
            ))
          : <option value={ticker}>{ticker}</option>}
      </select>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none py-1">{t("ticker.watchlist")}</summary>
        <div className="mt-2 space-y-2">
          <div className="flex flex-col gap-2">
            <input
              value={pendingSymbol}
              onChange={(e) => setPendingSymbol(e.target.value.toUpperCase())}
              placeholder={t("ticker.placeholder")}
              className="h-8 rounded-md border border-border bg-card px-2 text-xs uppercase focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <input
              value={pendingName}
              onChange={(e) => setPendingName(e.target.value)}
              placeholder={t("form.displayName")}
              className="h-8 rounded-md border border-border bg-card px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button size="sm" onClick={onAdd} className="w-full gap-1.5">
              <Plus className="h-3.5 w-3.5" /> {t("common.add")}
            </Button>
          </div>

          {entries.length > 0 && (
            <ul className="space-y-1 pt-2">
              {entries.map((e) => (
                <li key={e.symbol} className="flex justify-between items-center gap-2">
                  <span className="truncate inline-flex items-center gap-1.5">
                    {e.symbol}
                    {isTickerWatched(e.symbol) && (
                      <Bell
                        className="h-3 w-3 text-primary shrink-0"
                        aria-label="Insider alerts enabled"
                      />
                    )}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => onRemove(e.symbol)}
                    aria-label={t("ticker.removeFromList")}
                    className="h-7 w-7"
                    disabled={entries.length <= 1}
                    title={entries.length <= 1 ? t("ticker.removeFromList") : t("ticker.removeFromList")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {error && <p className="text-danger">{error}</p>}
        </div>
      </details>
    </div>
  );
}
