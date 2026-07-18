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
 *
 * `onSelectTicker` is called only when the ticker change was initiated by
 * a USER action in this picker (dropdown change, watchlist row click, or
 * a successful add). The sidebar uses it to close the mobile drawer.
 * Passive mutations — the "snap to first entry when the persisted symbol
 * disappeared" effect below, or Zustand's async rehydration — must NOT
 * fire this callback, otherwise a freshly-opened drawer would slam shut
 * before the user has done anything.
 */
export function TickerPicker({
  className,
  onSelectTicker,
}: {
  className?: string;
  onSelectTicker?: () => void;
}) {
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

  // Snap the active ticker to the first list entry ONLY when the watchlist
  // itself changed in a way that removed the currently-active symbol —
  // i.e. the user just clicked "remove" on the row that was selected, or
  // the persisted symbol was already gone at first observation of the
  // hydrated watchlist.
  //
  // The naive "if ticker not in entries, snap" version fired every render
  // and clobbered legitimate cross-app navigations to non-watchlist
  // tickers — e.g. clicking a stock like APH from the Segments page
  // instantly reverted to the first watchlist symbol before the destination
  // page could render (see repro from user report 2026-07-18).
  //
  // Discriminator: compare the previous set of watchlist symbols against
  // the new one. If the current ticker (a) was previously in the list and
  // is no longer, OR (b) was never observed at all (fresh boot with a stale
  // persisted ticker), snap. Otherwise it's a user-initiated pick of a
  // non-watchlist symbol and we must leave it alone.
  //
  // Passive normalization — deliberately does NOT invoke `onSelectTicker`,
  // so the mobile drawer stays open if this fires after the user has
  // tapped the hamburger.
  const seenSymbolsRef = React.useRef<Set<string> | null>(null);
  React.useEffect(() => {
    if (entries.length === 0) return;
    const symbols = new Set(entries.map((e) => e.symbol));
    const prev = seenSymbolsRef.current;
    seenSymbolsRef.current = symbols;
    if (symbols.has(ticker)) return;
    const firstObservation = prev === null;
    const wasRemovedFromList = prev !== null && prev.has(ticker);
    if (firstObservation || wasRemovedFromList) {
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
      onSelectTicker?.();
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

  // When the active ticker isn't a member of the watchlist (e.g. the user
  // just clicked APH from the Segments page, or opened a stock from
  // Portfolios), synthesise a leading "off-list" option so the `<select>`
  // has a matching value entry. Without this, React renders the control
  // uncontrolled ("selected value not in options") and the browser
  // silently displays the first entry — which manifested as "click APH,
  // sidebar shows AMD" before this was fixed.
  const tickerInWatchlist = entries.some((e) => e.symbol === ticker);
  const offListLabel = t("ticker.offList", { ticker });

  return (
    <div className={cn("space-y-2", className)}>
      <label className="metric-label">{t("ticker.header")}</label>
      <select
        value={ticker}
        onChange={(e) => {
          setTicker(e.target.value);
          onSelectTicker?.();
        }}
        className="w-full h-9 rounded-md border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {!tickerInWatchlist && (
          <option value={ticker}>{offListLabel}</option>
        )}
        {entries.map((e) => (
          <option key={e.symbol} value={e.symbol}>
            {e.symbol === e.displayName ? e.symbol : `${e.symbol} — ${e.displayName}`}
          </option>
        ))}
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
              {entries.map((e) => {
                const active = e.symbol === ticker;
                return (
                  <li
                    key={e.symbol}
                    className={cn(
                      "flex items-center gap-1 rounded-md transition-colors",
                      active
                        ? "bg-primary/10 text-foreground"
                        : "hover:bg-muted/40",
                    )}
                  >
                    {/* Whole row is a select button — one tap on mobile
                        activates the ticker and closes the drawer via
                        the explicit `onSelectTicker` callback. */}
                    <button
                      type="button"
                      onClick={() => {
                        setTicker(e.symbol);
                        onSelectTicker?.();
                      }}
                      aria-current={active ? "true" : undefined}
                      className="flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1.5 text-left"
                    >
                      <span
                        className={cn(
                          "text-xs font-semibold truncate",
                          active ? "text-primary" : "text-foreground",
                        )}
                      >
                        {e.symbol}
                      </span>
                      {e.displayName && e.displayName !== e.symbol && (
                        <span className="text-[0.65rem] text-muted-foreground truncate">
                          {e.displayName}
                        </span>
                      )}
                      {isTickerWatched(e.symbol) && (
                        <Bell
                          className="h-3 w-3 text-primary shrink-0"
                          aria-label="Insider alerts enabled"
                        />
                      )}
                    </button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => onRemove(e.symbol)}
                      aria-label={t("ticker.removeFromList")}
                      className="h-7 w-7 shrink-0"
                      disabled={entries.length <= 1}
                      title={t("ticker.removeFromList")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {error && <p className="text-danger">{error}</p>}
        </div>
      </details>
    </div>
  );
}
