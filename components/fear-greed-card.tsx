"use client";

import * as React from "react";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TermTip } from "@/components/term-tip";
import { useFearGreed } from "@/hooks/use-fear-greed";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { FearGreedRating } from "@/app/api/fear-greed/route";

// ---------------------------------------------------------------------------
// Colour + label utilities
// ---------------------------------------------------------------------------

/** CNN uses 5 rating buckets on a 0–100 scale. */
export function ratingFromScore(score: number): FearGreedRating {
  if (score < 25) return "extreme fear";
  if (score < 45) return "fear";
  if (score <= 55) return "neutral";
  if (score <= 75) return "greed";
  return "extreme greed";
}

const RATING_COLORS: Record<FearGreedRating, string> = {
  "extreme fear": "#c0392b",
  fear: "#e67e22",
  neutral: "#c9a227",
  greed: "#7bc96f",
  "extreme greed": "#2ea44f",
};

function colorForScore(score: number): string {
  return RATING_COLORS[ratingFromScore(score)];
}

// ---------------------------------------------------------------------------
// Semicircular gauge (pure SVG — no chart dep)
// ---------------------------------------------------------------------------

function Gauge({ score, size = 260 }: { score: number; size?: number }) {
  const cx = size / 2;
  const cy = size * 0.62;
  const r = size * 0.42;
  const strokeW = size * 0.09;
  const clamped = Math.max(0, Math.min(100, score));
  // Semi-circle spans 180°: 0 → left, 100 → right (angle 180° → 0°).
  const angle = 180 - (clamped / 100) * 180;
  const rad = (angle * Math.PI) / 180;
  const needleR = r - strokeW * 0.15;
  const nx = cx + needleR * Math.cos(rad);
  const ny = cy - needleR * Math.sin(rad);

  // Coloured segments — five 20-point buckets.
  const segments: Array<{ from: number; to: number; color: string }> = [
    { from: 0,  to: 20,  color: RATING_COLORS["extreme fear"] },
    { from: 20, to: 40,  color: RATING_COLORS.fear },
    { from: 40, to: 60,  color: RATING_COLORS.neutral },
    { from: 60, to: 80,  color: RATING_COLORS.greed },
    { from: 80, to: 100, color: RATING_COLORS["extreme greed"] },
  ];
  const arc = (from: number, to: number) => {
    const a1 = ((180 - (from / 100) * 180) * Math.PI) / 180;
    const a2 = ((180 - (to / 100) * 180) * Math.PI) / 180;
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy - r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy - r * Math.sin(a2);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };

  return (
    <svg
      viewBox={`0 0 ${size} ${size * 0.72}`}
      className="w-full h-auto"
      role="img"
      aria-label={`Fear & Greed Index gauge showing ${clamped.toFixed(0)}`}
    >
      {segments.map((s) => (
        <path
          key={s.from}
          d={arc(s.from, s.to)}
          fill="none"
          stroke={s.color}
          strokeWidth={strokeW}
          strokeLinecap="butt"
          opacity={0.85}
        />
      ))}
      {[0, 25, 50, 75, 100].map((tick) => {
        const a = ((180 - (tick / 100) * 180) * Math.PI) / 180;
        const x1 = cx + (r - strokeW * 0.65) * Math.cos(a);
        const y1 = cy - (r - strokeW * 0.65) * Math.sin(a);
        const x2 = cx + (r + strokeW * 0.1) * Math.cos(a);
        const y2 = cy - (r + strokeW * 0.1) * Math.sin(a);
        const lx = cx + (r + strokeW * 0.8) * Math.cos(a);
        const ly = cy - (r + strokeW * 0.8) * Math.sin(a);
        return (
          <g key={tick}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" opacity="0.35" strokeWidth={1.5} />
            <text
              x={lx}
              y={ly}
              fontSize={size * 0.045}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="currentColor"
              opacity={0.6}
            >
              {tick}
            </text>
          </g>
        );
      })}
      <line
        x1={cx}
        y1={cy}
        x2={nx}
        y2={ny}
        stroke="currentColor"
        strokeWidth={size * 0.014}
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r={size * 0.032} fill="currentColor" />
      <text
        x={cx}
        y={cy - size * 0.13}
        fontSize={size * 0.18}
        fontWeight={700}
        textAnchor="middle"
        fill={colorForScore(clamped)}
      >
        {clamped.toFixed(0)}
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Small "previous" row (yesterday / 1w / 1m / 1y)
// ---------------------------------------------------------------------------

function PreviousRow({
  labels,
  values,
}: {
  labels: [string, string, string, string];
  values: [number, number, number, number];
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {labels.map((label, i) => {
        const v = values[i]!;
        return (
          <div
            key={label}
            className="rounded-md border border-border/60 bg-card/40 p-2 text-center"
          >
            <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
              {label}
            </p>
            <p
              className="mt-1 text-sm font-semibold tabular-nums"
              style={{ color: colorForScore(v) }}
            >
              {v.toFixed(0)}
            </p>
            <p className="text-[0.6rem] text-muted-foreground capitalize">
              {ratingFromScore(v)}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

const INDICATOR_KEYS: Record<string, string> = {
  market_momentum_sp500: "fg.ind.marketMomentum",
  stock_price_strength: "fg.ind.stockPriceStrength",
  stock_price_breadth: "fg.ind.stockPriceBreadth",
  put_call_options: "fg.ind.putCallOptions",
  market_volatility_vix: "fg.ind.vix",
  junk_bond_demand: "fg.ind.junkBondDemand",
  safe_haven_demand: "fg.ind.safeHavenDemand",
};

export function FearGreedCard() {
  const { data, loading, error, reload } = useFearGreed();
  const t = useT();

  const rating = data ? data.rating : null;
  const ratingColor = data ? colorForScore(data.score) : undefined;
  const ratingLabelKey = rating ? `fg.rating.${rating.replace(" ", "_")}` : "";

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <TermTip term="Fear & Greed Index">
              {t("fg.title")}
            </TermTip>
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {t("fg.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <button
            type="button"
            onClick={reload}
            className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            aria-label={t("common.retry")}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <a
            href="https://edition.cnn.com/markets/fear-and-greed"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
          >
            CNN
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </CardHeader>
      <CardContent>
        {error && !data && (
          <p className="text-sm text-danger">
            {t("fg.error")}: <span className="text-muted-foreground">{error}</span>
          </p>
        )}
        {!data && loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("fg.loading")}
          </div>
        )}
        {data && (
          <div className="grid gap-4 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)] items-start">
            <div className="flex flex-col items-center">
              <Gauge score={data.score} />
              <p
                className="mt-1 text-lg font-semibold uppercase tracking-wide"
                style={{ color: ratingColor }}
              >
                {t(ratingLabelKey)}
              </p>
              <p className="text-[0.7rem] text-muted-foreground mt-0.5">
                {t("fg.updated", { time: new Date(data.updatedAt).toLocaleDateString() })}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {t("fg.timeline")}
                </p>
                <PreviousRow
                  labels={[
                    t("fg.prev.close"),
                    t("fg.prev.week"),
                    t("fg.prev.month"),
                    t("fg.prev.year"),
                  ]}
                  values={[
                    data.previous.close,
                    data.previous.week,
                    data.previous.month,
                    data.previous.year,
                  ]}
                />
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {t("fg.components")}
                </p>
                <ul className="space-y-1.5">
                  {data.indicators.map((ind) => {
                    const label = INDICATOR_KEYS[ind.key]
                      ? t(INDICATOR_KEYS[ind.key]!)
                      : ind.key;
                    const c = colorForScore(ind.score);
                    return (
                      <li
                        key={ind.key}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="truncate">{label}</p>
                          <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full transition-all"
                              style={{
                                width: `${Math.max(0, Math.min(100, ind.score))}%`,
                                background: c,
                              }}
                            />
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-mono tabular-nums font-semibold" style={{ color: c }}>
                            {ind.score.toFixed(0)}
                          </span>
                          <p className="text-[0.6rem] text-muted-foreground capitalize">
                            {ind.rating}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <p className={cn("text-[0.65rem] text-muted-foreground", data.cached ? "" : "opacity-0")}>
                {t("fg.cachedNote")}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
