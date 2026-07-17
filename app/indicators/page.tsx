"use client";

import dynamic from "next/dynamic";
import { PageHeader } from "@/components/page-header";
import { PageIntro } from "@/components/page-intro";
import { KeyTerms } from "@/components/key-terms";
import { TermTip } from "@/components/term-tip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorBanner, LoadingPage, RateLimitBanner } from "@/components/loading";
import { useBundle } from "@/hooks/use-bundle";
import { useT } from "@/lib/i18n";

const RsiChart = dynamic(
  () => import("@/components/indicator-charts").then((m) => m.RsiChart),
  { ssr: false, loading: () => <LoadingPage label="…" /> },
);
const MacdChart = dynamic(
  () => import("@/components/indicator-charts").then((m) => m.MacdChart),
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

export default function IndicatorsPage() {
  const { data, loading, error, reload } = useBundle();
  const t = useT();

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader pageTitleKey="nav.indicators" />
      <PageIntro pageKey="indicators" />

      {data?.rateLimited && <RateLimitBanner />}
      {error && <ErrorBanner message={error} retry={reload} />}
      {!data && !error && loading && <LoadingPage label={t("loading.indicators")} />}

      {data && (
        <>
          <div className="grid gap-4 lg:grid-cols-2 animate-fade-in">
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
            <Card className="lg:col-span-2">
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
          </div>

          <KeyTerms
            terms={[
              "RSI",
              "Overbought",
              "Oversold",
              "MACD",
              "Signal Line",
              "Histogram",
              "EMA",
              "Divergence",
              "Support",
              "Resistance",
              "Daily Returns Distribution",
              "Volatility",
            ]}
          />
        </>
      )}
    </div>
  );
}
