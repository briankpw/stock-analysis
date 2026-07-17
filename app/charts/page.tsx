"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { PageHeader } from "@/components/page-header";
import { PageIntro } from "@/components/page-intro";
import { KeyTerms } from "@/components/key-terms";
import { TermTip } from "@/components/term-tip";
import { TechnicalSignalCard } from "@/components/technical-signal-card";
import { ErrorBanner, LoadingPage, RateLimitBanner } from "@/components/loading";
import { useBundle } from "@/hooks/use-bundle";
import { useUi } from "@/lib/state";
import { useT } from "@/lib/i18n";
import { computeTechnicalSignal } from "@/lib/technical-signal";
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
  const showEma = useUi((s) => s.showEma);
  const showBb = useUi((s) => s.showBb);
  const toggleSma = useUi((s) => s.toggleSma);
  const toggleEma = useUi((s) => s.toggleEma);
  const toggleBb = useUi((s) => s.toggleBb);
  return (
    <div className="flex items-center gap-4 text-sm flex-wrap">
      <label className="inline-flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={showEma} onChange={toggleEma} className="h-4 w-4 rounded" />
        <span>
          <TermTip term="EMA">EMA</TermTip> 24 / 52 / 200
        </span>
      </label>
      <label className="inline-flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={showSma} onChange={toggleSma} className="h-4 w-4 rounded" />
        <span>
          <TermTip term="SMA">SMA</TermTip> 20 / 50 / 200
        </span>
      </label>
      <label className="inline-flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={showBb} onChange={toggleBb} className="h-4 w-4 rounded" />
        <span>
          <TermTip term="Bollinger Bands">Bollinger Bands</TermTip> (20, 2σ)
        </span>
      </label>
    </div>
  );
}

export default function ChartsPage() {
  const { data, loading, error, reload } = useBundle();
  const t = useT();

  // Compute the technical Buy/Sell verdict from what's already on the
  // page — everything below the chart is derived from `data.indicators`
  // and `data.bars`, so no extra fetch is needed.
  const signal = React.useMemo(() => {
    if (!data || data.bars.length === 0) return null;
    return computeTechnicalSignal({
      bars: data.bars,
      sma50: data.indicators.sma50,
      sma200: data.indicators.sma200,
      rsi14: data.indicators.rsi14,
      macd: data.indicators.macd,
      bb20: data.indicators.bb20,
      levels: data.indicators.levels,
      kdj: data.indicators.kdj,
    });
  }, [data]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader pageTitleKey="nav.charts" />
      <PageIntro pageKey="charts" />

      {data?.rateLimited && <RateLimitBanner />}
      {error && <ErrorBanner message={error} retry={reload} />}
      {!data && !error && loading && <LoadingPage label={t("loading.ohlcv")} />}

      {data && (
        <div className="space-y-4 animate-fade-in">
          {signal && <TechnicalSignalCard signal={signal} />}

          <Card className="p-4 flex flex-col md:flex-row md:items-center gap-3 justify-between">
            <OverlayToggles />
            <p className="text-xs text-muted-foreground">
              {t("charts.meta", { count: data.bars.length.toLocaleString(), period: data.period, interval: data.interval })}
            </p>
          </Card>
          <Card className="p-2">
            {data.bars.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">{t("charts.noHistory")}</div>
            ) : (
              <PriceChart
                bars={data.bars}
                sma20={data.indicators.sma20}
                sma50={data.indicators.sma50}
                sma200={data.indicators.sma200}
                ema24={data.indicators.ema24}
                ema52={data.indicators.ema52}
                ema200={data.indicators.ema200}
                bb20={data.indicators.bb20}
              />
            )}
          </Card>

          <KeyTerms
            terms={[
              "Candlestick",
              "OHLC",
              "Wick",
              "Volume",
              "EMA",
              "SMA",
              "Bollinger Bands",
              "Support",
              "Resistance",
              "52-Week High",
              "52-Week Low",
              "Volatility",
              "Golden Cross",
              "Death Cross",
              "Technical Signal",
            ]}
          />
        </div>
      )}
    </div>
  );
}
