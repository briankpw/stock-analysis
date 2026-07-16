"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { PageHeader } from "@/components/page-header";
import { PageIntro } from "@/components/page-intro";
import { ErrorBanner, LoadingPage, RateLimitBanner } from "@/components/loading";
import { useBundle } from "@/hooks/use-bundle";
import { useUi } from "@/lib/state";
import { Card } from "@/components/ui/card";

// lightweight-charts touches `document` at import time; ensure it only
// loads on the client.
const PriceChart = dynamic(
  () => import("@/components/price-chart").then((m) => m.PriceChart),
  { ssr: false, loading: () => <LoadingPage label="Loading chart engine…" /> },
);

function OverlayToggles() {
  // Individual selectors keep zustand's `useSyncExternalStore` snapshot stable.
  const showSma = useUi((s) => s.showSma);
  const showBb = useUi((s) => s.showBb);
  const toggleSma = useUi((s) => s.toggleSma);
  const toggleBb = useUi((s) => s.toggleBb);
  return (
    <div className="flex items-center gap-4 text-sm">
      <label className="inline-flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={showSma} onChange={toggleSma} className="h-4 w-4 rounded" />
        <span>SMA 20 / 50 / 200</span>
      </label>
      <label className="inline-flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={showBb} onChange={toggleBb} className="h-4 w-4 rounded" />
        <span>Bollinger Bands (20, 2σ)</span>
      </label>
    </div>
  );
}

export default function ChartsPage() {
  const { data, loading, error, reload } = useBundle();

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader pageTitle="Price & Volume" />
      <PageIntro pageKey="charts" />

      {data?.rateLimited && <RateLimitBanner />}
      {error && <ErrorBanner message={error} retry={reload} />}
      {!data && !error && loading && <LoadingPage label="Loading OHLCV…" />}

      {data && (
        <div className="space-y-4 animate-fade-in">
          <Card className="p-4 flex flex-col md:flex-row md:items-center gap-3 justify-between">
            <OverlayToggles />
            <p className="text-xs text-muted-foreground">
              {data.bars.length.toLocaleString()} bars · {data.period} @ {data.interval}
            </p>
          </Card>
          <Card className="p-2">
            {data.bars.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No price history.</div>
            ) : (
              <PriceChart
                bars={data.bars}
                sma20={data.indicators.sma20}
                sma50={data.indicators.sma50}
                sma200={data.indicators.sma200}
                bb20={data.indicators.bb20}
              />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
