"use client";

import dynamic from "next/dynamic";
import { PageHeader } from "@/components/page-header";
import { PageIntro } from "@/components/page-intro";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner, LoadingPage, RateLimitBanner } from "@/components/loading";
import { useBundle } from "@/hooks/use-bundle";

const RsiChart = dynamic(
  () => import("@/components/indicator-charts").then((m) => m.RsiChart),
  { ssr: false, loading: () => <LoadingPage label="Loading RSI…" /> },
);
const MacdChart = dynamic(
  () => import("@/components/indicator-charts").then((m) => m.MacdChart),
  { ssr: false, loading: () => <LoadingPage label="Loading MACD…" /> },
);
const ReturnsHistogram = dynamic(
  () => import("@/components/indicator-charts").then((m) => m.ReturnsHistogram),
  { ssr: false },
);

export default function IndicatorsPage() {
  const { data, loading, error, reload } = useBundle();

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader pageTitle="Technical Indicators" />
      <PageIntro pageKey="indicators" />

      {data?.rateLimited && <RateLimitBanner />}
      {error && <ErrorBanner message={error} retry={reload} />}
      {!data && !error && loading && <LoadingPage label="Computing indicators…" />}

      {data && (
        <div className="grid gap-4 lg:grid-cols-2 animate-fade-in">
          <Card>
            <CardHeader>
              <CardTitle>RSI (14)</CardTitle>
              <p className="text-xs text-muted-foreground">Momentum oscillator. Above 70 = overbought, below 30 = oversold.</p>
            </CardHeader>
            <CardContent><RsiChart bars={data.bars} rsi14={data.indicators.rsi14} /></CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>MACD (12, 26, 9)</CardTitle>
              <p className="text-xs text-muted-foreground">MACD line vs signal line; the histogram shows their spread.</p>
            </CardHeader>
            <CardContent><MacdChart bars={data.bars} macd={data.indicators.macd} /></CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Daily returns distribution</CardTitle>
              <p className="text-xs text-muted-foreground">
                Histogram of day-over-day percent returns. Wide bell = volatile; tight peak = calm.
              </p>
            </CardHeader>
            <CardContent>
              <div className="w-full" style={{ height: 260 }}>
                <ReturnsHistogram returns={data.indicators.returns} height={260} />
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
