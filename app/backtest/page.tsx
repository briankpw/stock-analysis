/**
 * `/backtest` — dedicated backtest surface.
 *
 * Used to live as a modal on the Technical Signal card. Now a first-
 * class page under Personal → Backtest because:
 *
 *   * The modal was cramped — 4-metric strip + sparkline + trade log
 *     is a lot to see in a dialog. Full-page has room to breathe and
 *     also room to display the *history* alongside the current run.
 *   * A modal can't be linked to. The page can (and each saved run has
 *     a URL you can revisit via the history list).
 *   * The Personal cluster is where "your stuff you replay again and
 *     again" lives (My Portfolio, Paper Trading, Alert Bot). Backtest
 *     sits naturally next to Paper Trading — both are the same idea
 *     ("simulate the strategy") on different time axes.
 *
 * ## Layout
 *
 * Two columns on desktop, stacked on mobile:
 *
 *   - Left (main): ticker → config → results (+ beginner advice)
 *   - Right (sidebar-adjacent): history list of saved runs
 *
 * ## History semantics
 *
 * Every successful run auto-saves to `backtest_runs` (see
 * `lib/backtest-store.ts`) with a rolling cap (100 rows). Clicking a
 * history row re-renders the page against that stored run — no
 * network re-fetch of price history, no re-run of the engine — so
 * inspecting a past result is instant and matches exactly what the
 * user saw when they first ran it. Old runs never "go stale" that
 * way; if the user wants a fresh read they hit **Run backtest**
 * again.
 */

"use client";

import * as React from "react";
import { Clock, Loader2, Play, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageIntro } from "@/components/page-intro";
import { KeyTerms } from "@/components/key-terms";
import {
  ConfigPanel,
  DEFAULT_CONFIG,
  ResultsPanel,
  defaultPortfolioName,
  readSizing,
  readTargets,
  strategyLabelParams,
  type BacktestResponse,
  type ConfigState,
  type PeriodOpt,
  type SavePanelState,
} from "@/components/backtest-panels";
import { BacktestAdvice } from "@/components/backtest-advice";
import { useUi } from "@/lib/state";
import { useT } from "@/lib/i18n";
import { fmtSignedPercent, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  BacktestStrategy,
  BacktestTrade,
  ExecutionTiming,
} from "@/lib/signal-backtest";

// ---------------------------------------------------------------------------
// Small history-list types (mirror `BacktestRunSummary` from the store)
// ---------------------------------------------------------------------------

interface HistoryRow {
  id: number;
  ticker: string;
  strategy: BacktestStrategy;
  execution: ExecutionTiming;
  period: PeriodOpt;
  startingCash: number;
  label: string;
  totalReturn: number;
  buyHoldReturn: number;
  maxDrawdown: number;
  tradeCount: number;
  winRate: number | null;
  firstBarAt: string;
  lastBarAt: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Data hooks
// ---------------------------------------------------------------------------

/**
 * List saved runs. The `bump` counter is bumped from the page after
 * every run/delete so the list refreshes without a manual re-fetch.
 */
function useHistory(bump: number) {
  const [rows, setRows] = React.useState<HistoryRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch("/api/signal/backtest/history?limit=100");
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        if (!cancelled) setRows(body.runs as HistoryRow[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bump]);
  return { rows, loading, error };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BacktestPage() {
  const t = useT();
  const uiTicker = useUi((s) => s.ticker);

  // Ticker on this page can be overridden separately from the sidebar
  // — a user may want to backtest AAPL while their sidebar is on
  // NVDA. Local `useState` (not zustand) so cross-page navigation
  // doesn't fight the sidebar's pin.
  const [ticker, setTicker] = React.useState<string>(uiTicker);
  const [tickerInput, setTickerInput] = React.useState<string>(uiTicker);

  // When the sidebar ticker changes AND the user hasn't diverged from
  // it, follow along. Once they type something else on this page,
  // stop syncing — a "loose coupling" that respects both flows.
  const lastSyncedFromSidebar = React.useRef<string>(uiTicker);
  React.useEffect(() => {
    if (ticker === lastSyncedFromSidebar.current) {
      setTicker(uiTicker);
      setTickerInput(uiTicker);
      lastSyncedFromSidebar.current = uiTicker;
    }
  }, [uiTicker, ticker]);

  const [cfg, setCfg] = React.useState<ConfigState>(DEFAULT_CONFIG);

  // "running" — POSTing a fresh backtest, which triggers history
  // fetch + engine replay on the server. Slow (a few seconds for
  // multi-year backtests).
  // "loadingHistory" — pulling a saved run out of SQLite. Nearly
  // instant, but a spinner still helps against slow networks.
  const [running, setRunning] = React.useState(false);
  const [loadingHistory, setLoadingHistory] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [response, setResponse] = React.useState<BacktestResponse | null>(null);
  const [openedFromHistoryId, setOpenedFromHistoryId] =
    React.useState<number | null>(null);

  const [saveState, setSaveState] = React.useState<SavePanelState>({ kind: "idle" });
  const [saveName, setSaveName] = React.useState("");

  // History list state — a monotonically-increasing `bump` bumps the
  // hook off the network cache after every run/delete.
  const [historyBump, setHistoryBump] = React.useState(0);
  const { rows: history, loading: historyLoading, error: historyError } =
    useHistory(historyBump);

  const commitTicker = React.useCallback(() => {
    const next = (tickerInput || "").trim().toUpperCase();
    if (!next) return;
    if (!/^[A-Z0-9.\-]+$/.test(next)) {
      setError(t("backtest.err.badTicker"));
      return;
    }
    setError(null);
    setTicker(next);
  }, [t, tickerInput]);

  const run = React.useCallback(async () => {
    setError(null);
    setRunning(true);
    setResponse(null);
    setOpenedFromHistoryId(null);
    setSaveState({ kind: "idle" });
    try {
      const startingCash = Number(cfg.startingCash);
      if (!Number.isFinite(startingCash) || startingCash <= 0) {
        throw new Error(t("signal.backtest.err.badCash"));
      }
      const sizing = readSizing(cfg, t);
      const targets = readTargets(cfg, t);

      const res = await fetch("/api/signal/backtest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ticker,
          strategy: cfg.strategy,
          execution: cfg.execution,
          sizing,
          startingCash,
          period: cfg.period,
          includeFearGreed: cfg.includeFearGreed,
          targets,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body?.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      const resp = body as BacktestResponse;
      setResponse(resp);
      setSaveName(defaultPortfolioName(ticker, cfg.strategy, cfg.period));
      // Sync the "selected" state so the history list highlights the
      // just-saved run — the row will render below after the bump.
      if (typeof resp.savedId === "number") {
        setOpenedFromHistoryId(resp.savedId);
      }
      setHistoryBump((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [cfg, t, ticker]);

  const openHistoryRow = React.useCallback(
    async (id: number) => {
      setError(null);
      setResponse(null);
      setOpenedFromHistoryId(id);
      setSaveState({ kind: "idle" });
      setLoadingHistory(true);
      try {
        const res = await fetch(`/api/signal/backtest/history/${id}`);
        const body = await res.json();
        if (!res.ok || !body?.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        const resp = body as BacktestResponse;
        setResponse(resp);
        // Sync the ticker + config panel to the loaded run so a "Re-run"
        // click reproduces the same test.
        setTicker(resp.ticker);
        setTickerInput(resp.ticker);
        // Sync the SL/TP overlay too. Saved runs include `targets`
        // inside `result.config`; older rows that pre-date this
        // feature won't, so fall back to "off".
        const savedTargets = resp.result.config.targets;
        setCfg((prev) => ({
          ...prev,
          strategy: resp.strategy,
          execution: resp.execution,
          period: resp.period,
          startingCash: String(resp.startingCash),
          sizingKind: resp.sizing.kind,
          fixedShares:
            resp.sizing.kind === "fixed_shares"
              ? String(resp.sizing.shares)
              : prev.fixedShares,
          percentEquity:
            resp.sizing.kind === "percent_equity"
              ? String(Math.round(resp.sizing.pct * 100))
              : prev.percentEquity,
          targetsKind: savedTargets?.kind ?? "off",
          stopLossPct:
            savedTargets?.kind === "fixed_pct" &&
            typeof savedTargets.stopLossPct === "number"
              ? String(+(savedTargets.stopLossPct * 100).toFixed(2))
              : prev.stopLossPct,
          takeProfitPct:
            savedTargets?.kind === "fixed_pct" &&
            typeof savedTargets.takeProfitPct === "number"
              ? String(+(savedTargets.takeProfitPct * 100).toFixed(2))
              : prev.takeProfitPct,
        }));
        setSaveName(defaultPortfolioName(resp.ticker, resp.strategy, resp.period));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadingHistory(false);
      }
    },
    [],
  );

  const deleteRun = React.useCallback(
    async (id: number) => {
      if (!confirm(t("backtest.history.deleteConfirm"))) return;
      try {
        const res = await fetch(`/api/signal/backtest/history/${id}`, {
          method: "DELETE",
        });
        const body = await res.json();
        if (!res.ok || !body?.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        // If we're staring at the row we just deleted, clear the
        // main panel so it doesn't ghost.
        if (openedFromHistoryId === id) {
          setResponse(null);
          setOpenedFromHistoryId(null);
        }
        setHistoryBump((n) => n + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [openedFromHistoryId, t],
  );

  const clearAllHistory = React.useCallback(async () => {
    if (!confirm(t("backtest.history.clearConfirm"))) return;
    try {
      const res = await fetch(`/api/signal/backtest/history`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok || !body?.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setResponse(null);
      setOpenedFromHistoryId(null);
      setHistoryBump((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [t]);

  const saveAsPortfolio = React.useCallback(async () => {
    if (!response) return;
    setSaveState({ kind: "saving" });
    try {
      const trades = response.result.trades.map((tr: BacktestTrade) => ({
        symbol: response.ticker,
        side: tr.side,
        shares: tr.shares,
        price: tr.price,
        commission: 0,
        note: `Backtest · ${tr.reason}`,
        createdAt: new Date(tr.fillBarTime * 1000).toISOString(),
      }));
      const res = await fetch("/api/paper/portfolios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name:
            saveName.trim() ||
            defaultPortfolioName(response.ticker, response.strategy, response.period),
          startingCash: response.startingCash,
          trades,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body?.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setSaveState({
        kind: "saved",
        portfolioId: body.portfolio.id,
        portfolioName: body.portfolio.name,
      });
    } catch (e) {
      setSaveState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [response, saveName]);

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1600px] mx-auto">
      {/* Page title */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{t("backtest.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("backtest.pageSubtitle")}
          </p>
        </div>
      </div>

      <PageIntro pageKey="backtest" />

      {/* Two-column layout: config + result on the left, history on the right */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-4">
        {/* --- Left column ------------------------------------------- */}
        <div className="space-y-4 min-w-0">
          {/* Ticker input */}
          <div className="rounded-md border border-border bg-card/50 p-3">
            <label className="metric-label">{t("backtest.tickerLabel")}</label>
            <form
              className="mt-1 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                commitTicker();
              }}
            >
              <input
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                onBlur={commitTicker}
                maxLength={12}
                placeholder="AAPL"
                className="flex-1 h-9 rounded-md border border-border bg-card px-3 text-sm tabular-nums uppercase"
                aria-label={t("backtest.tickerLabel")}
              />
              <Button type="submit" variant="outline">
                {t("backtest.tickerSet")}
              </Button>
            </form>
            <p className="text-[0.65rem] text-muted-foreground mt-1">
              {t("backtest.tickerHint", { current: ticker })}
            </p>
          </div>

          {/* Config */}
          <ConfigPanel cfg={cfg} setCfg={setCfg} running={running} onRun={run} />

          {error && (
            <div
              className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
              role="alert"
            >
              {error}
            </div>
          )}

          {(running || loadingHistory) && !response && (
            <div className="rounded-md border border-border bg-card/50 p-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {loadingHistory
                ? t("backtest.loadingHistory")
                : t("backtest.running")}
            </div>
          )}

          {response && (
            <ResultsPanel
              response={response}
              saveState={saveState}
              saveName={saveName}
              onSaveNameChange={setSaveName}
              onSave={saveAsPortfolio}
              adviceSlot={<BacktestAdvice response={response} />}
            />
          )}

          {!response && !running && !loadingHistory && (
            <div className="rounded-md border border-dashed border-border p-8 text-center">
              <Play className="h-6 w-6 mx-auto text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground mt-2">
                {t("backtest.emptyState.title")}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("backtest.emptyState.hint")}
              </p>
            </div>
          )}
        </div>

        {/* --- Right column: history --------------------------------- */}
        <aside className="min-w-0">
          <HistoryPanel
            rows={history}
            loading={historyLoading}
            error={historyError}
            openedId={openedFromHistoryId}
            onOpen={openHistoryRow}
            onDelete={deleteRun}
            onClear={clearAllHistory}
            onRefresh={() => setHistoryBump((n) => n + 1)}
          />
        </aside>
      </div>

      <KeyTerms
        terms={[
          // Result-panel read-me-first: the 4-step framework
          // (return → risk → edge → robustness) for turning a wall
          // of metric tiles into a go / no-go decision. Kept first
          // so beginners land on the analysis workflow before
          // clicking any individual tile. See
          // `lib/knowledge.ts::TECHNICAL_TERMS["Reading a Backtest"]`.
          "Reading a Backtest",
          // Headline (top strip of the results panel) — the four
          // numbers you see before scrolling: strategy return,
          // ending dollar value, how many trades fired, and how
          // much of the window was actually spent invested.
          "Total Return",
          "Final Equity",
          "Trade Count",
          "Exposure",
          // Metric tiles (the 4-tile grid) — risk, growth,
          // consistency, and edge quality per trade.
          "Max Drawdown",
          "CAGR",
          "Win Rate",
          "Payoff Ratio",
          "Sharpe Ratio",
          "Buy and Hold",
          // Exit-mix chips (only render when SL/TP overlay is on).
          // Individual entries because each has a distinct
          // interpretation — a beginner needs to know whether "too
          // many stop-loss exits" is bad or fine.
          "Exit Mix",
          "Signal Exit",
          "Stop-Loss Exit",
          "Take-Profit Exit",
          // Trade log & round-trip accounting — bridges the P&L
          // column and the win/loss stats above.
          "Round Trip",
          "Realised P&L",
          "Avg Win",
          "Avg Loss",
          // Chart & mechanics — the equity sparkline and the
          // reason it always starts with a flat cash-only stub.
          "Equity Curve",
          "Warmup Bars",
          // Execution mechanics — Fill Timing bundles the "Next
          // open" vs. "Same close" choice into one glossary entry
          // so a beginner who's staring at the radio buttons
          // doesn't have to guess which mode maps to real trading.
          "Fill Timing",
          // Strategy building-blocks — every single-indicator
          // strategy above maps to one of these. Beginners get an
          // instant glossary for "what is MACD?" without having to
          // navigate to the Charts & Indicators page.
          "SMA",
          "EMA",
          "MACD",
          "RSI",
          "KDJ",
          "Bollinger Bands",
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// History panel
// ---------------------------------------------------------------------------

function HistoryPanel({
  rows,
  loading,
  error,
  openedId,
  onOpen,
  onDelete,
  onClear,
  onRefresh,
}: {
  rows: HistoryRow[];
  loading: boolean;
  error: string | null;
  openedId: number | null;
  onOpen: (id: number) => void;
  onDelete: (id: number) => void;
  onClear: () => void;
  onRefresh: () => void;
}) {
  const t = useT();
  return (
    <div className="rounded-md border border-border bg-card/50">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">
              {t("backtest.history.title")}
            </p>
            <p className="text-[0.65rem] text-muted-foreground">
              {rows.length > 0
                ? t("backtest.history.count", { n: rows.length })
                : t("backtest.history.empty")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onRefresh}
            aria-label={t("common.refresh")}
            title={t("common.refresh")}
            className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted/40 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          {rows.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              aria-label={t("backtest.history.clear")}
              title={t("backtest.history.clear")}
              className="text-muted-foreground hover:text-danger p-1 rounded-md hover:bg-muted/40 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="p-6 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      )}

      {error && !loading && (
        <div
          className="m-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
          role="alert"
        >
          {error}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="p-6 text-center text-xs text-muted-foreground">
          {t("backtest.history.emptyHint")}
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <ul className="divide-y divide-border max-h-[calc(100vh-16rem)] overflow-y-auto">
          {rows.map((r) => (
            <HistoryRowItem
              key={r.id}
              row={r}
              active={openedId === r.id}
              onOpen={() => onOpen(r.id)}
              onDelete={() => onDelete(r.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function HistoryRowItem({
  row,
  active,
  onOpen,
  onDelete,
}: {
  row: HistoryRow;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const outperformed = row.totalReturn > row.buyHoldReturn;
  const positive = row.totalReturn >= 0;
  const created = new Date(row.createdAt);
  return (
    <li
      className={cn(
        "group relative",
        active && "bg-primary/5",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "w-full text-left p-3 hover:bg-muted/40 transition-colors",
          active && "hover:bg-primary/10",
        )}
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-semibold truncate">
            {row.ticker}
            <span className="text-muted-foreground font-normal">
              {" · "}
              {t(
                `signal.backtest.strategy.${row.strategy}`,
                strategyLabelParams(row.strategy),
              )}
              {" · "}
              {row.period}
            </span>
          </p>
          <p
            className={cn(
              "text-sm font-semibold tabular-nums shrink-0",
              positive ? "text-success" : "text-danger",
            )}
          >
            {fmtSignedPercent(row.totalReturn)}
          </p>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[0.65rem] text-muted-foreground">
          <span className="truncate">
            {t("backtest.history.vsBuyHold", {
              buyHold: fmtSignedPercent(row.buyHoldReturn),
            })}
            {" · "}
            {t("backtest.history.trades", { n: row.tradeCount })}
          </span>
          <span
            className={cn(
              "inline-block rounded-full px-1.5 py-0.5 text-[0.55rem] font-semibold shrink-0",
              outperformed
                ? "bg-success/15 text-success"
                : "bg-muted/50 text-muted-foreground",
            )}
          >
            {outperformed
              ? t("backtest.history.beat")
              : t("backtest.history.miss")}
          </span>
        </div>
        <p className="mt-1 text-[0.6rem] text-muted-foreground">
          {relativeTime(created)}
        </p>
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={t("backtest.history.deleteOne")}
        title={t("backtest.history.deleteOne")}
        className="absolute top-2 right-2 text-muted-foreground/50 hover:text-danger opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded-md hover:bg-muted/50 transition-all"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}
