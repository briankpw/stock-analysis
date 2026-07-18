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
 * Renders nothing when no CSV has been imported yet — that keeps the
 * empty-state look on first visit clean.
 */

import * as React from "react";
import { Calendar, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHoldings } from "@/lib/holdings-state";
import { useT } from "@/lib/i18n";

export function HoldingsMetaBar() {
  const t = useT();
  const meta = useHoldings((s) => s.meta);
  const clearHoldings = useHoldings((s) => s.clearHoldings);

  if (!meta) return null;

  const onClear = () => {
    if (window.confirm(t("myPortfolio.confirmClear"))) clearHoldings();
  };

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
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="outline" size="sm" onClick={onClear}>
          <Trash2 className="h-3.5 w-3.5" />
          {t("myPortfolio.clear")}
        </Button>
      </div>
    </div>
  );
}
