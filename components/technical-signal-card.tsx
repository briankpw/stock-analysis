"use client";

import * as React from "react";
import { TrendingUp, TrendingDown, Minus, Info as InfoIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TermTip } from "@/components/term-tip";
import type { TechnicalSignal, Verdict } from "@/lib/technical-signal";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Verdict presentation
// ---------------------------------------------------------------------------

const VERDICT_STYLE: Record<
  Verdict,
  { color: string; bg: string; ring: string; icon: React.ReactNode }
> = {
  strong_buy: {
    color: "text-success",
    bg: "bg-success/15",
    ring: "ring-success/40",
    icon: <TrendingUp className="h-5 w-5" />,
  },
  buy: {
    color: "text-success",
    bg: "bg-success/10",
    ring: "ring-success/30",
    icon: <TrendingUp className="h-5 w-5" />,
  },
  hold: {
    color: "text-muted-foreground",
    bg: "bg-muted",
    ring: "ring-border",
    icon: <Minus className="h-5 w-5" />,
  },
  sell: {
    color: "text-danger",
    bg: "bg-danger/10",
    ring: "ring-danger/30",
    icon: <TrendingDown className="h-5 w-5" />,
  },
  strong_sell: {
    color: "text-danger",
    bg: "bg-danger/15",
    ring: "ring-danger/40",
    icon: <TrendingDown className="h-5 w-5" />,
  },
};

/**
 * Diverging horizontal bar: −100% at the left, +100% at the right, needle
 * planted at `score`. Reads well at a glance even if the tooltip / rows
 * below it are ignored.
 */
function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(-1, Math.min(1, score));
  const needleLeft = 50 + pct * 50; // 0 → 50%, +1 → 100%, -1 → 0%
  const positive = pct >= 0;
  const barLeft = positive ? 50 : needleLeft;
  const barWidth = Math.abs(pct) * 50;
  return (
    <div className="relative h-2 rounded-full bg-muted overflow-hidden">
      <div className="absolute inset-y-0" style={{ left: "50%", width: 1, background: "hsl(var(--border))" }} />
      <div
        className={cn("absolute inset-y-0 transition-all", positive ? "bg-success" : "bg-danger")}
        style={{ left: `${barLeft}%`, width: `${barWidth}%` }}
      />
      <div
        className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-foreground"
        style={{ left: `calc(${needleLeft}% - 1px)` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contributor row
// ---------------------------------------------------------------------------

function SignalRow({
  keyId,
  detailEn,
  weight,
  category,
}: {
  keyId: string;
  detailEn: string;
  weight: number;
  category: string;
}) {
  const t = useT();
  const bullish = weight > 0;
  const localized = t(`ts.row.${keyId}`, {});
  const label = localized === `ts.row.${keyId}` ? detailEn : localized;
  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-start gap-3 py-2 border-b border-border/50 last:border-0">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-md",
          bullish ? "bg-success/15 text-success" : "bg-danger/15 text-danger",
        )}
      >
        {bullish ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0">
        <p className="text-sm leading-snug">{label}</p>
        <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground mt-0.5">
          {t(`ts.cat.${category}`)}
        </p>
      </div>
      <span
        className={cn(
          "text-xs font-mono font-semibold tabular-nums shrink-0 self-center",
          bullish ? "text-success" : "text-danger",
        )}
      >
        {bullish ? "+" : ""}
        {weight}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main card
// ---------------------------------------------------------------------------

export function TechnicalSignalCard({ signal }: { signal: TechnicalSignal }) {
  const t = useT();
  const s = VERDICT_STYLE[signal.verdict];
  const scorePct = signal.score * 100;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <TermTip term="Technical Signal">{t("ts.title")}</TermTip>
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1 max-w-md">
            {t("ts.subtitle")}
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
              aria-label={t("ts.disclaimer.label")}
            >
              <InfoIcon className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="font-medium mb-1">{t("ts.disclaimer.title")}</p>
            <p className="text-muted-foreground text-[0.7rem] leading-relaxed">
              {t("ts.disclaimer.body")}
            </p>
          </TooltipContent>
        </Tooltip>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)] items-start">
          <div>
            <div
              className={cn(
                "flex flex-col items-center rounded-xl px-4 py-5 ring-1",
                s.bg,
                s.ring,
              )}
            >
              <span className={cn("inline-flex items-center gap-2", s.color)}>
                {s.icon}
                <span className="text-lg font-bold uppercase tracking-wide">
                  {t(`ts.verdict.${signal.verdict}`)}
                </span>
              </span>
              <p className={cn("mt-2 text-3xl font-black tabular-nums", s.color)}>
                {scorePct >= 0 ? "+" : ""}
                {scorePct.toFixed(0)}
              </p>
              <p className="text-[0.7rem] text-muted-foreground uppercase tracking-wider">
                {t("ts.scoreLabel")}
              </p>
            </div>

            <div className="mt-3">
              <div className="flex justify-between text-[0.65rem] text-muted-foreground mb-1">
                <span>−100</span>
                <span>0</span>
                <span>+100</span>
              </div>
              <ScoreBar score={signal.score} />
              <div className="mt-2 flex justify-between text-[0.65rem]">
                <span className="text-danger">
                  {t("ts.bearishCount", { n: signal.bearishCount })}
                </span>
                <span className="text-muted-foreground">
                  {t("ts.confidence", {
                    pct: Math.round(signal.confidence * 100),
                  })}
                </span>
                <span className="text-success">
                  {t("ts.bullishCount", { n: signal.bullishCount })}
                </span>
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {t("ts.contributors", { n: signal.rows.length })}
            </p>
            {signal.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("ts.noContribs")}</p>
            ) : (
              <ul className="rounded-lg border border-border/60">
                {signal.rows
                  .slice()
                  .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
                  .map((row) => (
                    <SignalRow
                      key={row.key}
                      keyId={row.key}
                      detailEn={row.detailEn}
                      weight={row.weight}
                      category={row.category}
                    />
                  ))}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
