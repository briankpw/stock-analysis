"use client";

import * as React from "react";
import { Bell, BellOff, CheckCircle2, ExternalLink, Play, Smartphone, Trash2, XCircle, TrendingDown, TrendingUp, Minus, Send } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageIntro } from "@/components/page-intro";
import { KeyTerms } from "@/components/key-terms";
import { TermTip } from "@/components/term-tip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ErrorBanner, LoadingPage } from "@/components/loading";
import { useUi } from "@/lib/state";
import { useT } from "@/lib/i18n";
import { relativeTime, fmtCurrency } from "@/lib/format";
import type { StoredSignal } from "@/lib/bot/store";
import type { StrategyKey } from "@/lib/bot/strategy";
import { humanName } from "@/lib/bot/strategy";
import { usePortfolioWatches } from "@/hooks/use-portfolio-watches";
import type {
  StoredNotification,
} from "@/lib/portfolio-watch/store";
import { useStockWatches } from "@/hooks/use-stock-watches";
import type {
  StoredStockNotification,
} from "@/lib/stock-watch/store";
import { useNewsSubscriptions } from "@/hooks/use-news-subscriptions";
import type {
  StoredNewsNotification,
} from "@/lib/news-watch/store";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { SignalAlertsPanel } from "@/components/signal-alerts-panel";
import { cn } from "@/lib/utils";

interface BotStatus {
  enabled: boolean;
  activeStrategies: StrategyKey[];
  availableStrategies: StrategyKey[];
  lastTickAt: string | null;
  lastTickStatus: { ok: boolean; ticker: string; signalsFired: number; notifiesSent: number; errors: string[] } | null;
  telegramConfigured: boolean;
  signals: StoredSignal[];
  pollIntervalSeconds: number;
}

function useBot() {
  const ticker = useUi((s) => s.ticker);
  const [data, setData] = React.useState<BotStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/bot?ticker=${encodeURIComponent(ticker)}${nonce > 0 ? `&_=${nonce}` : ""}`, { cache: "no-store" });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(body?.error ?? `HTTP ${res.status}`);
        else setData(body as BotStatus);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [ticker, nonce]);

  return { data, loading, error, reload };
}

function post(body: Record<string, unknown>) {
  return fetch("/api/bot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (res) => {
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.error ?? `HTTP ${res.status}`);
    return j;
  });
}

function SignalRow({ s }: { s: StoredSignal }) {
  const t = useT();
  const icon = s.type === "BUY" ? <TrendingUp className="h-3.5 w-3.5" />
             : s.type === "SELL" ? <TrendingDown className="h-3.5 w-3.5" />
             :                     <Minus className="h-3.5 w-3.5" />;
  const label =
    s.type === "BUY" ? t("bot.signal.buy") :
    s.type === "SELL" ? t("bot.signal.sell") :
    t("bot.signal.hold");
  return (
    <li className="glass rounded-lg p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn(
          "chip",
          s.type === "BUY" ? "chip-bull" : s.type === "SELL" ? "chip-bear" : "chip-neu",
        )}>{icon} {label}</span>
        <span className="text-sm font-semibold">{s.ticker}</span>
        <span className="text-xs text-muted-foreground">{s.strategy}</span>
        <span className="text-xs text-muted-foreground ml-auto">{relativeTime(s.createdAt)}</span>
      </div>
      <p className="text-xs text-muted-foreground mt-1.5">
        {s.reason}
        {s.price !== null && <> · <strong>{fmtCurrency(s.price)}</strong></>}
      </p>
      {s.notified && (
        <p className="text-[0.65rem] uppercase tracking-wider text-primary mt-1">
          <Send className="h-2.5 w-2.5 inline" /> {t("bot.alertedViaTelegram")}
        </p>
      )}
    </li>
  );
}

export default function BotPage() {
  const { data, loading, error, reload } = useBot();
  const ticker = useUi((s) => s.ticker);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const t = useT();

  const run = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    setMessage(null);
    try {
      const res = await post({ action, ...extra });
      if (res?.report) {
        setMessage(t("bot.tickComplete", { signals: res.report.signalsFired, alerts: res.report.notifiesSent }));
      } else if (res?.detail) {
        setMessage(res.detail);
      } else {
        setMessage(t("common.done"));
      }
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const toggleStrategy = async (key: StrategyKey) => {
    if (!data) return;
    const next = data.activeStrategies.includes(key)
      ? data.activeStrategies.filter((k) => k !== key)
      : [...data.activeStrategies, key];
    await run("set-strategies", { strategies: next });
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader pageTitleKey="nav.bot" />
      <PageIntro pageKey="bot" />

      {error && <ErrorBanner message={error} retry={reload} />}
      {!data && !error && loading && <LoadingPage label={t("loading.botStatus")} />}

      {data && (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr] animate-fade-in">
          {/* Left column: config */}
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle>{t("bot.status")}</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span>{t("bot.enabled")}</span>
                  <Button
                    size="sm"
                    variant={data.enabled ? "success" : "outline"}
                    onClick={() => run("set-enabled", { enabled: !data.enabled })}
                    disabled={busy === "set-enabled"}
                  >
                    {data.enabled ? t("bot.on") : t("bot.off")}
                  </Button>
                </div>
                <div className="flex items-center justify-between">
                  <span>{t("bot.telegram")}</span>
                  {data.telegramConfigured ? (
                    <span className="chip chip-bull"><CheckCircle2 className="h-3.5 w-3.5" /> {t("bot.telegram.configured")}</span>
                  ) : (
                    <span className="chip chip-bear"><XCircle className="h-3.5 w-3.5" /> {t("bot.telegram.missing")}</span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span>{t("bot.pollInterval")}</span>
                  <span>{data.pollIntervalSeconds}s</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>{t("bot.lastTick")}</span>
                  <span>{data.lastTickAt ? relativeTime(data.lastTickAt) : "—"}</span>
                </div>
                {data.lastTickStatus?.errors && data.lastTickStatus.errors.length > 0 && (
                  <div>
                    <p className="metric-label mb-1">{t("bot.lastErrors")}</p>
                    <ul className="space-y-1 text-xs text-danger">
                      {data.lastTickStatus.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}
                {message && <p className="text-xs text-primary">{message}</p>}
                <div className="flex flex-col gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => run("run-tick", { ticker })} disabled={!!busy}>
                    {t("bot.runTickNow")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => run("test")} disabled={!data.telegramConfigured || !!busy}>
                    {t("bot.sendTest")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => run("clear-history", { ticker })} disabled={!!busy}>
                    {t("bot.clearHistory", { ticker })}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>{t("bot.strategies")}</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {data.availableStrategies.map((k) => {
                  const termKey =
                    k === "sma_crossover" ? "SMA Crossover" :
                    k === "rsi_reversion" ? "RSI Reversion" :
                    k === "macd_cross"    ? "MACD Cross" :
                    "";
                  const localized =
                    k === "sma_crossover" ? t("bot.strategy.sma") :
                    k === "rsi_reversion" ? t("bot.strategy.rsi") :
                    k === "macd_cross"    ? t("bot.strategy.macd") :
                    humanName(k);
                  return (
                    <label key={k} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={data.activeStrategies.includes(k)}
                        onChange={() => toggleStrategy(k)}
                        className="h-4 w-4"
                      />
                      <span className="text-sm">
                        {termKey ? (
                          <TermTip term={termKey}>{localized}</TermTip>
                        ) : (
                          localized
                        )}
                      </span>
                    </label>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          {/* Right column: history */}
          <Card>
            <CardHeader>
              <CardTitle>
                <TermTip term="Signal">{t("bot.signalHistory", { ticker })}</TermTip>
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {t("bot.signalHistoryHint")}
              </p>
            </CardHeader>
            <CardContent>
              {data.signals.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("bot.noSignals")}</p>
              ) : (
                <ul className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                  {data.signals.map((s) => <SignalRow key={s.id} s={s} />)}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <PushAlertsPanel />
      <SignalAlertsPanel />
      <PortfolioAlertsPanel />
      <StockAlertsPanel />
      <NewsAlertsPanel />

      <KeyTerms
        terms={[
          "Signal",
          "Cross Event",
          "SMA Crossover",
          "RSI Reversion",
          "MACD Cross",
          "Golden Cross",
          "Death Cross",
          "SMA",
          "RSI",
          "MACD",
          "Overbought",
          "Oversold",
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Portfolio-watch section
// ---------------------------------------------------------------------------

interface PortfolioTickState {
  lastTickAt: string | null;
  lastTickStatus: {
    ok: boolean;
    watchCount: number;
    presetsProbed: number;
    eventsSeen: number;
    eventsMatched: number;
    notifiesSent: number;
    errors: string[];
  } | null;
  notifications: StoredNotification[];
}

function PortfolioAlertsPanel() {
  const {
    watches,
    loading: watchesLoading,
    error: watchesError,
    removePerson,
    removeTicker,
    refresh: refreshWatches,
  } = usePortfolioWatches();

  const [state, setState] = React.useState<PortfolioTickState | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/portfolios/notifications${nonce > 0 ? `?_=${nonce}` : ""}`,
          { cache: "no-store" },
        );
        const body = await res.json();
        if (!cancelled) setState(body as PortfolioTickState);
      } catch {
        /* silent; the panel is nice-to-have */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const runNow = async () => {
    setBusy("run");
    setMessage(null);
    try {
      const res = await fetch("/api/portfolios/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "run" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setMessage(
        `Tick complete — ${body.report.watchCount} watches · ` +
          `${body.report.eventsMatched} matched · ${body.report.notifiesSent} notification(s) delivered`,
      );
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    if (!confirm("Clear the notification history? Alerts already sent to Telegram aren't affected.")) return;
    setBusy("clear");
    setMessage(null);
    try {
      const res = await fetch("/api/portfolios/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setMessage(`Cleared ${body.removed} row(s).`);
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const removeWatch = async (
    kind: "person" | "ticker",
    payload: { category?: string; presetId?: string; ticker?: string },
  ) => {
    try {
      if (kind === "person" && payload.category && payload.presetId) {
        await removePerson(payload.category as never, payload.presetId);
      } else if (kind === "ticker" && payload.ticker) {
        await removeTicker(payload.ticker);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <Bell className="h-4 w-4 text-primary" />
          <CardTitle>Portfolio alerts</CardTitle>
          <span className="text-xs text-muted-foreground">
            Fires when a followed person trades or a watched ticker moves · delivered to Telegram + Push
          </span>
        </div>
        {state?.lastTickAt && (
          <p className="text-xs text-muted-foreground mt-2">
            Last portfolio tick {relativeTime(state.lastTickAt)}
            {state.lastTickStatus && (
              <>
                {" "}·{" "}
                {state.lastTickStatus.eventsMatched}/{state.lastTickStatus.eventsSeen} events matched ·{" "}
                {state.lastTickStatus.notifiesSent} pushed
                {state.lastTickStatus.errors.length > 0 && (
                  <span className="text-danger">
                    {" "}·{" "}{state.lastTickStatus.errors.length} error(s)
                  </span>
                )}
              </>
            )}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {watchesError && <ErrorBanner message={watchesError} retry={refreshWatches} />}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={runNow} disabled={!!busy}>
            <Play className="h-3.5 w-3.5" /> Run portfolio tick now
          </Button>
          <Button size="sm" variant="ghost" onClick={clear} disabled={!!busy}>
            <Trash2 className="h-3.5 w-3.5" /> Clear notification history
          </Button>
        </div>
        {message && <p className="text-xs text-primary">{message}</p>}

        {/* Active watches */}
        <div>
          <div className="metric-label mb-2">Active watches ({watches.length})</div>
          {watchesLoading && watches.length === 0 ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : watches.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              None yet. Open <a href="/portfolios" className="text-primary hover:underline">Portfolios</a>, pick a person,
              and click <em>Alert on trades</em> — or click the bell next to any ticker inside a trade table.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {watches.map((w) => (
                <li
                  key={w.id}
                  className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-xs"
                >
                  <span
                    className={cn(
                      "chip",
                      w.kind === "person" ? "chip-neu" : "chip-bull",
                    )}
                  >
                    {w.kind === "person" ? "Person" : "Ticker"}
                  </span>
                  <span className="font-medium flex-1 min-w-0 truncate">
                    {w.kind === "person"
                      ? `${w.category ?? "?"} / ${w.presetId}`
                      : (w.ticker ?? "?")}
                  </span>
                  <span className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                    {w.actions.join(" · ")}
                  </span>
                  <button
                    onClick={() =>
                      removeWatch(w.kind, {
                        category: w.category ?? undefined,
                        presetId: w.presetId ?? undefined,
                        ticker: w.ticker ?? undefined,
                      })
                    }
                    className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-danger/15 hover:text-danger text-muted-foreground"
                    title="Remove this watch"
                    aria-label="Remove this watch"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Recent notifications */}
        <div>
          <div className="metric-label mb-2">
            Recent notifications ({state?.notifications.length ?? 0})
          </div>
          {(!state || state.notifications.length === 0) ? (
            <p className="text-xs text-muted-foreground">
              No alerts fired yet. Alerts will appear here (and get pushed to your Telegram
              chat) once the poller catches a new trade matching one of your watches.
            </p>
          ) : (
            <ul className="space-y-1.5 max-h-[26rem] overflow-y-auto pr-1">
              {state.notifications.slice(0, 40).map((n) => (
                <NotificationRow key={n.eventId} n={n} />
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function NotificationRow({ n }: { n: StoredNotification }) {
  const chipClass =
    n.action === "BUY" ? "chip-bull"
    : n.action === "SELL" ? "chip-bear"
    : "chip-neu";
  return (
    <li className="glass rounded-md p-2.5 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn("chip", chipClass)}>{n.actionLabel}</span>
        <span className="font-semibold">{n.presetName}</span>
        {n.ticker && <span className="chip chip-neu">{n.ticker}</span>}
        <span className="text-[0.65rem] uppercase text-muted-foreground/70">{n.category}</span>
        <span className="ml-auto text-muted-foreground text-[0.65rem]">
          {relativeTime(n.notifiedAt)}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 flex-wrap">
        <span className="truncate">{n.companyName}</span>
        {n.amountLabel && (
          <span className="text-muted-foreground">· {n.amountLabel}</span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[0.65rem] text-muted-foreground flex-wrap">
        {n.telegramOk === true ? (
          <span
            className="text-primary inline-flex items-center gap-1"
            title={n.telegramDetail ?? undefined}
          >
            <Send className="h-2.5 w-2.5" /> delivered
          </span>
        ) : n.telegramOk === false ? (
          <span className="text-danger inline-flex items-center gap-1">
            <XCircle className="h-2.5 w-2.5" /> delivery failed
            {n.telegramDetail && <span>· {n.telegramDetail}</span>}
          </span>
        ) : (
          <span>· not delivered</span>
        )}
        {n.sourceUrl && (
          <a
            href={n.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1 ml-auto"
          >
            Filing <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Stock-watch section (per-ticker insider transaction alerts)
// ---------------------------------------------------------------------------

interface StockTickState {
  lastTickAt: string | null;
  lastTickStatus: {
    ok: boolean;
    watchCount: number;
    tickersProbed: number;
    transactionsSeen: number;
    transactionsMatched: number;
    notifiesSent: number;
    errors: string[];
  } | null;
  notifications: StoredStockNotification[];
}

function StockAlertsPanel() {
  const {
    watches,
    loading: watchesLoading,
    error: watchesError,
    removeTicker,
    refresh: refreshWatches,
  } = useStockWatches();

  const [state, setState] = React.useState<StockTickState | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/stock-watches/notifications${nonce > 0 ? `?_=${nonce}` : ""}`,
          { cache: "no-store" },
        );
        const body = await res.json();
        if (!cancelled) setState(body as StockTickState);
      } catch {
        /* silent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const runNow = async () => {
    setBusy("run");
    setMessage(null);
    try {
      const res = await fetch("/api/stock-watches/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "run" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setMessage(
        `Tick complete — ${body.report.watchCount} watches · ` +
          `${body.report.transactionsMatched} matched · ${body.report.notifiesSent} notification(s) delivered`,
      );
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    if (!confirm("Clear insider notification history? Alerts already sent to Telegram aren't affected.")) return;
    setBusy("clear");
    setMessage(null);
    try {
      const res = await fetch("/api/stock-watches/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setMessage(`Cleared ${body.removed} row(s).`);
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const dropTicker = async (ticker: string) => {
    try {
      await removeTicker(ticker);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <Bell className="h-4 w-4 text-primary" />
          <CardTitle>Stock insider alerts</CardTitle>
          <span className="text-xs text-muted-foreground">
            Fires when any officer / director / 10% owner at a watched company files a Form 4 ·
            delivered to Telegram + Push
          </span>
        </div>
        {state?.lastTickAt && (
          <p className="text-xs text-muted-foreground mt-2">
            Last stock tick {relativeTime(state.lastTickAt)}
            {state.lastTickStatus && (
              <>
                {" "}·{" "}
                {state.lastTickStatus.transactionsMatched}/{state.lastTickStatus.transactionsSeen} tx matched ·{" "}
                {state.lastTickStatus.notifiesSent} pushed
                {state.lastTickStatus.errors.length > 0 && (
                  <span className="text-danger">
                    {" "}·{" "}{state.lastTickStatus.errors.length} error(s)
                  </span>
                )}
              </>
            )}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {watchesError && <ErrorBanner message={watchesError} retry={refreshWatches} />}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={runNow} disabled={!!busy}>
            <Play className="h-3.5 w-3.5" /> Run stock tick now
          </Button>
          <Button size="sm" variant="ghost" onClick={clear} disabled={!!busy}>
            <Trash2 className="h-3.5 w-3.5" /> Clear notification history
          </Button>
        </div>
        {message && <p className="text-xs text-primary">{message}</p>}

        <div>
          <div className="metric-label mb-2">Watched tickers ({watches.length})</div>
          {watchesLoading && watches.length === 0 ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : watches.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              None yet. Open any stock page (Overview, Ratios, …) and click the bell
              icon in the header to start alerting on that company's insider trades.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {watches.map((w) => (
                <li
                  key={w.ticker}
                  className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-xs"
                >
                  <span className="chip chip-bull">{w.ticker}</span>
                  <span className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                    {w.actions.join(" · ")}
                  </span>
                  {!w.cik && (
                    <span
                      className="text-[0.65rem] uppercase tracking-wider text-warning"
                      title="SEC ticker map couldn't resolve this symbol. The tick still tries again each pass."
                    >
                      unresolved
                    </span>
                  )}
                  <span className="text-muted-foreground text-[0.65rem] ml-auto">
                    since {relativeTime(w.createdAt)}
                  </span>
                  <button
                    onClick={() => dropTicker(w.ticker)}
                    className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-danger/15 hover:text-danger text-muted-foreground"
                    title="Stop alerting on this ticker"
                    aria-label={`Stop alerting on ${w.ticker}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="metric-label mb-2">
            Recent insider notifications ({state?.notifications.length ?? 0})
          </div>
          {(!state || state.notifications.length === 0) ? (
            <p className="text-xs text-muted-foreground">
              No alerts fired yet. Once someone at a watched company files Form 4,
              you'll see it here and in your Telegram chat.
            </p>
          ) : (
            <ul className="space-y-1.5 max-h-[26rem] overflow-y-auto pr-1">
              {state.notifications.slice(0, 40).map((n) => (
                <StockNotificationRow key={n.eventId} n={n} />
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StockNotificationRow({ n }: { n: StoredStockNotification }) {
  const chipClass =
    n.action === "BUY" ? "chip-bull"
    : n.action === "SELL" ? "chip-bear"
    : "chip-neu";
  const shares = n.shares !== null && Number.isFinite(n.shares)
    ? n.shares.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : null;
  const price = n.pricePerShare !== null && Number.isFinite(n.pricePerShare)
    ? `$${n.pricePerShare.toFixed(2)}`
    : null;
  return (
    <li className="glass rounded-md p-2.5 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn("chip", chipClass)}>{n.actionLabel}</span>
        <span className="chip chip-neu">{n.ticker}</span>
        <span className="font-semibold">{n.reporterName}</span>
        <span className="ml-auto text-muted-foreground text-[0.65rem]">
          {relativeTime(n.notifiedAt)}
        </span>
      </div>
      {(n.reporterRelation || n.issuerName) && (
        <div className="mt-1 flex items-center gap-2 flex-wrap text-muted-foreground">
          {n.reporterRelation && <span>{n.reporterRelation}</span>}
          {n.issuerName && <span>· {n.issuerName}</span>}
        </div>
      )}
      <div className="mt-1 flex items-center gap-2 text-[0.65rem] text-muted-foreground flex-wrap">
        {shares && <span>{shares} shares{price ? ` @ ${price}` : ""}</span>}
        {n.tradeDate && <span>· on {n.tradeDate}</span>}
        {n.telegramOk === true ? (
          <span
            className="text-primary inline-flex items-center gap-1 ml-auto"
            title={n.telegramDetail ?? undefined}
          >
            <Send className="h-2.5 w-2.5" /> delivered
          </span>
        ) : n.telegramOk === false ? (
          <span className="text-danger inline-flex items-center gap-1 ml-auto">
            <XCircle className="h-2.5 w-2.5" /> failed
            {n.telegramDetail && <span>· {n.telegramDetail}</span>}
          </span>
        ) : (
          <span className="ml-auto">· not delivered</span>
        )}
        {n.sourceUrl && (
          <a
            href={n.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            Filing <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// News-watch section (per-ticker headline alerts)
// ---------------------------------------------------------------------------

interface NewsTickState {
  lastTickAt: string | null;
  lastTickStatus: {
    ok: boolean;
    subscriptionCount: number;
    tickersProbed: number;
    itemsSeen: number;
    itemsNew: number;
    notifiesSent: number;
    errors: string[];
  } | null;
  notifications: StoredNewsNotification[];
}

function NewsAlertsPanel() {
  const {
    subscriptions,
    loading: subsLoading,
    error: subsError,
    unsubscribe,
    refresh: refreshSubs,
  } = useNewsSubscriptions();

  const [state, setState] = React.useState<NewsTickState | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/news-subscriptions/notifications${nonce > 0 ? `?_=${nonce}` : ""}`,
          { cache: "no-store" },
        );
        const body = await res.json();
        if (!cancelled) setState(body as NewsTickState);
      } catch {
        /* silent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const runNow = async () => {
    setBusy("run");
    setMessage(null);
    try {
      const res = await fetch("/api/news-subscriptions/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "run" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setMessage(
        `Tick complete — ${body.report.subscriptionCount} subs · ` +
          `${body.report.itemsNew} new headlines · ${body.report.notifiesSent} notification(s) delivered`,
      );
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    if (!confirm("Clear news notification history? Alerts already sent to Telegram aren't affected.")) return;
    setBusy("clear");
    setMessage(null);
    try {
      const res = await fetch("/api/news-subscriptions/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setMessage(`Cleared ${body.removed} row(s).`);
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const dropTicker = async (ticker: string) => {
    try {
      await unsubscribe(ticker);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <Bell className="h-4 w-4 text-primary" />
          <CardTitle>News alerts</CardTitle>
          <span className="text-xs text-muted-foreground">
            Fires when a new headline appears for a subscribed ticker · delivered to Telegram + Push
          </span>
        </div>
        {state?.lastTickAt && (
          <p className="text-xs text-muted-foreground mt-2">
            Last news tick {relativeTime(state.lastTickAt)}
            {state.lastTickStatus && (
              <>
                {" "}·{" "}
                {state.lastTickStatus.itemsNew}/{state.lastTickStatus.itemsSeen} new headlines ·{" "}
                {state.lastTickStatus.notifiesSent} pushed
                {state.lastTickStatus.errors.length > 0 && (
                  <span className="text-danger">
                    {" "}·{" "}{state.lastTickStatus.errors.length} error(s)
                  </span>
                )}
              </>
            )}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {subsError && <ErrorBanner message={subsError} retry={refreshSubs} />}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={runNow} disabled={!!busy}>
            <Play className="h-3.5 w-3.5" /> Run news tick now
          </Button>
          <Button size="sm" variant="ghost" onClick={clear} disabled={!!busy}>
            <Trash2 className="h-3.5 w-3.5" /> Clear notification history
          </Button>
        </div>
        {message && <p className="text-xs text-primary">{message}</p>}

        <div>
          <div className="metric-label mb-2">Subscribed tickers ({subscriptions.length})</div>
          {subsLoading && subscriptions.length === 0 ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : subscriptions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              None yet. Open <a href="/news" className="text-primary hover:underline">News</a> for any
              ticker and click <em>Subscribe to news alerts</em> — every new headline for that
              ticker will then push to Telegram.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {subscriptions.map((s) => (
                <li
                  key={s.ticker}
                  className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-xs"
                >
                  <span className="chip chip-bull">{s.ticker}</span>
                  <span className="text-muted-foreground text-[0.65rem] ml-auto">
                    since {relativeTime(s.createdAt)}
                  </span>
                  <button
                    onClick={() => dropTicker(s.ticker)}
                    className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-danger/15 hover:text-danger text-muted-foreground"
                    title="Unsubscribe from this ticker's news"
                    aria-label={`Unsubscribe from ${s.ticker} news`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="metric-label mb-2">
            Recent news notifications ({state?.notifications.length ?? 0})
          </div>
          {(!state || state.notifications.length === 0) ? (
            <p className="text-xs text-muted-foreground">
              No alerts fired yet. Once a new headline appears for a subscribed ticker,
              you'll see it here and in your Telegram chat.
            </p>
          ) : (
            <ul className="space-y-1.5 max-h-[26rem] overflow-y-auto pr-1">
              {state.notifications.slice(0, 40).map((n) => (
                <NewsNotificationRow key={n.eventId} n={n} />
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function NewsNotificationRow({ n }: { n: StoredNewsNotification }) {
  const chipClass =
    n.label === "bullish" ? "chip-bull"
    : n.label === "bearish" ? "chip-bear"
    : "chip-neu";
  const labelStr = n.label ? n.label.charAt(0).toUpperCase() + n.label.slice(1) : "News";
  const scoreStr =
    n.score !== null && Number.isFinite(n.score)
      ? `${n.score >= 0 ? "+" : ""}${n.score.toFixed(2)}`
      : null;
  return (
    <li className="glass rounded-md p-2.5 text-xs">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn("chip", chipClass)}>{labelStr}</span>
        <span className="chip chip-neu">{n.ticker}</span>
        {scoreStr && (
          <span className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
            score {scoreStr}
          </span>
        )}
        <span className="ml-auto text-muted-foreground text-[0.65rem]">
          {relativeTime(n.notifiedAt)}
        </span>
      </div>
      <p className="mt-1 leading-snug">{n.title}</p>
      {n.publisher && (
        <p className="mt-0.5 text-muted-foreground text-[0.65rem]">
          {n.publisher}
        </p>
      )}
      <div className="mt-1 flex items-center gap-2 text-[0.65rem] text-muted-foreground flex-wrap">
        {n.telegramOk === true ? (
          <span
            className="text-primary inline-flex items-center gap-1"
            title={n.telegramDetail ?? undefined}
          >
            <Send className="h-2.5 w-2.5" /> delivered
          </span>
        ) : n.telegramOk === false ? (
          <span className="text-danger inline-flex items-center gap-1">
            <XCircle className="h-2.5 w-2.5" /> failed
            {n.telegramDetail && <span>· {n.telegramDetail}</span>}
          </span>
        ) : (
          <span>· not delivered</span>
        )}
        {n.link && (
          <a
            href={n.link}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-1 ml-auto"
          >
            Read <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Web Push (PWA) subscription panel
// ---------------------------------------------------------------------------

function PushAlertsPanel() {
  const { status, enable, disable, removeDevice, test } = usePushNotifications();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const showIosHint =
    typeof window !== "undefined" &&
    /iPhone|iPad|iPod/i.test(navigator.userAgent) &&
    !(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);

  const run = async (action: string, fn: () => Promise<string | void>) => {
    setBusy(action);
    setMessage(null);
    try {
      const result = await fn();
      if (typeof result === "string" && result) setMessage(result);
      else setMessage("Done.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <Smartphone className="h-4 w-4 text-primary" />
          <CardTitle>Push notifications (PWA)</CardTitle>
          <span className="text-xs text-muted-foreground">
            Receive alerts on Android, iOS, macOS, or Windows — without opening a Telegram chat
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {/* Support state */}
        {!status.supported && !status.loading && (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
            <p className="font-medium text-warning">
              Push isn't supported in this browser.
            </p>
            <p className="mt-1 text-muted-foreground">
              You need a secure connection (HTTPS or localhost) and a browser that supports the
              Push API. On iPhone / iPad, first tap <em>Share → Add to Home Screen</em>, then
              open the app from your home screen and try again.
            </p>
          </div>
        )}

        {status.supported && showIosHint && !status.subscribed && (
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-xs">
            <p className="font-medium">iOS install required</p>
            <p className="mt-1 text-muted-foreground">
              iOS delivers push to PWAs only after you add the app to your Home Screen. Tap the{" "}
              <em>Share</em> button in Safari, then <em>Add to Home Screen</em>, then open the app
              from home to enable push.
            </p>
          </div>
        )}

        {status.permission === "denied" && (
          <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-xs">
            <p className="font-medium text-danger">Notification permission is blocked.</p>
            <p className="mt-1 text-muted-foreground">
              Open your browser settings for this site and re-allow notifications, then reload
              this page.
            </p>
          </div>
        )}

        {/* This-device controls */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {status.subscribed ? (
              <>
                <span className="chip chip-bull">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Enabled on this device
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => run("disable", disable)}
                  disabled={!!busy}
                >
                  <BellOff className="h-3.5 w-3.5" /> Disable on this device
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="success"
                onClick={() => run("enable", enable)}
                disabled={!status.supported || status.permission === "denied" || !!busy}
              >
                <Bell className="h-3.5 w-3.5" /> Enable push on this device
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => run("test", test)}
              disabled={status.subscriberCount === 0 || !!busy}
              title={
                status.subscriberCount === 0
                  ? "Enable push on at least one device first"
                  : "Send a test push to every enabled device"
              }
            >
              <Send className="h-3.5 w-3.5" /> Send test push
            </Button>
          </div>
          {message && <p className="text-xs text-primary">{message}</p>}
          {status.error && !message && (
            <p className="text-xs text-danger">{status.error}</p>
          )}
        </div>

        {/* Registered devices */}
        <div>
          <div className="metric-label mb-2">
            Enabled devices ({status.devices.length})
          </div>
          {status.devices.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No devices enabled yet. Click <em>Enable push on this device</em> above — the
              browser will ask you to allow notifications, and you're done. Repeat on every
              phone / laptop you want alerts on.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {status.devices.map((d) => (
                <li
                  key={d.endpoint}
                  className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-xs"
                >
                  <Smartphone className="h-3.5 w-3.5 text-primary" />
                  <span className="font-medium flex-1 min-w-0 truncate">
                    {d.label ?? "Unnamed device"}
                  </span>
                  <span className="text-muted-foreground text-[0.65rem]">
                    since {relativeTime(d.createdAt)}
                  </span>
                  {d.lastUsedAt && (
                    <span className="text-muted-foreground text-[0.65rem]">
                      · last push {relativeTime(d.lastUsedAt)}
                    </span>
                  )}
                  <button
                    onClick={() => run(`remove:${d.endpoint}`, () => removeDevice(d.endpoint))}
                    className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-danger/15 hover:text-danger text-muted-foreground"
                    title="Remove this device"
                    aria-label="Remove this device"
                    disabled={!!busy}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
