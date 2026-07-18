"use client";

import { Gauge } from "lucide-react";
import { PageIntro } from "@/components/page-intro";
import { KeyTerms } from "@/components/key-terms";
import { FearGreedCard } from "@/components/fear-greed-card";
import { useT } from "@/lib/i18n";

/**
 * Market Mood — a dedicated home for market-wide indicators that colour
 * every ticker's read but don't depend on which one is selected.
 *
 * Right now it hosts CNN's Fear & Greed Index; leaving the page open-ended
 * so future broadcasts (VIX standalone card, sector heatmap, etc.) can
 * drop in next to it.
 *
 * The segment-analysis surface has its own top-level sidebar entry
 * (`Market → Segments`), so we don't duplicate a discoverability nudge
 * for it here — that just added a redundant tap target on a page whose
 * job is to focus on market-wide mood.
 */
export default function MarketPage() {
  const t = useT();

  return (
    <div className="mx-auto max-w-7xl">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-5 lg:pb-6 border-b border-border mb-5 lg:mb-6">
        <div className="min-w-0">
          <p className="metric-label mb-1">{t("nav.market")}</p>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary shrink-0">
              <Gauge className="h-5 w-5" />
            </span>
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight">
              {t("market.heading")}
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            {t("market.subheading")}
          </p>
        </div>
      </header>

      <PageIntro pageKey="market" />

      <div className="space-y-6 animate-fade-in">
        <FearGreedCard />

        <KeyTerms
          terms={[
            "Fear & Greed Index",
            "VIX",
            "Put/Call Ratio",
            "Market Breadth",
            "Safe Haven Demand",
            "Contrarian",
          ]}
        />
      </div>
    </div>
  );
}
