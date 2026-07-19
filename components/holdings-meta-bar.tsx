"use client";

/**
 * HoldingsMetaBar — the small "imported {when} · file.csv · N rows"
 * strip that appears above the portfolio content.
 *
 * Extracted from `holdings-table.tsx` so both the Positions and
 * Transactions tabs can share a single instance without duplicating
 * the meta bar underneath the tab switcher. The bar also carries the
 * "Clear all" action which is legitimately global (not scoped to
 * either tab).
 *
 * As of the forex-filter refactor it also exposes a "hide FX" toggle
 * chip when the imported set contains at least one Yahoo `=X` pair.
 * Chip is fully hidden when there's nothing to toggle, so the bar
 * stays clean for equity-only portfolios.
 *
 * Renders nothing when no CSV has been imported yet — that keeps the
 * empty-state look on first visit clean.
 */

import { Calendar, DollarSign, Eye, EyeOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useHoldings,
  useHoldingsPrefs,
  useHoldingsView,
} from "@/lib/holdings-state";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function HoldingsMetaBar() {
  const t = useT();
  const meta = useHoldings((s) => s.meta);
  const clearHoldings = useHoldings((s) => s.clearHoldings);
  const view = useHoldingsView();
  const hideForex = useHoldingsPrefs((s) => s.hideForex);
  const toggleHideForex = useHoldingsPrefs((s) => s.toggleHideForex);

  if (!meta) return null;

  const onClear = () => {
    if (!window.confirm(t("myPortfolio.confirmClear"))) return;
    // Fire-and-forget: the store handles rollback + `syncError`
    // surfacing on its own if the server rejects the delete. `void`
    // is explicit so a future strict-lint doesn't flag the missing
    // await.
    void clearHoldings();
  };

  // Only render the FX chip when there's actually forex in the store
  // — no point showing a toggle that would do nothing.
  const hasForex = view.forexRowCount > 0;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2">
      <div className="min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          {t("myPortfolio.imported.at", {
            when: new Date(meta.importedAt).toLocaleString(),
          })}
        </span>
        <span className="text-muted-foreground truncate" title={meta.sourceFilename}>
          {meta.sourceFilename}
        </span>
        <span className="chip chip-neu text-[0.6rem]">
          {t("myPortfolio.imported.rows", { n: meta.rowCount })}
        </span>
        {/* Feedback for the most recent import: after a merge, tell
            the user how many rows were actually appended vs skipped as
            duplicates. Absent for the first import; hidden for
            replaces (added/skipped meaningless). */}
        {meta.lastMode === "merge" && (
          <span
            className="chip chip-bull text-[0.6rem]"
            title={t("myPortfolio.imported.mergeHint")}
          >
            {t("myPortfolio.imported.merged", {
              added: meta.lastAddedCount ?? 0,
              skipped: meta.lastSkippedCount ?? 0,
            })}
          </span>
        )}
        {meta.lastMode === "replace" && (
          <span
            className="chip chip-neu text-[0.6rem]"
            title={t("myPortfolio.imported.replaceHint")}
          >
            {t("myPortfolio.imported.replaced")}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        {/* Forex toggle — only rendered when the store actually
            contains at least one `=X` pair. Clicking it flips the
            persisted `hideForex` preference, which every consumer of
            `useHoldingsView` reflects immediately. */}
        {hasForex && (
          <button
            type="button"
            onClick={toggleHideForex}
            title={
              hideForex
                ? t("myPortfolio.forex.tooltipShow", {
                    n: view.forexRowCount,
                    symbols: view.forexSymbols.join(", "),
                  })
                : t("myPortfolio.forex.tooltipHide", {
                    n: view.forexRowCount,
                    symbols: view.forexSymbols.join(", "),
                  })
            }
            aria-pressed={hideForex}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[0.65rem] font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              hideForex
                ? "border-warning/40 bg-warning/10 text-warning hover:bg-warning/15"
                : "border-border bg-card text-muted-foreground hover:bg-muted/40",
            )}
          >
            <DollarSign className="h-3 w-3" />
            {hideForex
              ? t("myPortfolio.forex.chipHidden", { n: view.forexRowCount })
              : t("myPortfolio.forex.chipShown", { n: view.forexRowCount })}
            {/* Icon mirrors current state (EyeOff = hidden, Eye =
                shown) so a glance at the chip is unambiguous. The
                click still toggles — the tooltip spells that out. */}
            {hideForex ? (
              <EyeOff className="h-3 w-3 ml-0.5 opacity-70" />
            ) : (
              <Eye className="h-3 w-3 ml-0.5 opacity-70" />
            )}
          </button>
        )}
        <Button variant="outline" size="sm" onClick={onClear}>
          <Trash2 className="h-3.5 w-3.5" />
          {t("myPortfolio.clear")}
        </Button>
      </div>
    </div>
  );
}
