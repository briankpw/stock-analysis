"use client";

/**
 * Technical Signal page — the composite "should I trade?" view.
 *
 * Consolidates three cards that previously lived on three different
 * pages:
 *
 *   • Master Verdict + full source breakdown (was on /overview)
 *   • Technical Signal (was on /charts)
 *   • 6-Signal Resonance strategy (was on /indicators)
 *
 * All three feed off the same `useBundle()` payload plus the two
 * optional `useFearGreed()` / `useNews()` inputs the master verdict
 * blends in. Each sub-input is optional — the master card downgrades
 * coverage gracefully when a source is unreachable, so a slow news
 * fetch never blocks the rest of the page from rendering.
 */

import * as React from "react";
import { PageHeader } from "@/components/page-header";
import { PageIntro } from "@/components/page-intro";
import { KeyTerms } from "@/components/key-terms";
import { MasterVerdictCard } from "@/components/master-verdict-card";
import { TechnicalSignalCard } from "@/components/technical-signal-card";
import { ResonanceCard } from "@/components/resonance-card";
import { ErrorBanner, LoadingPage, RateLimitBanner } from "@/components/loading";
import { useBundle } from "@/hooks/use-bundle";
import { useFearGreed } from "@/hooks/use-fear-greed";
import { useNews } from "@/hooks/use-news";
import { useT } from "@/lib/i18n";
import { computeTechnicalSignal } from "@/lib/technical-signal";
import { computeResonance } from "@/lib/resonance";
import { computeMasterVerdict } from "@/lib/master-verdict";

export default function SignalPage() {
  const { data, loading, error, reload } = useBundle();
  const { data: fearGreed } = useFearGreed();
  const { data: news } = useNews();
  const t = useT();

  // Same computation triplet as the old /overview page — kept in this
  // order (technical → resonance → master) because the master blends the
  // first two.
  const technical = React.useMemo(() => {
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
      fearGreedScore: fearGreed?.score ?? null,
    });
  }, [data, fearGreed]);

  const resonance = React.useMemo(
    () => (data && data.bars.length > 0 ? computeResonance(data.bars) : null),
    [data],
  );

  const master = React.useMemo(() => {
    if (!data) return null;
    return computeMasterVerdict({
      technical,
      resonance,
      fundamentals: data.analysis,
      sentiment: news?.aggregate ?? null,
      fearGreedScore: fearGreed?.score ?? null,
    });
  }, [data, technical, resonance, news, fearGreed]);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader pageTitleKey="nav.signal" />
      <PageIntro pageKey="signal" />

      {data?.rateLimited && <RateLimitBanner />}
      {error && <ErrorBanner message={error} retry={reload} />}
      {!data && !error && loading && <LoadingPage label={t("loading.marketData")} />}

      {data && (
        <div className="space-y-4 animate-fade-in">
          {master && <MasterVerdictCard verdict={master} />}
          {technical && (
            <div id="technical" className="scroll-mt-6">
              <TechnicalSignalCard signal={technical} />
            </div>
          )}
          {resonance && (
            <div id="resonance" className="scroll-mt-6">
              <ResonanceCard result={resonance} />
            </div>
          )}

          <KeyTerms
            terms={[
              "Technical Signal",
              "Conviction",
              "Agreement",
              "6-Signal Resonance",
              "Resonance",
              "Buy day",
              "Hold day",
              "Sell day",
              "Avoid day",
              "Out",
              "BBI",
              "LWR",
              "MTM",
              "Fear & Greed Index",
              "Contrarian",
              "Signal",
              "Cross Event",
            ]}
          />
        </div>
      )}
    </div>
  );
}
