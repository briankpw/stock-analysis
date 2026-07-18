"use client";

/**
 * My Portfolio — user's own imported holdings.
 *
 * This page is the entry point for the CSV-upload workflow: users
 * export their transaction history from a portfolio-tracker app (MSP,
 * MooMoo, Webull, etc.) and drop the file here to see everything on-
 * device. The CSV never leaves the browser — rows are parsed and kept
 * in `localStorage` via the `useHoldings` store, so there's no server
 * persistence, auth, or DB migration involved for a "list down all the
 * details" feature.
 *
 * Layout:
 *   • Header + PageIntro.
 *   • Import-metadata strip (only when data is loaded) — carries the
 *     "imported {when}, {file}, N rows" summary and Clear action.
 *   • Three tabs:
 *       – **Positions** (default) — grouped-by-stock rollup with live
 *         market value, unrealized P&L, today's dollar change, and
 *         realized P&L from past sells. Answers "how much am I making".
 *       – **Transactions** — the full row-by-row list from the CSV.
 *         Answers "what did I actually buy/sell".
 *       – **Risks** — delisting / bankruptcy / price-collapse
 *         warnings per holding. Shows an "all clear" panel when
 *         everything's fine; the tab label carries a red pulsing
 *         badge when at least one holding trips a critical / high
 *         signal so users don't have to open the tab to notice.
 *         Also owns the one-click subscription to background push
 *         notifications for the same risks.
 *   • Uploader is *always* rendered underneath when data is present so
 *     users can re-upload a newer export without hunting for a button.
 */

import * as React from "react";
import { Briefcase, CircleDot, ListOrdered, ShieldAlert } from "lucide-react";
import { PageIntro } from "@/components/page-intro";
import { KeyTerms } from "@/components/key-terms";
import { PortfolioUploader } from "@/components/portfolio-uploader";
import { HoldingsTable } from "@/components/holdings-table";
import { PositionsTable } from "@/components/positions-table";
import { HoldingsMetaBar } from "@/components/holdings-meta-bar";
import {
  PortfolioRisksTab,
  usePortfolioRiskBadge,
} from "@/components/portfolio-risks-tab";
import { useHoldings } from "@/lib/holdings-state";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Tab = "positions" | "transactions" | "risks";

export default function MyPortfolioPage() {
  const t = useT();
  const hasData = useHoldings((s) => s.rows.length > 0 && s.meta !== null);
  const [tab, setTab] = React.useState<Tab>("positions");

  // Deep-link support for the push notification's `?tab=risks` param
  // — when a user taps the "portfolio risk" notification on their
  // phone, land them on the Risks tab immediately rather than
  // Positions.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab");
    if (t === "risks" || t === "positions" || t === "transactions") {
      setTab(t);
    }
  }, []);

  return (
    <div className="mx-auto max-w-7xl">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-5 lg:pb-6 border-b border-border mb-5 lg:mb-6">
        <div className="min-w-0">
          <p className="metric-label mb-1">{t("nav.myPortfolio")}</p>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary shrink-0">
              <Briefcase className="h-5 w-5" />
            </span>
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight">
              {t("myPortfolio.heading")}
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-2xl">
            {t("myPortfolio.subheading")}
          </p>
        </div>
      </header>

      <PageIntro pageKey="my-portfolio" />

      <div className="space-y-6 animate-fade-in">
        {hasData ? (
          <>
            <HoldingsMetaBar />

            {/* Tab switcher — plain buttons rather than a Radix
                Tabs component so the two panels can share the meta-bar
                above without prop-drilling. Kept as a segmented
                control with clear active state so users on mobile can
                tap without hunting. */}
            <div
              role="tablist"
              aria-label={t("myPortfolio.tabs.label")}
              className="inline-flex rounded-lg border border-border bg-muted/20 p-1 gap-1"
            >
              <TabButton
                active={tab === "positions"}
                onClick={() => setTab("positions")}
                icon={<CircleDot className="h-3.5 w-3.5" />}
                label={t("myPortfolio.tabs.positions")}
              />
              <TabButton
                active={tab === "transactions"}
                onClick={() => setTab("transactions")}
                icon={<ListOrdered className="h-3.5 w-3.5" />}
                label={t("myPortfolio.tabs.transactions")}
              />
              <RisksTabButton
                active={tab === "risks"}
                onClick={() => setTab("risks")}
              />
            </div>

            {tab === "positions" ? (
              <PositionsTable />
            ) : tab === "transactions" ? (
              <HoldingsTable />
            ) : (
              <PortfolioRisksTab />
            )}

            <PortfolioUploader />
          </>
        ) : (
          <PortfolioUploader />
        )}

        <KeyTerms
          terms={[
            "Portfolio",
            "Buy day",
            "Sell day",
            "Watchlist",
            "Unrealized P&L",
            "Realized P&L",
          ]}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab button — kept inline (small, single-use) rather than a general
// segmented-control component. If a third tab lands here we should
// extract to `components/ui/tabs.tsx`.
// ---------------------------------------------------------------------------

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-card text-foreground shadow-sm border border-border"
          : "text-muted-foreground hover:text-foreground hover:bg-card/60",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * Risks tab has three states, hinted at with a badge:
 *
 *   * No risks detected — plain label, no badge. Users who never
 *     have a holding go bad will effectively never notice the tab
 *     is there beyond the icon in the tab strip (exactly the "blank
 *     when nothing bad" behaviour the user asked for).
 *   * MEDIUM only (worth monitoring, not urgent) — subdued amber dot.
 *   * HIGH / CRITICAL present — red pulsing badge with the count so
 *     it's impossible to miss even from another tab.
 *
 * The badge shares its data source with the tab body via the SWR-ish
 * `usePortfolioRiskAnalysis` cache — see the hook comments.
 */
function RisksTabButton({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
  const t = useT();
  const badge = usePortfolioRiskBadge();
  const urgent = badge.critical + badge.high;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={
        urgent > 0
          ? t("myPortfolio.tabs.risksBadged", { n: urgent })
          : t("myPortfolio.tabs.risks")
      }
      onClick={onClick}
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-card text-foreground shadow-sm border border-border"
          : urgent > 0
            ? "text-danger hover:text-danger hover:bg-danger/5"
            : "text-muted-foreground hover:text-foreground hover:bg-card/60",
      )}
    >
      <ShieldAlert className="h-3.5 w-3.5" />
      {t("myPortfolio.tabs.risks")}
      {urgent > 0 && (
        <span
          className={cn(
            "ml-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[0.65rem] font-bold leading-none",
            "bg-danger text-danger-foreground animate-pulse",
          )}
        >
          {urgent}
        </span>
      )}
    </button>
  );
}
