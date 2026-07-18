"use client";

/**
 * Charts & Indicators — the price+volume chart plus the classic
 * momentum indicators, on one page.
 *
 * Layout (top → bottom):
 *   1. Overlay toggle bar (EMA / SMA / Bollinger)
 *   2. Candlestick + volume chart
 *   3. RSI · MACD · KDJ  (two-column grid on ≥ lg)
 *   4. Support / Resistance (full-width)
 *   5. Daily returns histogram (full-width)
 *
 * Consolidates what used to live on `/charts` and `/indicators` into a
 * single view — everything below is derived from the same
 * `useBundle()` payload, so no extra fetches were introduced by the
 * merge.
 */

import * as React from "react";
import dynamic from "next/dynamic";
import { PageHeader } from "@/components/page-header";
import { PageIntro } from "@/components/page-intro";
import { KeyTerms } from "@/components/key-terms";
import { TermTip } from "@/components/term-tip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner, LoadingPage, RateLimitBanner } from "@/components/loading";
import { useBundle } from "@/hooks/use-bundle";
import { useUi } from "@/lib/state";
import { useT } from "@/lib/i18n";

// lightweight-charts touches `document` at import time; ensure it only
// loads on the client.
const PriceChart = dynamic(
  () => import("@/components/price-chart").then((m) => m.PriceChart),
  { ssr: false, loading: () => <LoadingPage label="Loading chart engine…" /> },
);
const RsiChart = dynamic(
  () => import("@/components/indicator-charts").then((m) => m.RsiChart),
  { ssr: false, loading: () => <LoadingPage label="…" /> },
);
const MacdChart = dynamic(
  () => import("@/components/indicator-charts").then((m) => m.MacdChart),
  { ssr: false, loading: () => <LoadingPage label="…" /> },
);
const KdjChart = dynamic(
  () => import("@/components/indicator-charts").then((m) => m.KdjChart),
  { ssr: false, loading: () => <LoadingPage label="…" /> },
);
const ReturnsHistogram = dynamic(
  () => import("@/components/indicator-charts").then((m) => m.ReturnsHistogram),
  { ssr: false },
);
const SupportResistanceChart = dynamic(
  () => import("@/components/indicator-charts").then((m) => m.SupportResistanceChart),
  { ssr: false, loading: () => <LoadingPage label="…" /> },
);
const SupportResistanceTable = dynamic(
  () => import("@/components/indicator-charts").then((m) => m.SupportResistanceTable),
  { ssr: false },
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

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader pageTitleKey="nav.charts" />
      <PageIntro pageKey="charts" />

      {data?.rateLimited && <RateLimitBanner />}
      {error && <ErrorBanner message={error} retry={reload} />}
      {!data && !error && loading && <LoadingPage label={t("loading.ohlcv")} />}

      {data && (
        <div className="space-y-4 animate-fade-in">
          {/* -------- Price & volume section -------- */}
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

          {/* -------- Indicators section --------
              Section divider so the visual break between "price" and
              "momentum indicators" is unambiguous — otherwise five
              additional cards below the chart just look like more of
              the same. */}
          <div className="pt-2 flex items-baseline justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("charts.indicatorsHeading")}
            </h3>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>
                  <TermTip term="RSI">RSI</TermTip> (14)
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {t("indicators.rsi.subtitle")}
                </p>
              </CardHeader>
              <CardContent><RsiChart bars={data.bars} rsi14={data.indicators.rsi14} /></CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>
                  <TermTip term="MACD">MACD</TermTip> (12, 26, 9)
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {t("indicators.macd.subtitle")}
                </p>
              </CardHeader>
              <CardContent><MacdChart bars={data.bars} macd={data.indicators.macd} /></CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>
                  <TermTip term="KDJ">KDJ</TermTip> (9, 3, 3)
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {t("indicators.kdj.subtitle")}
                </p>
              </CardHeader>
              <CardContent><KdjChart bars={data.bars} kdj={data.indicators.kdj} /></CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t("indicators.returns.title")}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {t("indicators.returns.subtitle")}
                </p>
              </CardHeader>
              <CardContent>
                <div className="w-full" style={{ height: 260 }}>
                  <ReturnsHistogram returns={data.indicators.returns} height={260} />
                </div>
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>
                  <TermTip term="Support">{t("indicators.sr.title")}</TermTip>
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {t("indicators.sr.subtitle")}
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <SupportResistanceChart
                    bars={data.bars}
                    levels={data.indicators.levels}
                    height={300}
                  />
                  <SupportResistanceTable
                    bars={data.bars}
                    levels={data.indicators.levels}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          <KeyTerms
            terms={[
              "Candlestick",
              "OHLC",
              "Wick",
              "Volume",
              "EMA",
              "SMA",
              "Bollinger Bands",
              "52-Week High",
              "52-Week Low",
              "Golden Cross",
              "Death Cross",
              "RSI",
              "Overbought",
              "Oversold",
              "MACD",
              "Signal Line",
              "Histogram",
              "Divergence",
              "KDJ",
              "Stochastic Oscillator",
              "Support",
              "Resistance",
              "Daily Returns Distribution",
              "Volatility",
            ]}
          />
        </div>
      )}
    </div>
  );
}
