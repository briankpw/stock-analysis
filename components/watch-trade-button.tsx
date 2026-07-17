"use client";

/**
 * "Watch trades" toggle — sits next to a person's name in the detail
 * header, or next to any ticker chip in a trades / holdings table.
 *
 * Semantics:
 *   - kind='person' — every trade by <category, presetId> notifies (both
 *                     buys and sells, by default).
 *   - kind='ticker' — every trade of <ticker> across every tracked
 *                     preset notifies.
 *
 * Both are toggled with the same click. On second click, the watch is
 * removed. This is deliberately snappier than the Add-to-Watchlist
 * button (which is only additive) because notification opt-in feels
 * heavier and users need a fast escape hatch.
 */

import * as React from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { usePortfolioWatches } from "@/hooks/use-portfolio-watches";
import type { EventCategory } from "@/lib/portfolio-watch/events";
import { cn } from "@/lib/utils";

type Props =
  | {
      kind: "person";
      category: EventCategory;
      presetId: string;
      /** For error messages and aria-label. */
      displayName: string;
      variant?: "icon" | "label";
      className?: string;
    }
  | {
      kind: "ticker";
      ticker: string;
      /** Passed through to Telegram-visible logs. Optional. */
      displayName?: string;
      variant?: "icon" | "label";
      className?: string;
    };

export function WatchTradeButton(props: Props) {
  const {
    isPersonWatched,
    isTickerWatched,
    addPerson,
    addTicker,
    removePerson,
    removeTicker,
  } = usePortfolioWatches();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const isWatched =
    props.kind === "person"
      ? isPersonWatched(props.category, props.presetId)
      : isTickerWatched(props.ticker);

  const label = isWatched
    ? props.kind === "person"
      ? `Stop watching ${props.displayName}`
      : `Stop watching ${props.ticker.toUpperCase()}`
    : props.kind === "person"
      ? `Alert me on ${props.displayName} trades`
      : `Alert me on ${props.ticker.toUpperCase()} trades`;

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      if (props.kind === "person") {
        if (isWatched) await removePerson(props.category, props.presetId);
        else await addPerson(props.category, props.presetId);
      } else {
        const sym = props.ticker.trim().toUpperCase();
        if (isWatched) await removeTicker(sym);
        else await addTicker(sym);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const Icon = busy ? Loader2 : isWatched ? Bell : BellOff;
  const variant = props.variant ?? "icon";
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
        disabled={busy}
        aria-label={label}
        aria-pressed={isWatched}
        title={tooltip}
        className={cn(
          "inline-flex items-center justify-center h-6 w-6 rounded-md border transition-colors shrink-0",
          toneClasses,
          props.className,
        )}
      >
        <Icon className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={isWatched}
      title={tooltip}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium rounded-md border px-2 py-1 transition-colors",
        toneClasses,
        props.className,
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
      <span>
        {isWatched
          ? "Alerts on"
          : props.kind === "person"
            ? "Alert on trades"
            : "Alert on this ticker"}
      </span>
    </button>
  );
}
