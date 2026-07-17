"use client";

/**
 * "Alert on insider trades" toggle for a specific stock ticker.
 *
 * Different from `WatchTradeButton` (which is scoped to the portfolio
 * module): this one fires when ANY insider at the ticker's company
 * files a Form 4, regardless of whether we track that person.
 *
 * Backed by `stock_watches` in SQLite via `hooks/use-stock-watches.ts`.
 */

import * as React from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { useStockWatches } from "@/hooks/use-stock-watches";
import { cn } from "@/lib/utils";

interface Props {
  ticker: string;
  variant?: "icon" | "label";
  className?: string;
}

export function WatchStockButton({
  ticker,
  variant = "icon",
  className,
}: Props) {
  const { isTickerWatched, addTicker, removeTicker } = useStockWatches();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const symbol = ticker.trim().toUpperCase();
  const isWatched = isTickerWatched(symbol);

  const label = isWatched
    ? `Stop alerting on insider trades for ${symbol}`
    : `Alert me on any insider trade at ${symbol}`;

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy || !symbol) return;
    setError(null);
    setBusy(true);
    try {
      if (isWatched) await removeTicker(symbol);
      else await addTicker(symbol);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const Icon = busy ? Loader2 : isWatched ? Bell : BellOff;
  const tooltip = error ?? label;

  const toneClasses = isWatched
    ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
    : error
      ? "border-danger/40 bg-danger/10 text-danger hover:bg-danger/15"
      : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary";

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={busy || !symbol}
        aria-label={label}
        aria-pressed={isWatched}
        title={tooltip}
        className={cn(
          "inline-flex items-center justify-center h-9 w-9 rounded-md border transition-colors shrink-0",
          toneClasses,
          className,
        )}
      >
        <Icon className={cn("h-4 w-4", busy && "animate-spin")} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || !symbol}
      aria-pressed={isWatched}
      title={tooltip}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium rounded-md border px-2 py-1 transition-colors",
        toneClasses,
        className,
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
      <span>
        {isWatched ? "Insider alerts on" : "Alert on insider trades"}
      </span>
    </button>
  );
}
