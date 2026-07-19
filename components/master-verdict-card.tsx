"use client";

/**
 * MasterVerdictCard — the single "should I buy or sell?" hero card.
 *
 * Consumes a `MasterVerdict` computed by `lib/master-verdict.ts` and
 * renders:
 *
 *   • A big verdict badge (Strong Buy → Strong Sell) with the fused
 *     score on a diverging −100 / +100 bar.
 *   • Coverage + agreement chips so users see *how much of the picture
 *     was available* and *how much the pieces agreed with each other*
 *     — the two-axis honesty that a single "confidence" number can't
 *     capture (see the analyst review).
 *   • A regime chip that mirrors the technical signal's bull / bear /
 *     flat label so the reader has trend context at a glance.
 *   • Top drivers list — ranked by absolute contribution, bullish
 *     first — so the "why" is right next to the "what".
 *   • Per-source breakdown table with normalized score, effective
 *     weight, and signed contribution. Regime-discounted rows are
 *     tagged inline so users aren't confused by "why is sentiment's
 *     weight lower than the table says".
 *   • Beginner-mode explainer — reveals the weighted-average math and
 *     the source weights, mirroring the pattern already used by
 *     TechnicalSignalCard so users get consistent depth.
 */

import * as React from "react";
import Link from "next/link";
import {
  TrendingUp, TrendingDown, Minus, Info as InfoIcon,
  Calculator, Compass, Scale,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TermTip } from "@/components/term-tip";
import { MasterAlertControl } from "@/components/master-alert-control";
import type { MasterSource, MasterVerdict } from "@/lib/master-verdict";
import { SOURCE_WEIGHTS } from "@/lib/master-verdict";
import type { Verdict } from "@/lib/technical-signal";
import { useT } from "@/lib/i18n";
import { useIsBeginner } from "@/lib/state";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Verdict presentation — reuses the same 5-band vocabulary as the
// technical signal so users only learn one scale.
// ---------------------------------------------------------------------------

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
 * Diverging −100/+100 bar with the needle planted at `score`. Reads at
 * a glance even for users who ignore everything else on the card.
 */
function ScoreBar({ score }: { score: number }) {
  const pct = Math.max(-1, Math.min(1, score));
  const needleLeft = 50 + pct * 50;
  const positive = pct >= 0;
  const barLeft = positive ? 50 : needleLeft;
  const barWidth = Math.abs(pct) * 50;
  return (
    <div className="relative h-2.5 rounded-full bg-muted overflow-hidden">
      <div
        className="absolute inset-y-0"
        style={{ left: "50%", width: 1, background: "hsl(var(--border))" }}
      />
      <div
        className={cn(
          "absolute inset-y-0 transition-all",
          positive ? "bg-success" : "bg-danger",
        )}
        style={{ left: `${barLeft}%`, width: `${barWidth}%` }}
      />
      <div
        className="absolute top-1/2 h-3.5 w-0.5 -translate-y-1/2 rounded-full bg-foreground"
        style={{ left: `calc(${needleLeft}% - 1px)` }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Regime chip — bull / bear / flat context so the reader knows which
// trend backdrop the master verdict sits in.
// ---------------------------------------------------------------------------

function RegimeChip({ regime }: { regime: MasterVerdict["regime"] }) {
  const t = useT();
  const style =
    regime === "bull"
      ? "chip-bull"
      : regime === "bear"
        ? "chip-bear"
        : "chip-neu";
  const icon =
    regime === "bull" ? (
      <TrendingUp className="h-3 w-3" />
    ) : regime === "bear" ? (
      <TrendingDown className="h-3 w-3" />
    ) : (
      <Minus className="h-3 w-3" />
    );
  return (
    <span
      className={cn("chip text-[0.65rem]", style)}
      title={t("master.regime.tooltip")}
    >
      <Compass className="h-3 w-3" />
      {t(`master.regime.${regime}`)} {icon}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Per-source row (used in both the top-drivers list and the full table)
// ---------------------------------------------------------------------------

/**
 * Localises a source's rationale via i18n with English fallback. Kept
 * as a helper so both the top-reasons list and the breakdown table use
 * the same rendering path.
 */
function sourceRationale(src: MasterSource, t: (k: string, p?: Record<string, string | number>) => string): string {
  const localized = t(src.rationaleKey, src.rationaleParams);
  if (localized !== src.rationaleKey) return localized;
  return src.rationaleEn;
}

function sourceLabel(src: MasterSource, t: (k: string) => string): string {
  const localized = t(src.labelKey);
  if (localized !== src.labelKey) return localized;
  return src.labelEn;
}

/**
 * A single row in the top-drivers list. Uses the same visual language
 * as `TechnicalSignalCard`'s `SignalRow` for consistency: coloured
 * bullish/bearish icon on the left, rationale in the middle, signed
 * contribution on the right.
 */
function ReasonRow({ src }: { src: MasterSource }) {
  const t = useT();
  if (src.score === null || src.contribution === null) return null;
  const bullish = src.contribution > 0;
  const label = sourceLabel(src, t);
  const rationale = sourceRationale(src, t);
  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-start gap-3 py-2 border-b border-border/50 last:border-0">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-md",
          bullish ? "bg-success/15 text-success" : "bg-danger/15 text-danger",
        )}
      >
        {bullish ? (
          <TrendingUp className="h-3.5 w-3.5" />
        ) : (
          <TrendingDown className="h-3.5 w-3.5" />
        )}
      </span>
      <div className="min-w-0">
        <p className="text-sm leading-snug">
          <span className="font-semibold mr-1">{label}:</span>
          {rationale}
        </p>
      </div>
      <span
        className={cn(
          "text-xs font-mono font-semibold tabular-nums shrink-0 self-center",
          bullish ? "text-success" : "text-danger",
        )}
        title={t("master.contribution.tooltip")}
      >
        {bullish ? "+" : ""}
        {(src.contribution * 100).toFixed(1)}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Full source breakdown — always shows all 5 sources, missing ones
// rendered as dimmed "not available" rows. Useful for auditing what
// contributed to the verdict.
// ---------------------------------------------------------------------------

function SourceBreakdown({ verdict }: { verdict: MasterVerdict }) {
  const t = useT();
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {t("master.breakdown.title")}
      </p>
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-[0.65rem] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-1.5 font-semibold">{t("master.breakdown.source")}</th>
              <th className="text-right px-3 py-1.5 font-semibold tabular-nums">{t("master.breakdown.score")}</th>
              <th className="text-right px-3 py-1.5 font-semibold tabular-nums">{t("master.breakdown.weight")}</th>
              <th className="text-right px-3 py-1.5 font-semibold tabular-nums">{t("master.breakdown.contribution")}</th>
            </tr>
          </thead>
          <tbody>
            {verdict.sources.map((src) => {
              const label = sourceLabel(src, t);
              const isMissing = src.score === null;
              const isDiscounted = src.effectiveWeight > 0
                && src.effectiveWeight < src.baseWeight - 1e-6;
              const scoreFmt = isMissing
                ? "—"
                : (src.score! * 100).toFixed(0);
              const scoreCls =
                isMissing ? "text-muted-foreground/60"
                  : src.score! > 0 ? "text-success"
                    : src.score! < 0 ? "text-danger"
                      : "text-muted-foreground";
              const weightFmt = `${Math.round(src.effectiveWeight * 100)}%`;
              const contribFmt = isMissing
                ? "—"
                : `${src.contribution! >= 0 ? "+" : ""}${(src.contribution! * 100).toFixed(1)}`;
              const contribCls =
                isMissing ? "text-muted-foreground/60"
                  : src.contribution! > 0 ? "text-success"
                    : src.contribution! < 0 ? "text-danger"
                      : "text-muted-foreground";
              return (
                <tr
                  key={src.id}
                  className={cn(
                    "border-t border-border/40",
                    isMissing && "opacity-60",
                  )}
                >
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium">{label}</span>
                      {isDiscounted && (
                        <span
                          className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning/10 text-warning px-1 py-0 text-[0.55rem]"
                          title={t("master.breakdown.regimeDiscountedTooltip")}
                        >
                          <Scale className="h-2.5 w-2.5" />
                          {t("master.breakdown.regimeDiscounted")}
                        </span>
                      )}
                      {isMissing && (
                        <span className="chip chip-neu text-[0.55rem] px-1 py-0">
                          {t("master.breakdown.noVote")}
                        </span>
                      )}
                    </div>
                    {/* Show the rationale for BOTH voting and non-voting rows.
                        Non-voting sources still carry a helpful "why not"
                        message (e.g. "F&G at 45 — not extreme enough")
                        so the row is informative rather than looking
                        like a data outage. */}
                    <p className="text-[0.65rem] text-muted-foreground mt-0.5 line-clamp-2">
                      {sourceRationale(src, t)}
                    </p>
                  </td>
                  <td className={cn("px-3 py-1.5 text-right font-mono tabular-nums", scoreCls)}>
                    {scoreFmt}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                    {weightFmt}
                    {isDiscounted && (
                      <span className="text-[0.55rem] block opacity-70">
                        {t("master.breakdown.baseWeight", {
                          pct: Math.round(src.baseWeight * 100),
                        })}
                      </span>
                    )}
                  </td>
                  <td className={cn("px-3 py-1.5 text-right font-mono tabular-nums font-semibold", contribCls)}>
                    {contribFmt}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Beginner-mode explainer — same visual pattern as TechnicalSignalCard
// ---------------------------------------------------------------------------

const VERDICT_BANDS: Array<{ verdict: Verdict; label: string }> = [
  { verdict: "strong_buy",  label: "> +50"     },
  { verdict: "buy",         label: "+15 → +50" },
  { verdict: "hold",        label: "−15 → +15" },
  { verdict: "sell",        label: "−50 → −15" },
  { verdict: "strong_sell", label: "< −50"     },
];

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

function ScoreExplainer({ verdict }: { verdict: MasterVerdict }) {
  const t = useT();
  const beginner = useIsBeginner();
  if (!beginner) return null;

  const scorePct = Math.round(verdict.score * 100);
  const fmtSigned = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const coveragePct = Math.round(verdict.coverage * 100);
  const agreementPct = verdict.agreement === null
    ? null
    : Math.round(verdict.agreement * 100);

  return (
    <div className="mt-4 pt-4 border-t border-border/60">
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex h-5 items-center gap-1 rounded-md bg-primary/10 px-1.5 text-[0.65rem] font-bold uppercase tracking-wider text-primary">
          <Calculator className="h-3 w-3" />
          {t("beginner.badge")}
        </span>
        <p className="text-sm font-semibold">{t("master.explain.title")}</p>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed mb-3">
        {t("master.explain.intro")}
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        {/* Today's math ------------------------------------------------- */}
        <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
          <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground mb-2">
            {t("master.explain.stepsLabel")}
          </p>
          <ul className="space-y-1.5 text-xs">
            <li className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">{t("master.explain.stepCoverage")}</span>
              <span className="font-mono tabular-nums font-semibold">
                {coveragePct}%
              </span>
            </li>
            <li className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">{t("master.explain.stepAgreement")}</span>
              <span className="font-mono tabular-nums font-semibold">
                {agreementPct === null ? "—" : `${agreementPct}%`}
              </span>
            </li>
            <li className="flex items-baseline justify-between gap-2 pt-1.5 border-t border-border/50">
              <span className="text-foreground font-medium">{t("master.explain.stepScore")}</span>
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
          </ul>
          <p className="mt-2 text-[0.65rem] text-muted-foreground">
            {t("master.explain.formula")}
          </p>
        </div>

        {/* Weights + verdict bands -------------------------------------- */}
        <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
          <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground mb-2">
            {t("master.explain.weightsLabel")}
          </p>
          <ul className="space-y-1 text-xs">
            {(Object.keys(SOURCE_WEIGHTS) as Array<keyof typeof SOURCE_WEIGHTS>).map((id) => {
              const label = t(`master.src.${id}.label`);
              const pct = Math.round(SOURCE_WEIGHTS[id] * 100);
              return (
                <li key={id} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono tabular-nums">{pct}%</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* Verdict bands ---------------------------------------------------- */}
      <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 p-3">
        <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground mb-2">
          {t("master.explain.bandsLabel")}
        </p>
        <ul className="space-y-1">
          {VERDICT_BANDS.map((band) => {
            const active = band.verdict === verdict.verdict;
            const style = VERDICT_STYLE[band.verdict];
            return (
              <li
                key={band.verdict}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs transition-colors",
                  active ? cn(style.bg, "ring-1", style.ring) : "hover:bg-muted/50",
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

      <p className="mt-3 text-[0.65rem] text-muted-foreground leading-relaxed">
        {t("master.explain.disclaimer")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main card
// ---------------------------------------------------------------------------

export function MasterVerdictCard({ verdict }: { verdict: MasterVerdict }) {
  const t = useT();
  const s = VERDICT_STYLE[verdict.verdict];
  const scorePct = verdict.score * 100;

  return (
    <Card className="relative overflow-hidden">
      {/* Subtle gradient tint that echoes the verdict colour without
          overwhelming the card. Layered UNDER the content via z-index
          so text and icons stay perfectly readable in both themes. */}
      <div
        className={cn(
          "absolute inset-0 pointer-events-none opacity-40",
          verdict.verdict === "strong_buy" || verdict.verdict === "buy"
            ? "bg-gradient-to-br from-success/25 to-transparent"
            : verdict.verdict === "strong_sell" || verdict.verdict === "sell"
              ? "bg-gradient-to-br from-danger/25 to-transparent"
              : "bg-gradient-to-br from-primary/10 to-transparent",
        )}
        aria-hidden
      />
      <div className="relative">
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <TermTip term="Master Verdict">{t("master.title")}</TermTip>
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1 max-w-xl">
              {t("master.subtitle")}
            </p>
          </div>
          {/* Alert bell + disclaimer info sit side-by-side. The bell
              is the primary interaction (users tap it to opt into
              digests / change alerts); the info tooltip is passive.
              Keeping the two grouped inside `shrink-0` prevents the
              header from wrapping awkwardly on narrow phones. */}
          <div className="flex items-center gap-1.5 shrink-0">
            <MasterAlertControl />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={t("master.disclaimer.label")}
                >
                  <InfoIcon className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="font-medium mb-1">{t("master.disclaimer.title")}</p>
                <p className="text-muted-foreground text-[0.7rem] leading-relaxed">
                  {t("master.disclaimer.body")}
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        </CardHeader>

        <CardContent>
          {!verdict.hasData ? (
            <div className="rounded-lg border border-border/60 p-4 text-sm text-muted-foreground">
              {t("master.noData")}
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)] items-start">
                {/* -------- Verdict badge --------------------------------- */}
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
                        {t(`ts.verdict.${verdict.verdict}`)}
                      </span>
                    </span>
                    <p className={cn("mt-2 text-4xl font-black tabular-nums", s.color)}>
                      {scorePct >= 0 ? "+" : ""}
                      {scorePct.toFixed(0)}
                    </p>
                    <p className="text-[0.7rem] text-muted-foreground uppercase tracking-wider">
                      {t("master.scoreLabel")}
                    </p>
                  </div>

                  {/* -------- Score bar ------------------------------------ */}
                  <div className="mt-3">
                    <div className="flex justify-between text-[0.65rem] text-muted-foreground mb-1">
                      <span>−100</span>
                      <span>0</span>
                      <span>+100</span>
                    </div>
                    <ScoreBar score={verdict.score} />
                  </div>

                  {/* -------- Coverage / agreement / regime chips ---------- */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="chip chip-neu text-[0.65rem]">
                          {t("master.coverageLabel")}{" "}
                          <span className="font-semibold tabular-nums">
                            {Math.round(verdict.coverage * 100)}%
                          </span>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p className="text-[0.7rem]">{t("master.coverage.tooltip")}</p>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="chip chip-neu text-[0.65rem]">
                          {t("master.agreementLabel")}{" "}
                          <span className="font-semibold tabular-nums">
                            {verdict.agreement === null
                              ? "—"
                              : `${Math.round(verdict.agreement * 100)}%`}
                          </span>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p className="text-[0.7rem]">{t("master.agreement.tooltip")}</p>
                      </TooltipContent>
                    </Tooltip>
                    <RegimeChip regime={verdict.regime} />
                  </div>
                </div>

                {/* -------- Top drivers --------------------------------- */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    {t("master.reasons.title", { n: verdict.topReasons.length })}
                  </p>
                  {verdict.topReasons.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t("master.reasons.empty")}
                    </p>
                  ) : (
                    <ul className="rounded-lg border border-border/60">
                      {verdict.topReasons.map((src) => (
                        <ReasonRow key={src.id} src={src} />
                      ))}
                    </ul>
                  )}

                  {/* Deep-links to the specialist cards on their own pages
                      so users can drill from the master verdict into the
                      sub-scorer that produced a given signal without
                      hunting through the sidebar. `prefetch` is left at
                      the default so Next.js warms the destination route
                      on hover — makes the click feel instant even when a
                      slow upstream (news, F&G) is still loading. On
                      mobile the extra vertical padding pushes the tap
                      target above the ~44px WCAG minimum. */}
                  <div className="mt-3 flex flex-wrap gap-2 text-[0.7rem]">
                    <Link
                      href="/signal#technical"
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 hover:border-primary/50 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                    >
                      {t("master.deep.technical")}
                    </Link>
                    <Link
                      href="/signal#resonance"
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 hover:border-primary/50 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                    >
                      {t("master.deep.resonance")}
                    </Link>
                    <Link
                      href="/news"
                      prefetch
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 hover:border-primary/50 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                    >
                      {t("master.deep.news")}
                    </Link>
                    <Link
                      href="/market"
                      prefetch
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 hover:border-primary/50 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
                    >
                      {t("master.deep.mood")}
                    </Link>
                  </div>
                </div>
              </div>

              <SourceBreakdown verdict={verdict} />

              <ScoreExplainer verdict={verdict} />
            </>
          )}
        </CardContent>
      </div>
    </Card>
  );
}
