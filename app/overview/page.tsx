"use client";

import * as React from "react";
import { HelpCircle, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageIntro } from "@/components/page-intro";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useBundle } from "@/hooks/use-bundle";
import { ErrorBanner, LoadingPage, RateLimitBanner } from "@/components/loading";
import { fmtCurrency, fmtNumber, fmtPercent, fmtSigned, fmtSignedPercent } from "@/lib/format";
import { signalHint } from "@/lib/knowledge";
import { useIsBeginner } from "@/lib/state";
import { cn } from "@/lib/utils";
import type { LatestSignals } from "@/lib/indicators";

// --------------------------------------------------------------------------

function SignalTile({ label, value, mood }: {
  label: string;
  value: string;
  mood: "bull" | "bear" | "neu";
}) {
  const beginner = useIsBeginner();
  const hint = signalHint(label);
  const icon = mood === "bull" ? <TrendingUp className="h-4 w-4" />
             : mood === "bear" ? <TrendingDown className="h-4 w-4" />
             :                    <Minus className="h-4 w-4" />;
  const chipClass = mood === "bull" ? "chip-bull" : mood === "bear" ? "chip-bear" : "chip-neu";

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 justify-between">
        <div className="flex items-center gap-1.5">
          <span className="metric-label">{label}</span>
          {beginner && hint && (
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-medium mb-1">{hint.what}</p>
                {hint.ruleOfThumb && (
                  <p className="text-muted-foreground text-[0.7rem]">{hint.ruleOfThumb}</p>
                )}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <span className={cn("chip", chipClass)}>
          {icon}
          {mood.toUpperCase()}
        </span>
      </div>
      <p className="mt-3 text-lg font-semibold">{value}</p>
    </Card>
  );
}

function moodOfTrend(v: string): "bull" | "bear" | "neu" {
  if (v.includes("Bullish")) return "bull";
  if (v.includes("Bearish")) return "bear";
  return "neu";
}
function moodOfRsi(v: string): "bull" | "bear" | "neu" {
  if (v.includes("Oversold")) return "bull";
  if (v.includes("Overbought")) return "bear";
  return "neu";
}
function moodOfMacd(v: string): "bull" | "bear" | "neu" {
  if (v === "Bullish") return "bull";
  if (v === "Bearish") return "bear";
  return "neu";
}
function moodOfBb(v: string): "bull" | "bear" | "neu" {
  if (v.includes("below")) return "bull";
  if (v.includes("above")) return "bear";
  return "neu";
}

function SignalRow({ signals }: { signals: LatestSignals }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <SignalTile label="Trend" value={signals.trend} mood={moodOfTrend(signals.trend)} />
      <SignalTile label="RSI(14)" value={signals.rsi} mood={moodOfRsi(signals.rsi)} />
      <SignalTile label="MACD" value={signals.macd} mood={moodOfMacd(signals.macd)} />
      <SignalTile label="Bollinger" value={signals.bollinger} mood={moodOfBb(signals.bollinger)} />
    </div>
  );
}

// --------------------------------------------------------------------------

function VerdictCard({ analysis }: { analysis: NonNullable<ReturnType<typeof useBundle>["data"]>["analysis"] }) {
  const score = analysis.overallScore;
  const percent = Math.max(0, Math.min(100, score));
  const tint =
    score >= 65 ? "from-success/40 to-success/5" :
    score >= 45 ? "from-primary/40 to-primary/5" :
    score >= 30 ? "from-warning/40 to-warning/5" :
                  "from-danger/40 to-danger/5";
  const bar =
    score >= 65 ? "bg-success" :
    score >= 45 ? "bg-primary" :
    score >= 30 ? "bg-warning" :
                  "bg-danger";

  const conclusionHtml = analysis.conclusion.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  return (
    <Card className={cn("overflow-hidden p-6 bg-gradient-to-br", tint)}>
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="text-5xl leading-none select-none">{analysis.verdictEmoji}</div>
        <div className="flex-1 min-w-0">
          <p className="metric-label mb-1">Overall verdict</p>
          <h2 className="text-2xl font-bold">{analysis.verdictLabel}</h2>
          <p
            className="mt-2 text-sm text-muted-foreground leading-relaxed"
            dangerouslySetInnerHTML={{ __html: conclusionHtml }}
          />
        </div>
        <div className="md:w-64 shrink-0">
          <div className="flex items-baseline gap-2 justify-between">
            <span className="metric-label">Score</span>
            <span className="text-3xl font-bold tabular-nums">{score.toFixed(1)}</span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
            <div className={cn("h-full transition-all duration-500", bar)} style={{ width: `${percent}%` }} />
          </div>
          <div className="flex justify-between text-[0.65rem] uppercase tracking-wider text-muted-foreground mt-1">
            <span>0</span><span>50</span><span>100</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

// --------------------------------------------------------------------------

function KpiTile({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="kpi-card">
      <p className="metric-label">{label}</p>
      <p className="metric-value mt-1">{value}</p>
      {sub && <p className="text-xs mt-1">{sub}</p>}
    </div>
  );
}

// --------------------------------------------------------------------------

export default function OverviewPage() {
  const { data, loading, error, reload } = useBundle();

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader pageTitle="Overview" />
      <PageIntro pageKey="overview" />

      {data?.rateLimited && <RateLimitBanner />}
      {error && <ErrorBanner message={error} retry={reload} />}
      {!data && !error && loading && <LoadingPage label="Loading market data…" />}

      {data && (
        <div className="space-y-6 animate-fade-in">
          <VerdictCard analysis={data.analysis} />

          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Latest signals
              </h3>
              <span className="text-xs text-muted-foreground">
                as of {new Date(data.fetchedAt).toLocaleString()}
              </span>
            </div>
            {data.signals ? <SignalRow signals={data.signals} /> : <p className="text-sm text-muted-foreground">No price history yet.</p>}
          </section>

          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Snapshot
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiTile
                label="Last Close"
                value={fmtCurrency(data.quote.price)}
                sub={data.quote.change !== null && data.quote.changePercent !== null && (
                  <span className={cn(
                    "font-semibold",
                    data.quote.change > 0 ? "text-success" : data.quote.change < 0 ? "text-danger" : "text-muted-foreground",
                  )}>
                    {fmtSigned(data.quote.change)} ({fmtSignedPercent(data.quote.changePercent)})
                  </span>
                )}
              />
              <KpiTile
                label="Bars"
                value={fmtNumber(data.bars.length, 0)}
                sub={<span className="text-muted-foreground">{data.period} · {data.interval}</span>}
              />
              <KpiTile
                label="Positive signals"
                value={String(data.analysis.positives.length)}
                sub={<span className="text-success">healthy indicators</span>}
              />
              <KpiTile
                label="Concerns"
                value={String(data.analysis.negatives.length)}
                sub={<span className="text-danger">warning indicators</span>}
              />
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Positives ({data.analysis.positives.length})</CardTitle></CardHeader>
              <CardContent>
                {data.analysis.positives.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing stood out as positive.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {data.analysis.positives.map((p, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-success mt-0.5">✓</span>
                        <span>
                          <strong className="mr-1">{p.label}.</strong>
                          <span className="text-muted-foreground">{p.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Concerns ({data.analysis.negatives.length})</CardTitle></CardHeader>
              <CardContent>
                {data.analysis.negatives.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No red flags flagged.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {data.analysis.negatives.map((p, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-danger mt-0.5">✗</span>
                        <span>
                          <strong className="mr-1">{p.label}.</strong>
                          <span className="text-muted-foreground">{p.detail}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>

          <p className="text-xs text-muted-foreground text-center pt-4 pb-8">
            Overall score is a rule-based aggregate over valuation, profitability, health, growth, dividends,
            and technicals — not a trading recommendation. Weights: profitability 25%, valuation 20%,
            health 20%, growth 15%, technicals 10%, momentum 5%, dividend 5%. Yield above 2% is a positive
            weight; yield above 6% is treated as a warning. Assumes only the fundamentals surfaced by Yahoo Finance.
          </p>
        </div>
      )}
    </div>
  );
}
