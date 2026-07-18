"use client";

/**
 * "Add to watchlist" for rows that only carry an issuer name (no ticker).
 *
 * The Portfolios → Fund detail view lists 13F holdings, and 13F filings
 * identify positions by CUSIP + issuer name only — there's no ticker in
 * the SEC payload. This component fills that gap with a tiny inline
 * popover that lets the user paste in the ticker they just found via
 * the neighbouring "Look up" link, then adds it to their watchlist with
 * the SEC issuer name as the display label.
 *
 * States mirror `AddToWatchlistButton`:
 *   - idle          → `+` icon, hover primary
 *   - busy          → spinner
 *   - added         → `✓` icon (success tint) until the row unmounts
 *   - failed        → danger tint, error surfaced inside the popover
 *
 * We manage focus + outside-click + Escape dismissal ourselves rather
 * than pulling in a Popover primitive; the popover is a plain absolutely-
 * positioned div anchored to the trigger.
 */

import * as React from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
import { useWatchlist } from "@/hooks/use-watchlist";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Props {
  /** Human-readable issuer name from the source filing. Used as the
   *  `displayName` when adding to the watchlist. */
  issuerName: string;
  /** Optional pre-fill (e.g. a heuristic guess). Left blank by default —
   *  a wrong guess is more misleading than an empty field. */
  suggestedSymbol?: string;
  className?: string;
}

export function AddIssuerToWatchlistButton({
  issuerName,
  suggestedSymbol = "",
  className,
}: Props) {
  const { add, symbols } = useWatchlist();
  const [open, setOpen] = React.useState(false);
  const [symbol, setSymbol] = React.useState(suggestedSymbol);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [addedSymbol, setAddedSymbol] = React.useState<string | null>(null);
  const t = useT();

  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Outside-click + Escape to close.
  React.useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Green-check state persists across popover open/close within one
  // mount so the user can see "yep, added" without re-reading the sidebar.
  const inListNow = addedSymbol !== null && symbols.has(addedSymbol);

  const onToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setError(null);
    setOpen((v) => !v);
  };

  const onSubmit = async (e: React.FormEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const sym = symbol.trim().toUpperCase();
    if (!sym) {
      setError(t("watchlist.tickerRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await add(sym, issuerName);
      setAddedSymbol(sym);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const triggerLabel = inListNow
    ? t("watchlist.inListTitle", { symbol: addedSymbol! })
    : t("watchlist.addIssuer");

  return (
    <div ref={rootRef} className={cn("relative inline-block", className)}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={triggerLabel}
        aria-expanded={open}
        title={triggerLabel}
        disabled={busy}
        className={cn(
          "inline-flex items-center justify-center h-6 w-6 rounded-md border transition-colors shrink-0",
          inListNow
            ? "border-success/40 bg-success/10 text-success"
            : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary",
        )}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : inListNow ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Plus className="h-3.5 w-3.5" />
        )}
      </button>

      {open && (
        <div
          className="absolute z-30 right-0 top-full mt-1 w-64 rounded-md border border-border bg-card shadow-lg p-3"
          onClick={(e) => e.stopPropagation()}
        >
          <form onSubmit={onSubmit} className="space-y-2">
            <div className="text-[0.7rem] leading-snug text-muted-foreground">
              {t("watchlist.tickerHint", { name: issuerName })}
            </div>
            <input
              ref={inputRef}
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder={t("ticker.placeholder")}
              className="w-full h-8 rounded-md border border-border bg-card px-2 text-xs uppercase font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              autoComplete="off"
              spellCheck={false}
            />
            {error && (
              <p className="text-[0.7rem] text-danger" role="alert">{error}</p>
            )}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busy || !symbol.trim()}
                className="flex-1 inline-flex items-center justify-center gap-1 h-7 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {busy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
                {busy ? t("common.adding") : t("common.add")}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t("common.cancel")}
                title={t("common.cancel")}
                className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-border text-muted-foreground hover:bg-muted/60 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
