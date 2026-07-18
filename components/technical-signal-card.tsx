"use client";

import * as React from "react";
import { TrendingUp, TrendingDown, Minus, Info as InfoIcon, Calculator, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TermTip } from "@/components/term-tip";
import { TechnicalAlertControl } from "@/components/technical-alert-control";
import {
  SIGNAL_CATALOG,
  type Conviction,
  type SignalDefinition,
  type TechnicalSignal,
  type Verdict,
} from "@/lib/technical-signal";
import { useT } from "@/lib/i18n";
import { useIsBeginner } from "@/lib/state";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Verdict presentation
// ---------------------------------------------------------------------------

const CONVICTION_STYLE: Record<
  Conviction,
  { color: string; bg: string; ring: string }
> = {
  high: {
    color: "text-primary",
    bg: "bg-primary/10",
    ring: "ring-primary/30",
  },
  medium: {
    color: "text-warning",
    bg: "bg-warning/10",
    ring: "ring-warning/30",
  },
  low: {
    color: "text-muted-foreground",
    bg: "bg-muted/40",
    ring: "ring-border",
  },
};

// Icon and font sizes intentionally match `MasterVerdictCard` so the
// two hero badges on the /signal page have the same visual weight —
// same column width, same headline font, same icon and score-bar
// dimensions. If you change one, change the other.
const VERDICT_STYLE: Record<
  Verdict,
  { color: string; bg: string; ring: string; icon: React.ReactNode }
> = {
  strong_buy: {
    color: "text-success",
    bg: "bg-success/15",
    ring: "ring-success/40",
    icon: <TrendingUp className="h-6 w-6" />,
  },
  buy: {
    color: "text-success",
    bg: "bg-success/10",
    ring: "ring-success/30",
    icon: <TrendingUp className="h-6 w-6" />,
  },
  hold: {
    color: "text-muted-foreground",
    bg: "bg-muted",
    ring: "ring-border",
    icon: <Minus className="h-6 w-6" />,
  },
  sell: {
    color: "text-danger",
    bg: "bg-danger/10",
    ring: "ring-danger/30",
    icon: <TrendingDown className="h-6 w-6" />,
  },
  strong_sell: {
    color: "text-danger",
    bg: "bg-danger/15",
    ring: "ring-danger/40",
    icon: <TrendingDown className="h-6 w-6" />,
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
    <div className="relative h-2.5 rounded-full bg-muted overflow-hidden">
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
  params,
}: {
  keyId: string;
  detailEn: string;
  weight: number;
  category: string;
  params?: Record<string, string | number>;
}) {
  const t = useT();
  const bullish = weight > 0;
  // Params are forwarded so localized strings can interpolate numeric
  // context (e.g. the Fear & Greed score). Rows whose translations
  // don't reference placeholders are unaffected.
  const localized = t(`ts.row.${keyId}`, params ?? {});
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
        {/* Preserve up to one decimal — MACD halving / volume-halved
            trend can produce fractional weights like 0.5. */}
        {Number.isInteger(weight) ? weight : (Math.round(weight * 10) / 10).toFixed(1)}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Beginner-mode score explainer
// ---------------------------------------------------------------------------

/**
 * Verdict bands ordered from most bullish to most bearish. The thresholds
 * are the *lower bound* (inclusive) of each band, mirroring
 * `VERDICT_THRESHOLDS` in `lib/technical-signal.ts`. Kept as display data
 * so this component doesn't reach into the scorer internals.
 */
const VERDICT_BANDS: Array<{ verdict: Verdict; label: string }> = [
  { verdict: "strong_buy",   label: "> +50"     },
  { verdict: "buy",          label: "+15 → +50" },
  { verdict: "hold",         label: "−15 → +15" },
  { verdict: "sell",         label: "−50 → −15" },
  { verdict: "strong_sell",  label: "< −50"     },
];

/** Small verdict icon sized for the beginner bands list. */
function BandIcon({ verdict, className }: { verdict: Verdict; className?: string }) {
  const cls = cn("h-3 w-3", className);
  switch (verdict) {
    case "strong_buy":
    case "buy":
      return <TrendingUp className={cls} />;
    case "sell":
    case "strong_sell":
      return <TrendingDown className={cls} />;
    default:
      return <Minus className={cls} />;
  }
}

/**
 * Beginner-mode "how was this computed" block. Renders the actual
 * arithmetic behind the verdict — bullish weight, bearish weight, net,
 * max, score — so the number on the badge is transparent instead of
 * feeling like a black-box rating.
 *
 * Hidden entirely in Advanced mode; the About-this-signal tooltip
 * covers that audience already.
 */
function ScoreExplainer({ signal }: { signal: TechnicalSignal }) {
  const t = useT();
  const beginner = useIsBeginner();
  if (!beginner) return null;

  // Derive bullish/bearish weight directly from the signed row weights so
  // we stay consistent with what the user sees listed to the right.
  let bullishWeight = 0;
  let bearishWeight = 0;
  for (const r of signal.rows) {
    if (r.weight > 0) bullishWeight += r.weight;
    else if (r.weight < 0) bearishWeight += -r.weight;
  }
  const netWeight = bullishWeight - bearishWeight;
  const rawScorePct = Math.round(signal.rawScore * 100);
  const scorePct = Math.round(signal.score * 100);
  const agreementApplied = signal.agreementFactor < 0.999; // < 1 with fp tolerance

  const fmtNum = (n: number) => {
    // Preserve up to one decimal for the fractional weights the
    // fading-MACD / volume-halved-trend variants can produce.
    const rounded = Math.round(n * 10) / 10;
    return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(1);
  };
  const fmtSigned = (n: number) => (n > 0 ? `+${fmtNum(n)}` : fmtNum(n));

  return (
    <div className="mt-4 pt-4 border-t border-border/60">
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex h-5 items-center gap-1 rounded-md bg-primary/10 px-1.5 text-[0.65rem] font-bold uppercase tracking-wider text-primary">
          <Calculator className="h-3 w-3" />
          {t("beginner.badge")}
        </span>
        <p className="text-sm font-semibold">{t("ts.explain.title")}</p>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed mb-3">
        {t("ts.explain.intro")}
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        {/* Today's math ------------------------------------------------- */}
        <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
          <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground mb-2">
            {t("ts.explain.stepsLabel")}
          </p>
          <ul className="space-y-1.5 text-xs">
            <li className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">
                {t("ts.explain.stepBullish", { n: signal.bullishCount })}
              </span>
              <span className="font-mono tabular-nums font-semibold text-success">
                +{fmtNum(bullishWeight)}
              </span>
            </li>
            <li className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">
                {t("ts.explain.stepBearish", { n: signal.bearishCount })}
              </span>
              <span className="font-mono tabular-nums font-semibold text-danger">
                −{fmtNum(bearishWeight)}
              </span>
            </li>
            <li className="flex items-baseline justify-between gap-2 pt-1.5 border-t border-border/50">
              <span className="text-muted-foreground">
                {t("ts.explain.stepNet")}
              </span>
              <span
                className={cn(
                  "font-mono tabular-nums font-semibold",
                  netWeight > 0
                    ? "text-success"
                    : netWeight < 0
                      ? "text-danger"
                      : "text-muted-foreground",
                )}
              >
                {fmtSigned(netWeight)}
              </span>
            </li>
            <li className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">
                {t("ts.explain.stepMax")}
              </span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {signal.maxWeight}
              </span>
            </li>
            {/* Raw score — pre-adjustment. Always shown. */}
            <li className="flex items-baseline justify-between gap-2 pt-1.5 border-t border-border/50">
              <span className={cn("text-foreground", !agreementApplied && "font-medium")}>
                {agreementApplied
                  ? t("ts.explain.stepRawScore")
                  : t("ts.explain.stepScore")}
              </span>
              <span
                className={cn(
                  "font-mono tabular-nums font-bold",
                  rawScorePct > 0
                    ? "text-success"
                    : rawScorePct < 0
                      ? "text-danger"
                      : "text-muted-foreground",
                )}
                title={`(${fmtSigned(netWeight)} ÷ ${signal.maxWeight}) × 100`}
              >
                {fmtSigned(rawScorePct)}
              </span>
            </li>

            {/* Only render the adjustment rows when the agreement
                multiplier actually changed the score (i.e. some
                disagreement between bullish and bearish votes). Users
                shouldn't have to reason about "× 1" no-op steps. */}
            {agreementApplied && (
              <>
                <li className="flex items-baseline justify-between gap-2">
                  <span className="text-muted-foreground">
                    {t("ts.explain.stepAgreement", {
                      pct: signal.agreement === null
                        ? "—"
                        : Math.round(signal.agreement * 100),
                    })}
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    × {signal.agreementFactor.toFixed(2)}
                  </span>
                </li>
                <li className="flex items-baseline justify-between gap-2 pt-1.5 border-t border-border/50">
                  <span className="text-foreground font-medium">
                    {t("ts.explain.stepFinalScore")}
                  </span>
                  <span
                    className={cn(
                      "font-mono tabular-nums font-bold",
                      scorePct > 0
                        ? "text-success"
                        : scorePct < 0
                          ? "text-danger"
                          : "text-muted-foreground",
                    )}
                  >
                    {fmtSigned(scorePct)}
                  </span>
                </li>
              </>
            )}
          </ul>
          <p className="mt-2 text-[0.65rem] text-muted-foreground font-mono leading-relaxed">
            ({fmtSigned(netWeight)} ÷ {signal.maxWeight}) × 100 ={" "}
            <span className="text-foreground">{fmtSigned(rawScorePct)}</span>
            {agreementApplied && (
              <>
                {" "}
                × {signal.agreementFactor.toFixed(2)} ={" "}
                <span className="text-foreground">{fmtSigned(scorePct)}</span>
              </>
            )}
          </p>
        </div>

        {/* Verdict bands ------------------------------------------------ */}
        <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
          <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground mb-2">
            {t("ts.explain.bandsLabel")}
          </p>
          <ul className="space-y-1">
            {VERDICT_BANDS.map((band) => {
              const active = band.verdict === signal.verdict;
              const style = VERDICT_STYLE[band.verdict];
              return (
                <li
                  key={band.verdict}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs transition-colors",
                    active
                      ? cn(style.bg, "ring-1", style.ring)
                      : "hover:bg-muted/50",
                  )}
                  aria-current={active ? "true" : undefined}
                >
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 font-medium",
                      active ? style.color : "text-muted-foreground",
                    )}
                  >
                    <BandIcon verdict={band.verdict} />
                    {t(`ts.verdict.${band.verdict}`)}
                  </span>
                  <span
                    className={cn(
                      "font-mono tabular-nums",
                      active ? style.color : "text-muted-foreground",
                    )}
                  >
                    {band.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <SignalCatalogReference signal={signal} />

      <p className="mt-3 text-[0.65rem] text-muted-foreground leading-relaxed">
        {t("ts.explain.disclaimer")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Signal catalog reference — bilingual "here's what each of the 9 signals
// does" table. Renders inside the beginner explainer and shows every entry
// in SIGNAL_CATALOG, badging the ones that are firing today.
// ---------------------------------------------------------------------------

function SignalCatalogReference({ signal }: { signal: TechnicalSignal }) {
  const t = useT();

  // Map contribution keys to catalog rows so we can badge active signals.
  // Built once per render — 9 defs × ~2 keys each, cost is trivial.
  const activeById = React.useMemo(() => {
    const map = new Map<string, "bullish" | "bearish">();
    for (const def of SIGNAL_CATALOG) {
      const row = signal.rows.find((r) => def.contributionKeys.includes(r.key));
      if (row) map.set(def.id, row.weight > 0 ? "bullish" : "bearish");
    }
    return map;
  }, [signal.rows]);

  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 p-2">
      <p className="text-xs font-semibold mb-2 px-1">{t("ts.catalog.title")}</p>

      <ul className="space-y-1">
        {SIGNAL_CATALOG.map((def) => (
          <CatalogRow
            key={def.id}
            def={def}
            active={activeById.get(def.id) ?? null}
            measurement={signal.measurements?.[def.id] ?? ""}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * Single row in the "All signals" catalog.
 *
 * Compact by default — the summary shows only the label, current reading,
 * status chip, and weight. Full bullish/bearish rules appear on click via
 * the native `<details>` disclosure, so the whole block scans in seconds
 * but the depth is still one tap away for anyone who wants it.
 *
 * Row background colour tracks the status (green if firing bullish, red
 * if firing bearish, neutral otherwise) so at-a-glance triage doesn't
 * require opening any row.
 */
function CatalogRow({
  def,
  active,
  measurement,
}: {
  def: SignalDefinition;
  active: "bullish" | "bearish" | null;
  measurement: string;
}) {
  const t = useT();

  // Localized field with English fallback — mirrors the pattern used by the
  // per-contribution `SignalRow`, so a missing translation degrades to the
  // baked-in English string instead of leaking the raw key to the user.
  const localized = (key: string, fallback: string) => {
    const v = t(key);
    return v === key ? fallback : v;
  };

  return (
    <li
      className={cn(
        "rounded-md border transition-colors",
        active === "bullish"
          ? "border-success/40 bg-success/5"
          : active === "bearish"
            ? "border-danger/40 bg-danger/5"
            : "border-border/60 bg-card/50",
      )}
    >
      <details className="group">
        {/* `list-none` + `[&::-webkit-details-marker]:hidden` strip the
            browser's default disclosure triangle so we can control the
            chevron ourselves (rotates via `group-open:` when opened). */}
        <summary className="flex items-center gap-2 px-2 py-1.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:bg-muted/20 rounded-md">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-medium">
                {localized(def.labelKey, def.labelEn)}
              </span>
              {active === "bullish" && (
                <span className="chip chip-bull text-[0.6rem] px-1.5 py-0">
                  <TrendingUp className="h-2.5 w-2.5" />
                  {t("ts.catalog.activeChip")}
                </span>
              )}
              {active === "bearish" && (
                <span className="chip chip-bear text-[0.6rem] px-1.5 py-0">
                  <TrendingDown className="h-2.5 w-2.5" />
                  {t("ts.catalog.activeChip")}
                </span>
              )}
              {active === null && (
                <span className="chip chip-neu text-[0.6rem] px-1.5 py-0">
                  <Minus className="h-2.5 w-2.5" />
                  {t("ts.catalog.silentChip")}
                </span>
              )}
            </div>
            {measurement && (
              <p
                className="text-[0.65rem] text-muted-foreground font-mono tabular-nums mt-0.5 truncate"
                title={measurement}
              >
                {measurement}
              </p>
            )}
          </div>
          <span className="text-[0.6rem] uppercase tracking-wider text-muted-foreground shrink-0 tabular-nums">
            {t("ts.catalog.weightVal", { n: def.maxWeight })}
          </span>
          <ChevronDown
            className="h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform group-open:rotate-180"
            aria-hidden
          />
        </summary>

        <dl className="grid gap-1 sm:grid-cols-2 text-[0.65rem] leading-relaxed px-2 pb-2">
          <div className="rounded-md bg-success/5 border border-success/20 px-1.5 py-1">
            <dt className="text-[0.55rem] uppercase tracking-wider text-success/90 font-semibold">
              {t("ts.catalog.colBullish")}
            </dt>
            <dd className="text-foreground/85 mt-0.5">
              {localized(def.bullishKey, def.bullishEn)}
            </dd>
          </div>
          <div className="rounded-md bg-danger/5 border border-danger/20 px-1.5 py-1">
            <dt className="text-[0.55rem] uppercase tracking-wider text-danger/90 font-semibold">
              {t("ts.catalog.colBearish")}
            </dt>
            <dd className="text-foreground/85 mt-0.5">
              {localized(def.bearishKey, def.bearishEn)}
            </dd>
          </div>
        </dl>
      </details>
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
  const conv = CONVICTION_STYLE[signal.conviction];
  const downgraded = signal.verdict !== signal.rawVerdict;

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
        <div className="flex items-center gap-1.5 shrink-0">
          <TechnicalAlertControl />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground transition-colors"
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
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)] items-start">
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
              <p className={cn("mt-2 text-4xl font-black tabular-nums", s.color)}>
                {scorePct >= 0 ? "+" : ""}
                {scorePct.toFixed(0)}
              </p>
              <p className="text-[0.7rem] text-muted-foreground uppercase tracking-wider">
                {t("ts.scoreLabel")}
              </p>

              {/* Conviction chip — matches the color to the confidence
                  bucket so users can eyeball the reliability of the
                  headline verdict at a glance. */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "mt-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider ring-1 transition-colors",
                      conv.bg,
                      conv.color,
                      conv.ring,
                    )}
                    aria-label={t("ts.conviction.aria")}
                  >
                    {t(`ts.conviction.${signal.conviction}`)}
                    <InfoIcon className="h-3 w-3 opacity-70" aria-hidden />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="font-semibold mb-1">
                    {t(`ts.conviction.${signal.conviction}.title`)}
                  </p>
                  <p className="text-muted-foreground text-[0.7rem] leading-relaxed">
                    {t(`ts.conviction.${signal.conviction}.body`, {
                      cov: Math.round(signal.coverage * 100),
                      agr: signal.agreement === null
                        ? "—"
                        : Math.round(signal.agreement * 100),
                    })}
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>

            {/* Downgrade notice — shown only when a "buy" or "sell"
                was rewritten to "hold" because conviction was low.
                Makes the safety-net behaviour visible. */}
            {downgraded && (
              <div className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1.5">
                <p className="text-[0.7rem] text-warning leading-snug">
                  {t("ts.downgradeNotice", {
                    raw: t(`ts.verdict.${signal.rawVerdict}`),
                  })}
                </p>
              </div>
            )}

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
                      params={row.params}
                    />
                  ))}
              </ul>
            )}
          </div>
        </div>

        <ScoreExplainer signal={signal} />
      </CardContent>
    </Card>
  );
}
