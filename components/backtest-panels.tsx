/**
 * Reusable presentational panels for the standalone `/backtest` page.
 *
 * These pieces used to live inside `components/backtest-control.tsx`
 * as a modal-only feature attached to the Technical Signal card.
 * They've been lifted out here so the new full-page /backtest surface
 * can render an identical UI with a lot more room to breathe (history
 * sidebar, beginner-mode advice, larger sparkline) without duplicating
 * layout code.
 *
 * ## Why they live in their own module (rather than the page)
 *
 * Two consumers:
 *
 *   1. `app/backtest/page.tsx` — the primary caller. Runs a fresh
 *      backtest OR opens a saved one and renders it.
 *   2. `app/backtest/[id]/page.tsx` — future deep-link route for
 *      sharing/opening one specific past run. Same rendering path.
 *
 * Extracting the panels also keeps the page's own file focused on
 * page-level plumbing (data fetching, URL sync, history list, layout)
 * rather than mixing that with the ~600 lines of tile / table /
 * sparkline / save-panel presentation.
 *
 * ## Types re-exported
 *
 * `ConfigState`, `BacktestResponse`, `PeriodOpt`, `SavePanelState` are
 * exported so the page can hold and manipulate them without importing
 * from `@/lib/signal-backtest` directly. That keeps the page's
 * `useState` sites readable at a glance.
 */

"use client";

import * as React from "react";
import { Check, ChevronsRight, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtCurrency, fmtNumber, fmtSigned, fmtSignedPercent } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useLocale, type Locale } from "@/lib/state";
import { cn } from "@/lib/utils";
import { BACKTEST_STRATEGY_PARAMS } from "@/lib/backtest-strategy-config";
import type {
  BacktestResult,
  BacktestStrategy,
  BacktestTrade,
  EquityPoint,
  ExecutionTiming,
  SizingConfig,
  TargetsConfig,
} from "@/lib/signal-backtest";

// Re-export so consumers (page + advice) can import strategy types
// from a single component-level module without a second dep on the
// engine.
export type { BacktestStrategy, TargetsConfig } from "@/lib/signal-backtest";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PeriodOpt = "6mo" | "1y" | "2y" | "5y" | "10y" | "max";
export type SizingKind = SizingConfig["kind"];
export type TargetsKind = TargetsConfig["kind"];

/**
 * Form state for the ConfigPanel. Strings for numeric inputs so
 * partially-typed values ("1", "1.") don't clobber the UI mid-typing.
 *
 * SL/TP percentage inputs are stored as UI-friendly whole-number
 * strings ("5" meaning 5%), then divided by 100 in `readTargets`
 * before hitting the wire. Matches the paper-trading page's UX so
 * the two surfaces feel consistent.
 */
export interface ConfigState {
  strategy: BacktestStrategy;
  execution: ExecutionTiming;
  sizingKind: SizingKind;
  fixedShares: string;
  percentEquity: string;
  period: PeriodOpt;
  startingCash: string;
  includeFearGreed: boolean;
  targetsKind: TargetsKind;
  /** Stop-loss %, whole-number string ("5" = 5%). Only used when
   *  `targetsKind === "fixed_pct"`. Empty string disables the SL. */
  stopLossPct: string;
  /** Take-profit %, whole-number string. Empty string disables TP. */
  takeProfitPct: string;
}

/** Wire shape returned by both fresh and history-load endpoints. */
export interface BacktestResponse {
  ok: true;
  ticker: string;
  strategy: BacktestStrategy;
  execution: ExecutionTiming;
  sizing: SizingConfig;
  startingCash: number;
  period: PeriodOpt;
  firstBarAt: string;
  lastBarAt: string;
  result: BacktestResult;
  /** Populated when the run was persisted (fresh) or loaded (history). */
  savedId?: number | null;
  /** Only present on saved runs. */
  label?: string;
  createdAt?: string;
}

export type SavePanelState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; portfolioId: number; portfolioName: string }
  | { kind: "error"; message: string };

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: ConfigState = {
  strategy: "technical",
  execution: "nextOpen",
  sizingKind: "all_in",
  fixedShares: "10",
  percentEquity: "25",
  period: "2y",
  startingCash: "10000",
  includeFearGreed: false,
  // SL/TP off by default — matches the historic behaviour so a user
  // opening the page for the first time sees the same "raw signal"
  // numbers they saw before this feature landed.
  targetsKind: "off",
  stopLossPct: "5",
  takeProfitPct: "15",
};

export function defaultPortfolioName(
  ticker: string,
  strategy: BacktestStrategy,
  period: PeriodOpt,
): string {
  // Keep in sync with `lib/backtest-store.ts::autoLabel` — same
  // strategy → same short label so the paper portfolio name and
  // the history-list label read the same.
  const shortStrategy: Record<BacktestStrategy, string> = {
    technical: "Tech",
    resonance: "Resonance",
    master: "Master",
    sma_cross: "SMA-X",
    ema_cross: "EMA-X",
    macd_cross: "MACD-X",
    rsi_reversion: "RSI-Rev",
    kdj_cross: "KDJ-X",
    bbands_reversion: "BB-Rev",
    sr_bounce: "S/R",
  };
  return `${ticker} · ${shortStrategy[strategy]} ${period}`;
}

/**
 * Convert the form state into the concrete `SizingConfig` the engine
 * expects. Throws a translated error on invalid numeric inputs so
 * the caller can surface it inline.
 */
export function readSizing(cfg: ConfigState, t: (k: string) => string): SizingConfig {
  if (cfg.sizingKind === "all_in") return { kind: "all_in" };
  if (cfg.sizingKind === "fixed_shares") {
    const shares = Math.floor(Number(cfg.fixedShares));
    if (!Number.isFinite(shares) || shares <= 0) {
      throw new Error(t("signal.backtest.err.badShares"));
    }
    return { kind: "fixed_shares", shares };
  }
  const pct = Number(cfg.percentEquity) / 100;
  if (!Number.isFinite(pct) || pct <= 0 || pct > 1) {
    throw new Error(t("signal.backtest.err.badPct"));
  }
  return { kind: "percent_equity", pct };
}

/**
 * Convert the form state into the `TargetsConfig` the engine expects.
 * Empty percent inputs disable that side of the bracket; a blank both
 * fields under `fixed_pct` is legal (equivalent to "off" but keeps
 * the picker choice visible so the user can tell why nothing fired).
 *
 * Throws a translated error on obviously-invalid numeric input so the
 * caller can surface it inline the same way `readSizing` does.
 */
export function readTargets(
  cfg: ConfigState,
  t: (k: string, params?: Record<string, string | number>) => string,
): TargetsConfig {
  if (cfg.targetsKind === "off") return { kind: "off" };
  if (cfg.targetsKind === "smart") return { kind: "smart" };
  const parsePct = (raw: string, label: string, max: number): number | undefined => {
    const trimmed = raw.trim();
    if (trimmed === "") return undefined;
    const n = Number(trimmed) / 100;
    if (!Number.isFinite(n) || n <= 0 || n > max) {
      throw new Error(t("signal.backtest.err.badTargetPct", { field: label }));
    }
    return n;
  };
  const stopLossPct = parsePct(
    cfg.stopLossPct,
    t("signal.backtest.targets.stopLoss"),
    0.5,
  );
  const takeProfitPct = parsePct(
    cfg.takeProfitPct,
    t("signal.backtest.targets.takeProfit"),
    2,
  );
  return { kind: "fixed_pct", stopLossPct, takeProfitPct };
}

// ---------------------------------------------------------------------------
// Strategy picker helpers
// ---------------------------------------------------------------------------

/**
 * One horizontally-scrollable row of strategy pills under a category
 * header. Keeps the ConfigPanel above readable when we have 10
 * strategies to expose (composite + trend + mean-reversion). Reads
 * the display label for each strategy from `signal.backtest.strategy.{key}`
 * in the i18n dictionary — so a future strategy is just an enum
 * value + dict entry away, no visual changes required.
 */
function StrategyGroup({
  title,
  hint,
  strategies,
  selected,
  onSelect,
}: {
  title: string;
  hint: string;
  strategies: readonly BacktestStrategy[];
  selected: BacktestStrategy;
  onSelect: (s: BacktestStrategy) => void;
}) {
  const t = useT();
  return (
    <div className="rounded-md border border-border/60 bg-card/40 p-2">
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
        <p className="text-[0.6rem] text-muted-foreground/80 truncate">{hint}</p>
      </div>
      <div className="flex flex-wrap gap-1">
        {strategies.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSelect(s)}
            className={cn(
              "h-7 px-2.5 rounded-md border text-[0.7rem] font-medium transition-colors",
              selected === s
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card hover:bg-muted/40 text-muted-foreground",
            )}
          >
            {t(`signal.backtest.strategy.${s}`, strategyLabelParams(s))}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Look up the placeholder values a strategy's label / hint expects.
 *
 * Three of our strategies (sma_cross, ema_cross, rsi_reversion) render
 * their windows / thresholds inside the label — e.g. "SMA Cross
 * (50/200)". Those numbers are env-tunable (see
 * `lib/backtest-strategy-config.ts`), so the i18n strings contain
 * `{fast}/{slow}` etc. placeholders that get interpolated from the
 * resolved params here.
 *
 * Any strategy whose label doesn't reference numeric parameters just
 * returns `undefined` — `t()` treats that as "no interpolation".
 *
 * Exported so surfaces outside the ConfigPanel (e.g. the history
 * sidebar in `app/backtest/page.tsx`) can render the same
 * env-configured labels without re-implementing the mapping.
 */
export function strategyLabelParams(
  s: BacktestStrategy,
): Record<string, string | number> | undefined {
  switch (s) {
    case "sma_cross":
      return {
        fast: BACKTEST_STRATEGY_PARAMS.smaCross.fast,
        slow: BACKTEST_STRATEGY_PARAMS.smaCross.slow,
      };
    case "ema_cross":
      return {
        fast: BACKTEST_STRATEGY_PARAMS.emaCross.fast,
        slow: BACKTEST_STRATEGY_PARAMS.emaCross.slow,
      };
    case "rsi_reversion":
      return {
        period: BACKTEST_STRATEGY_PARAMS.rsiReversion.period,
        oversold: BACKTEST_STRATEGY_PARAMS.rsiReversion.oversold,
        overbought: BACKTEST_STRATEGY_PARAMS.rsiReversion.overbought,
      };
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Config panel
// ---------------------------------------------------------------------------

export function ConfigPanel({
  cfg,
  setCfg,
  running,
  onRun,
}: {
  cfg: ConfigState;
  setCfg: React.Dispatch<React.SetStateAction<ConfigState>>;
  running: boolean;
  onRun: () => void;
}) {
  const t = useT();
  return (
    <div className="rounded-md border border-border bg-card/50 p-3 space-y-3">
      {/* Strategy picker — full-width because there are now 10 options
          grouped into 3 categories. Vertical stacking keeps every
          strategy readable on mobile. */}
      <div>
        <label className="metric-label">{t("signal.backtest.strategy")}</label>
        <div className="mt-1 space-y-2">
          <StrategyGroup
            title={t("signal.backtest.group.composite")}
            hint={t("signal.backtest.group.composite.hint")}
            strategies={["master", "technical", "resonance" ]}
            selected={cfg.strategy}
            onSelect={(s) => setCfg((c) => ({ ...c, strategy: s }))}
          />
          <StrategyGroup
            title={t("signal.backtest.group.trend")}
            hint={t("signal.backtest.group.trend.hint")}
            strategies={["sma_cross", "ema_cross", "macd_cross"]}
            selected={cfg.strategy}
            onSelect={(s) => setCfg((c) => ({ ...c, strategy: s }))}
          />
          <StrategyGroup
            title={t("signal.backtest.group.meanRev")}
            hint={t("signal.backtest.group.meanRev.hint")}
            strategies={["rsi_reversion", "kdj_cross", "bbands_reversion", "sr_bounce"]}
            selected={cfg.strategy}
            onSelect={(s) => setCfg((c) => ({ ...c, strategy: s }))}
          />
        </div>
        <p className="text-[0.65rem] text-muted-foreground mt-1.5">
          {t(
            `signal.backtest.strategyHint.${cfg.strategy}`,
            strategyLabelParams(cfg.strategy),
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="metric-label">{t("signal.backtest.execution")}</label>
          <div className="mt-1 grid grid-cols-2 gap-1">
            {(["nextOpen", "sameClose"] as const).map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setCfg((c) => ({ ...c, execution: e }))}
                className={cn(
                  "h-8 rounded-md border text-xs font-medium transition-colors",
                  cfg.execution === e
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card hover:bg-muted/40 text-muted-foreground",
                )}
              >
                {t(`signal.backtest.execution.${e}`)}
              </button>
            ))}
          </div>
          <p className="text-[0.65rem] text-muted-foreground mt-1">
            {t(`signal.backtest.executionHint.${cfg.execution}`)}
          </p>
        </div>

        <div>
          <label className="metric-label">{t("signal.backtest.sizing")}</label>
          <div className="mt-1 grid grid-cols-3 gap-1">
            {(["all_in", "fixed_shares", "percent_equity"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setCfg((c) => ({ ...c, sizingKind: k }))}
                className={cn(
                  "h-8 rounded-md border text-xs font-medium transition-colors",
                  cfg.sizingKind === k
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card hover:bg-muted/40 text-muted-foreground",
                )}
              >
                {t(`signal.backtest.sizing.${k}`)}
              </button>
            ))}
          </div>
          {cfg.sizingKind === "fixed_shares" && (
            <div className="mt-2">
              <label className="text-[0.65rem] text-muted-foreground">
                {t("signal.backtest.field.sharesPerBuy")}
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={cfg.fixedShares}
                onChange={(e) =>
                  setCfg((c) => ({ ...c, fixedShares: e.target.value }))
                }
                className="mt-0.5 w-full h-8 rounded-md border border-border bg-card px-2 text-sm tabular-nums"
              />
            </div>
          )}
          {cfg.sizingKind === "percent_equity" && (
            <div className="mt-2">
              <label className="text-[0.65rem] text-muted-foreground">
                {t("signal.backtest.field.percentEquity")}
              </label>
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                value={cfg.percentEquity}
                onChange={(e) =>
                  setCfg((c) => ({ ...c, percentEquity: e.target.value }))
                }
                className="mt-0.5 w-full h-8 rounded-md border border-border bg-card px-2 text-sm tabular-nums"
              />
            </div>
          )}
        </div>

        <div>
          <label className="metric-label">{t("signal.backtest.period")}</label>
          <div className="mt-1 grid grid-cols-6 gap-1">
            {(["6mo", "1y", "2y", "5y", "10y", "max"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setCfg((c) => ({ ...c, period: p }))}
                className={cn(
                  "h-8 rounded-md border text-[0.7rem] font-medium transition-colors",
                  cfg.period === p
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card hover:bg-muted/40 text-muted-foreground",
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="metric-label">{t("signal.backtest.startingCash")}</label>
          <input
            type="number"
            min="100"
            step="100"
            value={cfg.startingCash}
            onChange={(e) => setCfg((c) => ({ ...c, startingCash: e.target.value }))}
            className="mt-1 w-full h-9 rounded-md border border-border bg-card px-3 text-sm tabular-nums"
          />
        </div>

        <div>
          <label className="metric-label">{t("signal.backtest.fearGreed")}</label>
          <label className="mt-1 flex items-center gap-2 h-9 text-xs">
            <input
              type="checkbox"
              checked={cfg.includeFearGreed}
              onChange={(e) =>
                setCfg((c) => ({ ...c, includeFearGreed: e.target.checked }))
              }
              className="rounded border-border"
            />
            <span className="text-muted-foreground">
              {t("signal.backtest.fearGreedToggle")}
            </span>
          </label>
          <p className="text-[0.65rem] text-muted-foreground">
            {t("signal.backtest.fearGreedHint")}
          </p>
        </div>
      </div>

      {/* Protective exits (SL / TP overlay). Full-width block so the
          picker + two inputs sit on one row without competing with the
          sizing/period grid above. Off by default; users have to opt in. */}
      <TargetsSection cfg={cfg} setCfg={setCfg} />

      <div className="flex justify-end pt-1">
        <Button onClick={onRun} disabled={running}>
          {running ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              {t("signal.backtest.running")}
            </>
          ) : (
            <>
              <ChevronsRight className="h-3.5 w-3.5 mr-1.5" />
              {t("signal.backtest.run")}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

/**
 * Stop-loss / take-profit picker. Three modes exposed:
 *
 *   * **Off** — no protective exits; the strategy's own signal is the
 *     only thing that closes a position. Matches original behaviour.
 *   * **Fixed %** — two inline whole-number-percent inputs. Leaving
 *     one blank disables that side of the bracket.
 *   * **Smart pick** — hands the entry off to
 *     `lib/target-recommender.ts` at each buy. Same recommender the
 *     paper-trading "Smart pick" button uses live; a one-line
 *     explainer below tells the user what it looks at (ATR, trend,
 *     support/resistance) so they know why the levels change per
 *     entry.
 *
 * Kept as its own component so the ConfigPanel body stays a flat
 * sequence of top-level sections (strategy → grid → targets →
 * run button), which reads more clearly than a nested conditional.
 */
function TargetsSection({
  cfg,
  setCfg,
}: {
  cfg: ConfigState;
  setCfg: React.Dispatch<React.SetStateAction<ConfigState>>;
}) {
  const t = useT();
  return (
    <div className="rounded-md border border-border/60 bg-card/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <label className="metric-label">
          {t("signal.backtest.targets.title")}
        </label>
        <p className="text-[0.6rem] text-muted-foreground/80 truncate">
          {t("signal.backtest.targets.subtitle")}
        </p>
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1">
        {(["off", "fixed_pct", "smart"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setCfg((c) => ({ ...c, targetsKind: k }))}
            className={cn(
              "h-8 rounded-md border text-xs font-medium transition-colors",
              cfg.targetsKind === k
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card hover:bg-muted/40 text-muted-foreground",
            )}
          >
            {t(`signal.backtest.targets.kind.${k}`)}
          </button>
        ))}
      </div>

      {cfg.targetsKind === "fixed_pct" && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <label className="text-[0.65rem] text-muted-foreground">
              {t("signal.backtest.targets.stopLoss")} ({t("signal.backtest.targets.pctUnit")})
            </label>
            <input
              type="number"
              min="0"
              max="50"
              step="0.5"
              placeholder={t("signal.backtest.targets.leaveBlank")}
              value={cfg.stopLossPct}
              onChange={(e) => setCfg((c) => ({ ...c, stopLossPct: e.target.value }))}
              className="mt-0.5 w-full h-8 rounded-md border border-border bg-card px-2 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="text-[0.65rem] text-muted-foreground">
              {t("signal.backtest.targets.takeProfit")} ({t("signal.backtest.targets.pctUnit")})
            </label>
            <input
              type="number"
              min="0"
              max="200"
              step="0.5"
              placeholder={t("signal.backtest.targets.leaveBlank")}
              value={cfg.takeProfitPct}
              onChange={(e) => setCfg((c) => ({ ...c, takeProfitPct: e.target.value }))}
              className="mt-0.5 w-full h-8 rounded-md border border-border bg-card px-2 text-sm tabular-nums"
            />
          </div>
        </div>
      )}

      <p className="mt-1.5 text-[0.65rem] text-muted-foreground leading-snug">
        {t(`signal.backtest.targets.hint.${cfg.targetsKind}`)}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export function ResultsPanel({
  response,
  saveState,
  saveName,
  onSaveNameChange,
  onSave,
  adviceSlot,
}: {
  response: BacktestResponse;
  saveState: SavePanelState;
  saveName: string;
  onSaveNameChange: (s: string) => void;
  onSave: () => void;
  /**
   * Optional slot rendered directly above the headline. The
   * `/backtest` page uses this to inject the beginner-mode advice
   * banner. Callers who don't want it can omit the prop.
   */
  adviceSlot?: React.ReactNode;
}) {
  const t = useT();
  const { result, ticker, firstBarAt, lastBarAt } = response;
  const m = result.metrics;
  const outperformed = m.totalReturn > m.buyHoldReturn;
  const positive = m.totalReturn >= 0;

  return (
    <div className="space-y-3">
      {adviceSlot}

      {/* Headline */}
      <div className="rounded-md border border-border bg-card/50 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground">
              {t("signal.backtest.headline.window", {
                from: firstBarAt.slice(0, 10),
                to: lastBarAt.slice(0, 10),
                days: fmtNumber(m.spanDays, 0),
              })}
            </p>
            <p
              className={cn(
                "text-2xl font-bold tabular-nums mt-1",
                positive ? "text-success" : "text-danger",
              )}
            >
              {fmtSignedPercent(m.totalReturn)}
            </p>
            <p className="text-xs text-muted-foreground">
              {fmtCurrency(m.finalEquity)} · {t("signal.backtest.trades", { n: m.tradeCount })}
              {" · "}
              {t("signal.backtest.exposure", {
                pct: fmtNumber(m.exposureFraction * 100, 0),
              })}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">
              {t("signal.backtest.buyHold")}
            </p>
            <p
              className={cn(
                "text-lg font-semibold tabular-nums",
                m.buyHoldReturn >= 0 ? "text-success" : "text-danger",
              )}
            >
              {fmtSignedPercent(m.buyHoldReturn)}
            </p>
            <span
              className={cn(
                "inline-block mt-0.5 rounded-full px-2 py-0.5 text-[0.6rem] font-semibold",
                outperformed
                  ? "bg-success/15 text-success"
                  : "bg-warning/15 text-warning",
              )}
            >
              {outperformed
                ? t("signal.backtest.outperformed")
                : t("signal.backtest.underperformed")}
            </span>
          </div>
        </div>

        {result.hasUnfilledFinalSignal && (
          <p className="mt-2 text-[0.7rem] text-warning">
            {t("signal.backtest.unfilledFinal")}
          </p>
        )}
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <MetricTile
          label={t("signal.backtest.metric.maxDrawdown")}
          value={fmtSignedPercent(-m.maxDrawdown)}
          hint={t("signal.backtest.metric.maxDrawdownHint")}
          tone="bad"
        />
        <MetricTile
          label={t("signal.backtest.metric.cagr")}
          value={m.cagr === null ? "—" : fmtSignedPercent(m.cagr)}
          hint={t("signal.backtest.metric.cagrHint")}
          tone={m.cagr !== null && m.cagr >= 0 ? "good" : "bad"}
        />
        <MetricTile
          label={t("signal.backtest.metric.winRate")}
          value={m.winRate === null ? "—" : fmtSignedPercent(m.winRate).replace("+", "")}
          hint={t("signal.backtest.metric.winRateHint")}
          tone="neutral"
        />
        <MetricTile
          label={t("signal.backtest.metric.payoff")}
          value={m.payoffRatio === null ? "—" : m.payoffRatio.toFixed(2) + "×"}
          hint={t("signal.backtest.metric.payoffHint")}
          tone={m.payoffRatio !== null && m.payoffRatio >= 1 ? "good" : "bad"}
        />
      </div>

      {/* Exit-mix breakdown — only render when the SL/TP overlay is
          actively shaping the result. If every exit was signal-driven,
          this widget is noise (the trade log already shows the split
          via colours). */}
      <ExitMixWidget
        exitCounts={m.exitCounts}
        targets={response.result.config.targets}
      />

      {/* Equity sparkline */}
      <div className="rounded-md border border-border bg-card/50 p-3">
        <div className="flex items-center justify-between">
          <p className="metric-label">{t("signal.backtest.equityCurve")}</p>
          <p className="text-[0.6rem] text-muted-foreground">
            {t("signal.backtest.legend")}
          </p>
        </div>
        <div className="mt-2">
          <EquitySparkline
            points={result.equityCurve.slice(result.warmupBars)}
            warmupBars={result.warmupBars}
          />
        </div>
      </div>

      {/* Trade log */}
      <TradeLog trades={result.trades} ticker={ticker} />

      {/* Save as portfolio */}
      <SavePanel
        saveName={saveName}
        onSaveNameChange={onSaveNameChange}
        onSave={onSave}
        saveState={saveState}
        canSave={result.trades.length > 0}
      />
    </div>
  );
}

/**
 * Compact chip-row that surfaces the exit-reason breakdown emitted
 * by the engine (`metrics.exitCounts`). Rendered only when the SL/TP
 * overlay actually fired at least once — otherwise it's noise on top
 * of an already-busy layout.
 *
 * The visualisation is deliberately not a stacked bar: three chips
 * with counts is faster to read at a glance, and — more importantly
 * — the chips can carry translated labels for what each exit reason
 * *means* without the user needing to hover a legend.
 */
function ExitMixWidget({
  exitCounts,
  targets,
}: {
  exitCounts: BacktestResult["metrics"]["exitCounts"];
  targets: BacktestResult["config"]["targets"];
}) {
  const t = useT();
  const totalExits =
    exitCounts.signal + exitCounts.stopLoss + exitCounts.takeProfit;
  const overlayActive = targets && targets.kind !== "off";
  // Don't render when the overlay is off (no SL/TP means only signal
  // exits, which the metrics tiles already cover) OR when there
  // simply weren't any exits yet (a strategy still holding its first
  // buy).
  if (!overlayActive || totalExits === 0) return null;
  const kindLabel = t(`signal.backtest.targets.kind.${targets.kind}`);
  return (
    <div className="rounded-md border border-border bg-card/50 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="metric-label">{t("signal.backtest.exitMix.title")}</p>
        <p className="text-[0.6rem] text-muted-foreground">
          {t("signal.backtest.exitMix.overlay", { kind: kindLabel })}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <ExitChip
          label={t("signal.backtest.exitMix.signal")}
          count={exitCounts.signal}
          total={totalExits}
          tone="neutral"
        />
        <ExitChip
          label={t("signal.backtest.exitMix.stopLoss")}
          count={exitCounts.stopLoss}
          total={totalExits}
          tone="bad"
        />
        <ExitChip
          label={t("signal.backtest.exitMix.takeProfit")}
          count={exitCounts.takeProfit}
          total={totalExits}
          tone="good"
        />
      </div>
      <p className="mt-2 text-[0.65rem] text-muted-foreground leading-snug">
        {t("signal.backtest.exitMix.hint")}
      </p>
    </div>
  );
}

function ExitChip({
  label,
  count,
  total,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  tone: "good" | "bad" | "neutral";
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div
      className={cn(
        "flex-1 min-w-[7rem] rounded-md border px-2.5 py-1.5",
        tone === "good" && "border-success/40 bg-success/10",
        tone === "bad" && "border-danger/40 bg-danger/10",
        tone === "neutral" && "border-border bg-card/60",
      )}
    >
      <p className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "text-base font-semibold tabular-nums",
          tone === "good" && "text-success",
          tone === "bad" && "text-danger",
        )}
      >
        {count}
        <span className="text-[0.65rem] font-normal opacity-70 ml-1.5">
          {pct}%
        </span>
      </p>
    </div>
  );
}

function MetricTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "good" | "bad" | "neutral";
}) {
  return (
    <div className="rounded-md border border-border bg-card/40 p-2.5">
      <p className="text-[0.6rem] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-lg font-semibold tabular-nums",
          tone === "good" && "text-success",
          tone === "bad" && "text-danger",
        )}
      >
        {value}
      </p>
      <p className="text-[0.6rem] text-muted-foreground mt-0.5 leading-tight">
        {hint}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

/**
 * Inline SVG equity vs buy-and-hold comparison, with an interactive
 * hover / touch tooltip that surfaces the two curves' exact values
 * (and their delta) at any bar the user points at.
 *
 * Kept in-file (no chart lib dep) so the page can render
 * synchronously. The SVG itself uses `preserveAspectRatio="none"` +
 * a fixed viewBox — that's how the curves stretch to fill any
 * container width — but the tooltip lives in an absolutely
 * positioned `<div>` overlay measured against the real DOM rect so
 * its coordinates line up with the visible pixels.
 *
 * Pointer events are used (rather than the older mouseenter /
 * mouseleave / touchstart split) so a single handler set covers
 * both mouse and touch. On mobile, dragging a finger across the
 * chart continuously updates the tooltip; lifting the finger clears
 * it. On desktop, moving the mouse in / out has the same effect.
 */
function EquitySparkline({
  points,
  warmupBars,
}: {
  points: EquityPoint[];
  warmupBars: number;
}) {
  const t = useT();
  const locale = useLocale();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);

  if (points.length < 2) {
    return (
      <p className="text-xs text-muted-foreground text-center py-6">
        {t("signal.backtest.equity.empty")}
      </p>
    );
  }

  const width = 640;
  const height = 160;
  const padX = 4;
  const padY = 6;

  const equity = points.map((p) => p.equity);
  const buyHold = points.map((p) => p.buyHoldEquity);
  const all = equity.concat(buyHold);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const range = Math.max(1e-9, max - min);
  const step = (width - 2 * padX) / (points.length - 1);

  const xForIdx = (i: number) => padX + i * step;
  const yForVal = (v: number) =>
    padY + (height - 2 * padY) * (1 - (v - min) / range);

  const toPath = (values: number[]) =>
    values
      .map((v, i) => `${i === 0 ? "M" : "L"} ${xForIdx(i).toFixed(2)} ${yForVal(v).toFixed(2)}`)
      .join(" ");

  // Client-X → bar index. We can't just use the SVG's viewBox math
  // because `preserveAspectRatio="none"` stretches horizontally to
  // an unknown pixel width — so we sample the *real* DOM rect. Also
  // clamp to [0, points.length - 1] so a slight overshoot at the
  // edges (very common on touch) doesn't crash the lookup.
  const idxFromClientX = (clientX: number): number => {
    const el = containerRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const rel = (clientX - rect.left) / rect.width;
    const raw = Math.round(rel * (points.length - 1));
    return Math.max(0, Math.min(points.length - 1, raw));
  };

  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    setHoverIdx(idxFromClientX(e.clientX));
  };
  const handleLeave = () => setHoverIdx(null);

  const point = hoverIdx !== null ? points[hoverIdx] : null;
  const firstPoint = points[0]!;
  // Delta versus the start of the visible window. We use the first
  // point of the plotted slice (which sits at warm-up + 1) rather
  // than the run's `startingCash` because that's what the curves
  // themselves are drawn against — the two are the same by
  // construction so this stays honest either way.
  const baselineEquity = firstPoint.equity;
  const baselineBuyHold = firstPoint.buyHoldEquity;

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="w-full h-40 touch-none"
        onPointerMove={handleMove}
        onPointerDown={handleMove}
        onPointerLeave={handleLeave}
        onPointerCancel={handleLeave}
        onPointerUp={handleLeave}
        role="img"
        aria-label={t("signal.backtest.equityCurve")}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-full block"
          preserveAspectRatio="none"
        >
          <path
            d={toPath(buyHold)}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.4}
            strokeWidth={1.5}
            className="text-muted-foreground"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={toPath(equity)}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="text-primary"
            vectorEffect="non-scaling-stroke"
          />

          {hoverIdx !== null && point && (
            <g pointerEvents="none">
              {/* Vertical crosshair at the hovered bar. */}
              <line
                x1={xForIdx(hoverIdx)}
                x2={xForIdx(hoverIdx)}
                y1={padY}
                y2={height - padY}
                stroke="currentColor"
                strokeOpacity={0.3}
                strokeWidth={1}
                strokeDasharray="3 3"
                className="text-muted-foreground"
                vectorEffect="non-scaling-stroke"
              />
              {/* Two focus dots — one per curve. */}
              <circle
                cx={xForIdx(hoverIdx)}
                cy={yForVal(point.buyHoldEquity)}
                r={3}
                className="fill-muted-foreground"
                opacity={0.7}
              />
              <circle
                cx={xForIdx(hoverIdx)}
                cy={yForVal(point.equity)}
                r={3.5}
                className="fill-primary"
              />
            </g>
          )}
        </svg>
      </div>

      {/* Reserve enough vertical space for the tooltip so that the
          hint → tooltip transition doesn't shove the trade log
          below the chart around as the user hovers. The floor is
          sized for the mobile 1-column layout (4 stacked rows +
          divider + padding); on desktop the 2-column grid uses
          less vertical space but the same slot. */}
      <div className="mt-1 min-h-[5rem] sm:min-h-[4rem]">
        {point && hoverIdx !== null ? (
          <EquityTooltip
            point={point}
            baselineEquity={baselineEquity}
            baselineBuyHold={baselineBuyHold}
            locale={locale}
            t={t}
          />
        ) : (
          <p className="text-[0.6rem] text-muted-foreground text-center pt-2">
            {t("signal.backtest.equity.tip.hint")}
          </p>
        )}
      </div>
      {void warmupBars}
    </div>
  );
}

/**
 * Read-out card for the equity sparkline, rendered in normal flow
 * directly below the chart. Kept as its own component so the parent
 * doesn't have to re-render every SVG path on every mouse-move —
 * only this tiny subtree re-renders as the user drags across the
 * chart.
 *
 * Sits BELOW the chart (rather than floating over it) so the
 * tooltip never occludes the curves — a common UX gripe with
 * overlay tooltips when the strategy has climbed toward the top of
 * the drawing area. The parent reserves a fixed minimum height for
 * this slot (see EquitySparkline) so hovering doesn't shove the
 * page contents below the chart around as the tooltip appears /
 * disappears.
 */
function EquityTooltip({
  point,
  baselineEquity,
  baselineBuyHold,
  locale,
  t,
}: {
  point: EquityPoint;
  baselineEquity: number;
  baselineBuyHold: number;
  locale: Locale;
  t: ReturnType<typeof useT>;
}) {
  const strategyDeltaAbs = point.equity - baselineEquity;
  const strategyDeltaPct =
    baselineEquity > 0 ? strategyDeltaAbs / baselineEquity : 0;
  const buyHoldDeltaAbs = point.buyHoldEquity - baselineBuyHold;
  const buyHoldDeltaPct =
    baselineBuyHold > 0 ? buyHoldDeltaAbs / baselineBuyHold : 0;
  const diffAbs = point.equity - point.buyHoldEquity;
  const diffPct = point.buyHoldEquity > 0 ? diffAbs / point.buyHoldEquity : 0;

  // Signed dollar diff — reuse fmtCurrency for the absolute value
  // then hand-prepend the sign so we get e.g. "+$1,234.56" /
  // "-$1,234.56" in the same house style as the rest of the
  // panel's dollar figures.
  const signedDiffLabel =
    (diffAbs >= 0 ? "+" : "−") + fmtCurrency(Math.abs(diffAbs));

  // Locale-aware date formatter. `EquityPoint.time` is Unix seconds
  // (see `lib/signal-backtest.ts::runBacktest` where `fillBarTime
  // * 1000` is used to build ISO dates), so we multiply here too.
  const dateLabel = new Date(point.time * 1000).toLocaleDateString(
    locale === "zh-CN" ? "zh-CN" : "en-US",
    { year: "numeric", month: "short", day: "numeric" },
  );

  return (
    <div className="rounded-md border border-border bg-card/70 px-2.5 py-1.5 text-[0.7rem] tabular-nums">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="font-medium text-muted-foreground">{dateLabel}</p>
        <p className="text-[0.6rem] text-muted-foreground">
          {point.positionShares > 0
            ? t("signal.backtest.equity.tip.invested", {
                shares: fmtNumber(point.positionShares, 0),
              })
            : t("signal.backtest.equity.tip.cash")}
        </p>
      </div>
      <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
        <TooltipRow
          dotClass="bg-primary"
          label={t("signal.backtest.equity.tip.strategy")}
          value={fmtCurrency(point.equity)}
          delta={strategyDeltaPct}
          deltaLabel={t("signal.backtest.equity.tip.vsStart")}
        />
        <TooltipRow
          dotClass="bg-muted-foreground/60"
          label={t("signal.backtest.equity.tip.buyHold")}
          value={fmtCurrency(point.buyHoldEquity)}
          delta={buyHoldDeltaPct}
          deltaLabel={t("signal.backtest.equity.tip.vsStart")}
        />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 border-t border-border/60 pt-1 text-[0.65rem]">
        <span className="text-muted-foreground">
          {t("signal.backtest.equity.tip.diff")}
        </span>
        <span
          className={cn(
            "font-medium",
            diffAbs >= 0 ? "text-success" : "text-danger",
          )}
        >
          {signedDiffLabel}
          <span className="ml-1 opacity-70">
            ({fmtSignedPercent(diffPct)})
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * One line of the equity tooltip — a coloured dot + label on the
 * left, absolute dollar value on the right with a small
 * signed-percent delta beneath it. Kept generic so both curves
 * (strategy + buy-and-hold) render through the same code path.
 */
function TooltipRow({
  dotClass,
  label,
  value,
  delta,
  deltaLabel,
}: {
  dotClass: string;
  label: string;
  value: string;
  delta: number;
  deltaLabel: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className={cn("inline-block h-1.5 w-1.5 rounded-full", dotClass)} />
        {label}
      </span>
      <span className="text-right">
        <span className="font-semibold text-foreground">{value}</span>
        <span
          className={cn(
            "ml-1 text-[0.6rem]",
            delta >= 0 ? "text-success" : "text-danger",
          )}
          title={deltaLabel}
        >
          {fmtSignedPercent(delta)}
        </span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trade log
// ---------------------------------------------------------------------------

/**
 * Small status pill next to a Buy row's "buy" label showing whether
 * the position it opened was ever closed inside the backtest window.
 * Mirrors the identical concept in the paper-trading and my-portfolio
 * views so the user sees one grammar for "Open / Closed lot" across
 * every trade-log surface. Deliberately duplicated (not lifted into
 * a shared component) because each surface owns its own tiny colour
 * / typography scale — the total cost of the three copies is ~30
 * lines and the risk of a "changed one, forgot the others" bug is
 * lower than the risk of a shared component quietly forcing a
 * styling change onto surfaces that shouldn't get it.
 *
 * Only two states here (no "partial") because `runBacktest` is
 * all-or-nothing: every sell closes the entire open position, so a
 * buy is either fully Open (position still held at window close) or
 * fully Closed by a subsequent Sell.
 */
function LotStatusChip({ status }: { status: "open" | "closed" }) {
  const t = useT();
  const tone =
    status === "open"
      ? "border-primary/30 bg-primary/10 text-primary"
      : "border-border bg-muted/40 text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-[1px] text-[0.55rem] font-medium uppercase tracking-wider",
        tone,
      )}
      title={t(`signal.backtest.trades.lotStatus.${status}Tooltip`)}
    >
      {t(`signal.backtest.trades.lotStatus.${status}`)}
    </span>
  );
}

/**
 * Two-letter badge that flags a Sell as SL (stop-loss) or TP
 * (take-profit) instead of a signal flip. Colour-coded to match the
 * exit-mix widget so the two surfaces speak the same visual grammar.
 * The `title` carries the full translated phrase for accessibility
 * on hover / long-press.
 */
function ExitReasonChip({
  exitReason,
}: {
  exitReason: "stop_loss" | "take_profit";
}) {
  const t = useT();
  const tone =
    exitReason === "stop_loss"
      ? "border-danger/40 bg-danger/10 text-danger"
      : "border-success/40 bg-success/10 text-success";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-[1px] text-[0.55rem] font-medium uppercase tracking-wider",
        tone,
      )}
      title={t(`signal.backtest.trades.exitReason.${exitReason}`)}
    >
      {exitReason === "stop_loss" ? "SL" : "TP"}
    </span>
  );
}

/**
 * Attribution table — one entry per input trade, in the SAME order
 * as the input, telling the renderer:
 *
 *   • For a Buy: the realized P&L that later got extracted from
 *     this buy by its matching Sell (or `null` if the position was
 *     never closed inside the window), and the lot status.
 *   • For a Sell: nothing (`null` P&L, `null` status).
 *
 * We compute in chronological order because the backtest engine
 * emits trades chronologically and pairs them 1-to-1 (buy → sell
 * → buy → sell → …). A simple "who's the currently-open buy?"
 * pointer is all we need for FIFO matching — the engine never has
 * two open lots at once. See `runBacktest` in `lib/signal-backtest`
 * for the invariant.
 *
 * If the trade log we're passed ever grew to hold overlapping
 * lots (e.g. a future partial-sizing strategy), we'd have to bump
 * this to a proper FIFO deque — but that's a change to the engine
 * first, not to this helper.
 */
function attributeTradesByLot(trades: BacktestTrade[]): {
  realizedPnl: number | null;
  lotStatus: "open" | "closed" | null;
}[] {
  const out = new Array<{
    realizedPnl: number | null;
    lotStatus: "open" | "closed" | null;
  }>(trades.length);

  // Index of the currently-open Buy waiting to be closed by the
  // next Sell. `null` when we're flat.
  let openBuyIdx: number | null = null;

  for (let i = 0; i < trades.length; i++) {
    const tr = trades[i]!;
    if (tr.side === "buy") {
      // Start optimistic: this buy is Open until (if ever) a
      // matching Sell overwrites the entry below.
      out[i] = { realizedPnl: null, lotStatus: "open" };
      openBuyIdx = i;
    } else {
      // Sell rows never carry realized P&L or a lot status —
      // both live on the corresponding Buy row now.
      out[i] = { realizedPnl: null, lotStatus: null };
      if (openBuyIdx !== null) {
        // Attribute this sell's realized P&L back onto the buy
        // it just closed. `tr.realizedPnl` on a Sell is exactly
        // `(sellPrice − buyAvgCost) × shares` from the engine,
        // which — because the backtest is all-or-nothing — is
        // the *whole* P&L of the round trip.
        out[openBuyIdx] = {
          realizedPnl: tr.realizedPnl,
          lotStatus: "closed",
        };
        openBuyIdx = null;
      }
      // No matching open buy: the engine shouldn't emit this
      // (sells only fire when a position exists), but we don't
      // trust that invariant here — if it happens, leave the
      // sell's attribution as null/null and move on.
    }
  }

  return out;
}

function TradeLog({
  trades,
  ticker,
}: {
  trades: BacktestTrade[];
  ticker: string;
}) {
  const t = useT();

  // Pre-compute lot attribution ONCE on the full trades array in
  // chronological order — before reversing / slicing for display —
  // so the pairing stays correct even when we only show the tail.
  //
  // The `attribution` array is index-aligned with `trades`; we
  // carry the original index onto each rendered row so the reverse
  // + slice pass below can look up its entry.
  const attribution = React.useMemo(
    () => attributeTradesByLot(trades),
    [trades],
  );

  if (trades.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card/50 p-3 text-center text-xs text-muted-foreground">
        {t("signal.backtest.trades.empty")}
      </div>
    );
  }

  // Reverse for display (newest first) but keep the original
  // chronological index alongside each row so we can index into
  // `attribution` without a separate map.
  const rows = trades
    .map((tr, origIdx) => ({ tr, origIdx }))
    .reverse()
    .slice(0, 200);

  return (
    <div className="rounded-md border border-border bg-card/50">
      <div className="flex items-center justify-between p-2">
        <p className="metric-label">
          {t("signal.backtest.tradeLog", { n: trades.length })}
        </p>
        {trades.length > 200 && (
          <p className="text-[0.6rem] text-muted-foreground">
            {t("signal.backtest.trades.capped")}
          </p>
        )}
      </div>
      <div className="max-h-96 overflow-y-auto border-t border-border">
        <table className="w-full text-xs">
          <thead className="text-[0.6rem] uppercase tracking-wider text-muted-foreground sticky top-0 bg-card">
            <tr>
              <th className="text-left px-2 py-1 font-normal">
                {t("signal.backtest.trades.col.when")}
              </th>
              <th className="text-left px-2 py-1 font-normal">
                {t("signal.backtest.trades.col.side")}
              </th>
              <th className="text-right px-2 py-1 font-normal">
                {t("signal.backtest.trades.col.shares")}
              </th>
              <th className="text-right px-2 py-1 font-normal">
                {t("signal.backtest.trades.col.price")}
              </th>
              <th
                className="text-right px-2 py-1 font-normal"
                title={t("signal.backtest.trades.col.pnlHint")}
              >
                {t("signal.backtest.trades.col.pnl")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ tr, origIdx }) => {
              const attr = attribution[origIdx]!;
              // Displayed P&L follows the Buy-side attribution
              // rule: only Buy rows show a number (from their
              // matched Sell). Sells always show DASH here — the
              // proceeds are still visible via cash-after in the
              // metrics tiles, so no information is lost.
              const displayPnl = attr.realizedPnl;
              const pnlPos = displayPnl !== null && displayPnl > 0;
              const pnlNeg = displayPnl !== null && displayPnl < 0;
              return (
                <tr key={origIdx} className="border-t border-border/50">
                  <td className="px-2 py-1 tabular-nums text-muted-foreground">
                    {new Date(tr.fillBarTime * 1000).toISOString().slice(0, 10)}
                  </td>
                  <td className="px-2 py-1">
                    <span className="inline-flex items-center gap-1.5 flex-wrap">
                      <span
                        className={cn(
                          "font-semibold uppercase text-[0.65rem]",
                          tr.side === "buy" ? "text-success" : "text-danger",
                        )}
                      >
                        {tr.side}
                      </span>
                      <span className="text-muted-foreground">{ticker}</span>
                      {/* Buy rows get an Open / Closed pill so
                          users can tell at a glance which entries
                          were ever exited by the strategy vs. which
                          are still sitting open at window close. */}
                      {tr.side === "buy" && attr.lotStatus && (
                        <LotStatusChip status={attr.lotStatus} />
                      )}
                      {/* Sell rows flag whether the exit was a
                          protective bracket (SL/TP) vs a signal flip.
                          Signal-driven sells stay unadorned so the
                          "normal" case doesn't add visual noise. */}
                      {tr.side === "sell" && tr.exitReason !== "signal" && (
                        <ExitReasonChip exitReason={tr.exitReason} />
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {fmtNumber(tr.shares, 0)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {fmtCurrency(tr.price)}
                  </td>
                  <td
                    className={cn(
                      "px-2 py-1 text-right tabular-nums font-semibold",
                      pnlPos && "text-success",
                      pnlNeg && "text-danger",
                      displayPnl === null && "text-muted-foreground",
                    )}
                  >
                    {displayPnl === null ? (
                      // Two-state DASH: Sell row (attribution
                      // moved to the corresponding Buy) OR Buy
                      // row for a still-open position (no matching
                      // sell yet in the window).
                      "—"
                    ) : (
                      <>
                        {fmtSigned(displayPnl)}
                        <span className="text-[0.55rem] block font-normal opacity-70 uppercase tracking-wider">
                          {t("signal.backtest.trades.pnlFromLot")}
                        </span>
                      </>
                    )}
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
// Save as paper portfolio
// ---------------------------------------------------------------------------

function SavePanel({
  saveName,
  onSaveNameChange,
  onSave,
  saveState,
  canSave,
}: {
  saveName: string;
  onSaveNameChange: (s: string) => void;
  onSave: () => void;
  saveState: SavePanelState;
  canSave: boolean;
}) {
  const t = useT();
  if (saveState.kind === "saved") {
    return (
      <div className="rounded-md border border-success/40 bg-success/10 p-3 flex items-center gap-2 text-sm">
        <Check className="h-4 w-4 text-success" />
        <div className="flex-1">
          <p className="font-semibold text-success">
            {t("signal.backtest.saved.title", { name: saveState.portfolioName })}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("signal.backtest.saved.hint")}
          </p>
        </div>
        <a
          href="/paper"
          className="text-xs underline text-success hover:text-success/80"
        >
          {t("signal.backtest.saved.open")}
        </a>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-card/50 p-3">
      <p className="metric-label">{t("signal.backtest.save.title")}</p>
      <p className="text-xs text-muted-foreground mt-0.5">
        {t("signal.backtest.save.hint")}
      </p>
      <div className="mt-2 flex flex-wrap gap-2 items-center">
        <input
          value={saveName}
          onChange={(e) => onSaveNameChange(e.target.value)}
          placeholder={t("signal.backtest.save.placeholder")}
          maxLength={60}
          className="flex-1 min-w-[200px] h-9 rounded-md border border-border bg-card px-3 text-sm"
        />
        <Button
          onClick={onSave}
          disabled={!canSave || saveState.kind === "saving"}
        >
          {saveState.kind === "saving" ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              {t("signal.backtest.save.saving")}
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5 mr-1.5" />
              {t("signal.backtest.save.button")}
            </>
          )}
        </Button>
      </div>
      {saveState.kind === "error" && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {saveState.message}
        </p>
      )}
    </div>
  );
}
