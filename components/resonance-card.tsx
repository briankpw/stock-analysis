"use client";

import * as React from "react";
import {
  TrendingUp,
  TrendingDown,
  Info as InfoIcon,
  Zap,
  ShieldCheck,
  Hourglass,
  Minus,
  Calculator,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TermTip } from "@/components/term-tip";
import { ResonanceAlertControl } from "@/components/resonance-alert-control";
import { fmtCurrency, fmtSignedPercent } from "@/lib/format";
import type {
  ResonanceCheckId,
  ResonanceCheckState,
  ResonanceHistoryEntry,
  ResonanceResult,
  ResonanceVerdict,
} from "@/lib/resonance";
import { useT } from "@/lib/i18n";
import { useIsBeginner } from "@/lib/state";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Verdict banner presentation
// ---------------------------------------------------------------------------

const VERDICT_STYLE: Record<
  ResonanceVerdict,
  { color: string; bg: string; ring: string; icon: React.ReactNode }
> = {
  buy: {
    color: "text-success",
    bg: "bg-success/15",
    ring: "ring-success/40",
    icon: <Zap className="h-5 w-5" />,
  },
  holding: {
    color: "text-primary",
    bg: "bg-primary/15",
    ring: "ring-primary/40",
    icon: <ShieldCheck className="h-5 w-5" />,
  },
  // Symmetric bearish side — matches the buy/holding colour language
  // (danger red = sell just like success green = buy) so the two sides
  // are visually parallel.
  sell: {
    color: "text-danger",
    bg: "bg-danger/15",
    ring: "ring-danger/40",
    icon: <Zap className="h-5 w-5" />,
  },
  avoid: {
    color: "text-danger",
    bg: "bg-danger/10",
    ring: "ring-danger/30",
    icon: <TrendingDown className="h-5 w-5" />,
  },
  out: {
    color: "text-muted-foreground",
    bg: "bg-muted",
    ring: "ring-border",
    icon: <Minus className="h-5 w-5" />,
  },
  warmup: {
    color: "text-muted-foreground",
    bg: "bg-muted",
    ring: "ring-border",
    icon: <Hourglass className="h-5 w-5" />,
  },
};

// Order matches the moomoo script (positions 1..6). Keeping the order
// stable lets tables/tests reason about "check 3" the same way the
// script author does.
const CHECK_ORDER: ResonanceCheckId[] = ["macd", "kdj", "rsi", "lwr", "bbi", "mtm"];

/** Human labels for each check's "fast" and "slow" side. Rendered in the
 * per-signal row so a beginner sees what the two numbers actually are. */
const CHECK_SIDES: Record<ResonanceCheckId, { fast: string; slow: string }> = {
  macd: { fast: "DIFF",  slow: "DEA"   },
  kdj:  { fast: "K",     slow: "D"     },
  rsi:  { fast: "RSI5",  slow: "RSI13" },
  lwr:  { fast: "LWR1",  slow: "LWR2"  },
  bbi:  { fast: "Close", slow: "BBI"   },
  mtm:  { fast: "MMS",   slow: "MMM"   },
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtValue(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 100) return v.toFixed(1);
  if (abs >= 10)  return v.toFixed(2);
  return v.toFixed(3);
}

function fmtSpread(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const s = v >= 0 ? "+" : "−";
  return `${s}${fmtValue(Math.abs(v))}`;
}

// ---------------------------------------------------------------------------
// Per-check row (mirrors the DRAWICON stack in the moomoo script)
// ---------------------------------------------------------------------------

function SignalRow({ check, index }: { check: ResonanceCheckState; index: number }) {
  const t = useT();
  const sides = CHECK_SIDES[check.id];
  const { bullish, ready } = check;

  const pillCls = !ready
    ? "bg-muted text-muted-foreground"
    : bullish
      ? "bg-success/15 text-success"
      : "bg-danger/15 text-danger";

  const pillIcon = !ready ? (
    <Hourglass className="h-3.5 w-3.5" />
  ) : bullish ? (
    <TrendingUp className="h-3.5 w-3.5" />
  ) : (
    <TrendingDown className="h-3.5 w-3.5" />
  );

  const pillLabel = !ready
    ? t("resonance.state.warmup")
    : bullish
      ? t("resonance.state.bull")
      : t("resonance.state.bear");

  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-center gap-3 py-2 px-3 border-b border-border/50 last:border-0">
      {/* Position badge — mirrors the moomoo script's row-position number. */}
      <span
        aria-hidden
        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[0.65rem] font-bold tabular-nums text-muted-foreground shrink-0"
      >
        {index + 1}
      </span>

      <div className="min-w-0">
        <p className="text-sm font-medium leading-snug">
          {t(`resonance.check.${check.id}.name`)}
        </p>
        <p className="text-[0.7rem] text-muted-foreground mt-0.5 truncate">
          <span className="font-mono">{sides.fast}</span>{" "}
          <span className="font-mono">{fmtValue(check.fastValue)}</span>
          <span className="mx-1 opacity-60">vs</span>
          <span className="font-mono">{sides.slow}</span>{" "}
          <span className="font-mono">{fmtValue(check.slowValue)}</span>
          {check.spread !== null && (
            <>
              {" "}
              <span
                className={cn(
                  "font-mono",
                  check.spread > 0
                    ? "text-success"
                    : check.spread < 0
                      ? "text-danger"
                      : "text-muted-foreground",
                )}
              >
                ({fmtSpread(check.spread)})
              </span>
            </>
          )}
        </p>
      </div>

      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wider shrink-0",
          pillCls,
        )}
      >
        {pillIcon}
        {pillLabel}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Recent status strip — the visual counterpart to the TDX script's
//
//   STICKLINE(共振,      0, 6, 0.6, 1),  COLORMAGENTA;   ← "holding" bars
//   STICKLINE(买入信号,   0, 6, 0.6, 0),  COLORYELLOW;    ← "buy" trigger bars
//   DRAWICON(买入信号,   6, 9);                          ← buy marker
//
// Each history entry becomes a single thin vertical tick. Gold for a
// fresh BUY trigger (a bar where all six checks first lined up), magenta
// for a HOLDING bar (alignment persists), muted gray for OUT. The user
// can scan the last ~3-4 months at a glance without leaving the card.
// ---------------------------------------------------------------------------

/**
 * TDX-canonical tick colours. Kept together so a future theme tweak only
 * touches this table. The gold/magenta pair intentionally does NOT reuse
 * `text-success` / `text-primary` — the TDX chart aesthetic is the *point*
 * of this widget, and mapping it onto the app's semantic palette would
 * lose the visual bridge back to the source script.
 */
const HISTORY_TICK_STYLE: Record<ResonanceHistoryEntry["state"], string> = {
  // TDX COLORYELLOW → warm gold, high contrast against both light and
  // dark card backgrounds. Slight glow via ring so a lone buy day in a
  // sea of out/holding still catches the eye.
  buy: "bg-yellow-400 ring-1 ring-yellow-500/60",
  // TDX COLORMAGENTA → fuchsia. Same colour family as tailwind's
  // `fuchsia-500`; the 500 shade reads as "magenta" more clearly than
  // 600 in most themes.
  holding: "bg-fuchsia-500",
  // Symmetric bearish side — bright red for a fresh sell trigger (mirrors
  // the yellow ring emphasis on buys), muted red for "avoid" (mirrors
  // fuchsia holding). Distinct from the muted-out grey so a bearish
  // stretch is unambiguously readable.
  sell: "bg-red-500 ring-1 ring-red-600/60",
  avoid: "bg-red-400/60",
  // "Out" gets a muted foreground with reduced opacity — visible enough
  // to convey "there's data for this bar" without competing with the
  // gold/magenta/red ticks the eye is actually meant to hunt for.
  out: "bg-muted-foreground/25",
};

function StatusStrip({ history }: { history: ResonanceHistoryEntry[] }) {
  const t = useT();

  if (history.length === 0) {
    return (
      <div className="mt-4 pt-4 border-t border-border/60">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          {t("resonance.history.title")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("resonance.history.empty")}
        </p>
      </div>
    );
  }

  // Counts feed the tiny legend below the strip so the user can see how
  // rare the alignment has been over the visible window.
  const buys = history.filter((h) => h.state === "buy").length;
  const holds = history.filter((h) => h.state === "holding").length;
  const sells = history.filter((h) => h.state === "sell").length;
  const avoids = history.filter((h) => h.state === "avoid").length;
  const outs = history.filter((h) => h.state === "out").length;

  // Locale-aware "Mon, 18 Jul 2026" date so the tooltip reads naturally
  // in either English or Simplified Chinese.
  const dateFmt = (unixSec: number) =>
    new Date(unixSec * 1000).toLocaleDateString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  return (
    <div className="mt-4 pt-4 border-t border-border/60">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t("resonance.history.title")}
        </p>
        <p className="text-[0.65rem] text-muted-foreground">
          {t("resonance.history.subtitle", { n: history.length })}
        </p>
      </div>

      {/* The strip itself — flex row of thin ticks. `flex-1` per tick so
          the strip fills whatever width is available; on very narrow
          screens ticks compress toward 1-2px wide but stay tappable
          because the whole strip is horizontally scrollable via the
          `overflow-x-auto` parent. */}
      <div className="rounded-md border border-border/60 bg-muted/20 p-1.5">
        <div className="flex items-end gap-[1px] h-8">
          {history.map((entry, i) => {
            // Show the *dominant* alignment side in the tooltip so users
            // understand what the tick represents ("4/6 bearish" vs
            // "4/6 bullish" tell very different stories).
            const isBearSide = entry.state === "sell" || entry.state === "avoid";
            const dominantCount = isBearSide
              ? entry.bearishAlignedCount
              : entry.alignedCount;
            const changePos = (entry.changePct ?? 0) >= 0;
            return (
              <Tooltip key={i}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "flex-1 min-w-[2px] rounded-sm h-full cursor-help",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                      HISTORY_TICK_STYLE[entry.state],
                    )}
                    aria-label={`${dateFmt(entry.time)}: ${t(`resonance.verdict.${entry.state}`)} (${dominantCount}/6)`}
                  />
                </TooltipTrigger>
                <TooltipContent className="max-w-[16rem]" side="top">
                  <p className="font-semibold text-sm mb-1">
                    {dateFmt(entry.time)}
                  </p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                    <dt className="text-muted-foreground">
                      {t("resonance.history.tooltip.state")}
                    </dt>
                    <dd className="font-medium">
                      {t(`resonance.verdict.${entry.state}`)}
                    </dd>
                    <dt className="text-muted-foreground">
                      {t("resonance.history.tooltip.close")}
                    </dt>
                    <dd className="tabular-nums font-medium">
                      {fmtCurrency(entry.close)}
                      {entry.changePct !== null && (
                        <span
                          className={cn(
                            "ml-1.5 text-[0.65rem]",
                            changePos ? "text-success" : "text-danger",
                          )}
                        >
                          {fmtSignedPercent(entry.changePct)}
                        </span>
                      )}
                    </dd>
                    <dt className="text-muted-foreground">
                      {t("resonance.history.tooltip.bullish")}
                    </dt>
                    <dd className="tabular-nums font-medium text-success">
                      {entry.alignedCount}/6
                    </dd>
                    <dt className="text-muted-foreground">
                      {t("resonance.history.tooltip.bearish")}
                    </dt>
                    <dd className="tabular-nums font-medium text-danger">
                      {entry.bearishAlignedCount}/6
                    </dd>
                  </dl>
                  <p className="text-[0.65rem] text-muted-foreground mt-1.5 pt-1.5 border-t border-border/40 leading-relaxed">
                    {t(`resonance.history.tooltip.desc.${entry.state}`)}
                  </p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>

      {/* Legend + tallies. Uses the same gold/magenta/red swatches as
          the strip so the mapping is unambiguous, and shows the raw
          count of each state over the window (`3 · 12 · 2 · 5 · 75` is
          easier to reason about than staring at a stripe). */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.65rem] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("h-2 w-3 rounded-sm", HISTORY_TICK_STYLE.buy)} aria-hidden />
          <TermTip term="Buy day" alwaysDecorate>
            {t("resonance.history.legend.buy")}
          </TermTip>
          <span className="font-mono tabular-nums text-foreground/80">{buys}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("h-2 w-3 rounded-sm", HISTORY_TICK_STYLE.holding)} aria-hidden />
          <TermTip term="Hold day" alwaysDecorate>
            {t("resonance.history.legend.hold")}
          </TermTip>
          <span className="font-mono tabular-nums text-foreground/80">{holds}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("h-2 w-3 rounded-sm", HISTORY_TICK_STYLE.sell)} aria-hidden />
          <TermTip term="Sell day" alwaysDecorate>
            {t("resonance.history.legend.sell")}
          </TermTip>
          <span className="font-mono tabular-nums text-foreground/80">{sells}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("h-2 w-3 rounded-sm", HISTORY_TICK_STYLE.avoid)} aria-hidden />
          <TermTip term="Avoid day" alwaysDecorate>
            {t("resonance.history.legend.avoid")}
          </TermTip>
          <span className="font-mono tabular-nums text-foreground/80">{avoids}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("h-2 w-3 rounded-sm", HISTORY_TICK_STYLE.out)} aria-hidden />
          <TermTip term="Out" alwaysDecorate>
            {t("resonance.history.legend.out")}
          </TermTip>
          <span className="font-mono tabular-nums text-foreground/80">{outs}</span>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Beginner-mode explainer
// ---------------------------------------------------------------------------

/**
 * Per-check formula + plain-English rule. Rendered only in Beginner
 * mode; Advanced users can reach the TDX source in the info tooltip on
 * the card header.
 */
const CHECK_FORMULAS: Record<ResonanceCheckId, string> = {
  macd: "DIFF = EMA(C,8) − EMA(C,13);  DEA = EMA(DIFF,5)",
  kdj:  "RSV = (C − LLV(L,8)) ÷ (HHV(H,8) − LLV(L,8)) × 100;  K = SMA(RSV,3,1);  D = SMA(K,3,1)",
  rsi:  "RSI(N) = SMA(max(ΔC,0),N,1) ÷ SMA(|ΔC|,N,1) × 100  for N = 5 and 13",
  lwr:  "RSV = −(HHV(H,13) − C) ÷ (HHV(H,13) − LLV(L,13)) × 100;  LWR1 = SMA(RSV,3,1);  LWR2 = SMA(LWR1,3,1)",
  bbi:  "BBI = (MA(C,3) + MA(C,5) + MA(C,8) + MA(C,13)) ÷ 4",
  mtm:  "MTM = C − REF(C,1);  MMS = 100·EMA(EMA(MTM,5),3) ÷ EMA(EMA(|MTM|,5),3);  MMM = 100·EMA(EMA(MTM,13),8) ÷ EMA(EMA(|MTM|,13),8)",
};

function ScoreExplainer({ result }: { result: ResonanceResult }) {
  const t = useT();
  const beginner = useIsBeginner();
  if (!beginner) return null;

  return (
    <div className="mt-4 pt-4 border-t border-border/60">
      <div className="flex items-center gap-2 mb-3">
        <span className="inline-flex h-5 items-center gap-1 rounded-md bg-primary/10 px-1.5 text-[0.65rem] font-bold uppercase tracking-wider text-primary">
          <Calculator className="h-3 w-3" />
          {t("beginner.badge")}
        </span>
        <p className="text-sm font-semibold">{t("resonance.explain.title")}</p>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed mb-3">
        {t("resonance.explain.intro")}
      </p>

      {/* --- Per-check formula + rule --------------------------------- */}
      <div className="grid gap-2 sm:grid-cols-2">
        {CHECK_ORDER.map((id) => (
          <div key={id} className="rounded-lg border border-border/60 bg-muted/30 p-3">
            <p className="text-xs font-semibold mb-1">
              {t(`resonance.check.${id}.name`)}
            </p>
            <p className="text-[0.7rem] text-muted-foreground leading-relaxed mb-1.5">
              {t(`resonance.check.${id}.desc`)}
            </p>
            <p className="text-[0.65rem] font-mono text-foreground/80 break-words">
              {CHECK_FORMULAS[id]}
            </p>
            <p className="text-[0.65rem] text-muted-foreground mt-1">
              <span className="font-semibold text-foreground">
                {t("resonance.explain.ruleLabel")}
              </span>{" "}
              {t(`resonance.check.${id}.rule`)}
            </p>
          </div>
        ))}
      </div>

      {/* --- Combined rule -------------------------------------------- */}
      <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
        <p className="text-xs font-semibold mb-1 text-primary">
          {t("resonance.explain.combineLabel")}
        </p>
        <ul className="text-[0.7rem] text-muted-foreground leading-relaxed space-y-1">
          <li>
            <span className="font-mono text-foreground">
              {t("resonance.explain.resonanceExpr")}
            </span>
            {" — "}
            {t("resonance.explain.resonanceRule")}
          </li>
          <li>
            <span className="font-mono text-foreground">
              {t("resonance.explain.buyExpr")}
            </span>
            {" — "}
            {t("resonance.explain.buyRule")}
          </li>
          <li>
            <span className="font-mono text-foreground">
              {t("resonance.explain.holdExpr")}
            </span>
            {" — "}
            {t("resonance.explain.holdRule")}
          </li>
        </ul>
      </div>

      <p className="mt-3 text-[0.65rem] text-muted-foreground leading-relaxed">
        {t("resonance.explain.disclaimer")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main card
// ---------------------------------------------------------------------------

/**
 * Props for the shared `<ResonanceCard>`.
 *
 * The card was originally hard-wired to a single-ticker context — it
 * always rendered `<ResonanceAlertControl>` (which binds to the sticky
 * ticker in the sidebar) and used the generic "6-Signal Resonance"
 * title. Sector pages need to hide the alert bell (per-ticker alerts
 * don't map to a whole sector) and swap in "Sector resonance"
 * copy, so those two knobs are now optional overrides.
 */
export interface ResonanceCardProps {
  result: ResonanceResult;
  /** When false, hides the `<ResonanceAlertControl>` bell. Use on
   *  sector pages where the sidebar ticker doesn't match the shown
   *  resonance target. Ignored when `headerAction` is provided.
   *  Defaults to true. */
  showAlertControl?: boolean;
  /** Overrides the default `t("resonance.title")` heading. */
  title?: React.ReactNode;
  /** Overrides the default `t("resonance.subtitle")` sub-heading. */
  subtitle?: string;
  /** Custom node rendered in the header action slot where the
   *  default bell would sit. Sector pages inject a
   *  `<SectorResonanceAlertControl>` here so users can subscribe
   *  to alerts on the whole segment (measured on its proxy ETF)
   *  rather than on a single sidebar ticker. When set, this
   *  suppresses the default per-ticker `<ResonanceAlertControl>`
   *  regardless of `showAlertControl`. */
  headerAction?: React.ReactNode;
}

export function ResonanceCard({
  result,
  showAlertControl = true,
  title,
  subtitle,
  headerAction,
}: ResonanceCardProps) {
  const t = useT();
  const s = VERDICT_STYLE[result.verdict];
  // Progress bar tracks whichever side currently dominates — bullish
  // when alignedCount is at least as high as bearish, bearish otherwise.
  // This keeps a strong bearish alignment from displaying as an empty
  // (implicitly "not aligned") meter.
  const bearishSide = result.bearishAlignedCount > result.alignedCount;
  const shownCount = bearishSide ? result.bearishAlignedCount : result.alignedCount;
  const percent = Math.round((shownCount / 6) * 100);

  const streakLabel = result.resonance
    ? t("resonance.streak", { n: Math.abs(result.streak) })
    : result.bearishResonance
      ? t("resonance.streakBear", { n: Math.abs(result.streak) })
      : result.lastBuyTime !== null || result.lastSellTime !== null
        ? // Prefer whichever trigger fired more recently.
          (result.lastBuyTime ?? 0) >= (result.lastSellTime ?? 0)
          ? t("resonance.lastBuy", {
              date: new Date((result.lastBuyTime ?? 0) * 1000).toLocaleDateString(),
            })
          : t("resonance.lastSell", {
              date: new Date((result.lastSellTime ?? 0) * 1000).toLocaleDateString(),
            })
        : t("resonance.noBuyYet");

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <TermTip term="6-Signal Resonance">
              {title ?? t("resonance.title")}
            </TermTip>
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl">
            {subtitle ?? t("resonance.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {headerAction ?? (showAlertControl && <ResonanceAlertControl />)}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                aria-label={t("resonance.disclaimer.label")}
              >
                <InfoIcon className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="font-medium mb-1">{t("resonance.disclaimer.title")}</p>
              <p className="text-muted-foreground text-[0.7rem] leading-relaxed">
                {t("resonance.disclaimer.body")}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid gap-4 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)] items-start">
          {/* -------- Verdict banner ------------------------------------ */}
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
                  {t(`resonance.verdict.${result.verdict}`)}
                </span>
              </span>
              <p className={cn("mt-2 text-3xl font-black tabular-nums", s.color)}>
                {result.alignedCount}
                <span className="text-lg font-semibold opacity-60"> / 6</span>
              </p>
              <p className="text-[0.7rem] text-muted-foreground uppercase tracking-wider">
                {t("resonance.alignedLabel")}
              </p>
            </div>

            {/* -------- Progress meter --------------------------------- */}
            <div className="mt-3">
              <div className="flex justify-between text-[0.65rem] text-muted-foreground mb-1">
                <span>0/6</span>
                <span>6/6</span>
              </div>
              <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "absolute inset-y-0 left-0 transition-all",
                    result.resonance
                      ? "bg-success"
                      : result.bearishResonance
                        ? "bg-danger"
                        : bearishSide
                          ? shownCount >= 4
                            ? "bg-danger/70"
                            : "bg-muted-foreground/50"
                          : shownCount >= 4
                            ? "bg-warning"
                            : "bg-muted-foreground/50",
                  )}
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="mt-2 text-[0.7rem] text-muted-foreground text-center">
                {streakLabel}
              </p>
            </div>
          </div>

          {/* -------- Per-signal rows ---------------------------------- */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              {t("resonance.checksLabel")}
            </p>
            {result.verdict === "warmup" ? (
              <div className="rounded-lg border border-border/60 p-4 text-sm text-muted-foreground">
                {t("resonance.warmupMessage", { n: result.barsAvailable })}
              </div>
            ) : (
              <ul className="rounded-lg border border-border/60">
                {CHECK_ORDER.map((id, idx) => {
                  const check = result.checks.find((c) => c.id === id)!;
                  return <SignalRow key={id} check={check} index={idx} />;
                })}
              </ul>
            )}
          </div>
        </div>

        <StatusStrip history={result.history} />

        <ScoreExplainer result={result} />
      </CardContent>
    </Card>
  );
}
