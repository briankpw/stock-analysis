"use client";

/**
 * Tiny reusable "Add this ticker to my watchlist" button.
 *
 * States:
 *   - not in list, idle    → `+` icon, hover primary
 *   - not in list, busy    → spinner
 *   - already in watchlist → `✓` icon (success tint), disabled
 *   - failed               → danger tint, error surfaced via `title`
 *
 * Renders a compact icon-only button by default (fits into dense tables like
 * the Portfolios politicians view). Pass `variant="label"` to render a wider
 * button with the "Add to watchlist" text.
 */

import * as React from "react";
import { Check, Plus, Loader2 } from "lucide-react";
import { useWatchlist } from "@/hooks/use-watchlist";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Props {
  symbol: string;
  displayName?: string;
  /** Icon-only (default) vs. icon + label. */
  variant?: "icon" | "label";
  className?: string;
}

export function AddToWatchlistButton({
  symbol,
  displayName,
  variant = "icon",
  className,
}: Props) {
  const { symbols, add } = useWatchlist();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const t = useT();

  const sym = symbol.trim().toUpperCase();
  const inList = symbols.has(sym);

  const onClick = async (e: React.MouseEvent) => {
    // Stop the click from also triggering surrounding row-level handlers
    // (e.g. the neighbouring ticker chip that opens the Overview page).
    e.stopPropagation();
    e.preventDefault();
    if (inList || busy) return;
    setError(null);
    setBusy(true);
    try {
      await add(sym, displayName);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const Icon = busy ? Loader2 : inList ? Check : Plus;
  const label = inList ? t("watchlist.inList") : t("watchlist.add", { symbol: sym });
  const tooltip = error ?? (inList
    ? t("watchlist.inListTitle", { symbol: sym })
    : t("watchlist.add", { symbol: sym }));

  const toneClasses = inList
    ? "border-success/40 bg-success/10 text-success cursor-default"
    : error
      ? "border-danger/40 bg-danger/10 text-danger hover:bg-danger/15"
      : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary";

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={inList || busy}
        aria-label={label}
        title={tooltip}
        className={cn(
          "inline-flex items-center justify-center h-6 w-6 rounded-md border transition-colors shrink-0",
          toneClasses,
          className,
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
      disabled={inList || busy}
      title={tooltip}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium rounded-md border px-2 py-1 transition-colors",
        toneClasses,
        className,
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
      <span>{label}</span>
    </button>
  );
}
