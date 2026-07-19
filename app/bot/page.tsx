"use client";

import * as React from "react";
import { AlertOctagon, Bell, BellOff, CheckCircle2, ExternalLink, Globe2, Newspaper, Play, Smartphone, Target, Trash2, TrendingUp, Users, XCircle, Send, HelpCircle, ChevronDown, Minus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageIntro } from "@/components/page-intro";
import { KeyTerms } from "@/components/key-terms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { ErrorBanner, LoadingPage } from "@/components/loading";
import { useT } from "@/lib/i18n";
import { relativeTime } from "@/lib/format";
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
import type {
  PushSupportDiagnostics,
  PermissionState,
  ServiceWorkerRegistrationStatus,
} from "@/hooks/use-push-notifications";
import { SignalAlertsPanel } from "@/components/signal-alerts-panel";
import { PortfolioRiskAlertsPanel } from "@/components/portfolio-risk-alerts-panel";
import { cn } from "@/lib/utils";

/**
 * Status payload returned by `/api/bot` — trimmed after the legacy
 * strategy checkboxes (SMA/RSI/MACD) were removed. The remaining fields
 * are the *shared* worker heartbeat: whether the worker loop is enabled,
 * when it last completed a full cycle, whether Telegram is configured,
 * and the poll cadence. Per-channel status (portfolio / news / stock /
 * technical / resonance / risk) lives in each panel's own hook.
 */
interface BotStatus {
  enabled: boolean;
  lastTickAt: string | null;
  telegramConfigured: boolean;
  pollIntervalSeconds: number;
}

function useBot() {
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
        const res = await fetch(`/api/bot${nonce > 0 ? `?_=${nonce}` : ""}`, { cache: "no-store" });
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
  }, [nonce]);

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

// Persist the alert-tab selection so refreshes / navigating back-and-forth
// don't dump users on the default panel every time. Read lazily inside
// `getInitialAlertTab()` because this file also renders on the server
// (Next.js RSC prerender pass), where `localStorage` doesn't exist.
const ALERT_TAB_STORAGE_KEY = "bot.alerts.tab";
const ALERT_TAB_VALUES = new Set([
  "ticker",
  "market",
  "portfolio",
  "insider",
  "news",
  "risks",
]);

type AlertTab =
  | "ticker"
  | "market"
  | "portfolio"
  | "insider"
  | "news"
  | "risks";

function getInitialAlertTab(): AlertTab {
  if (typeof window === "undefined") return "ticker";
  try {
    const raw = localStorage.getItem(ALERT_TAB_STORAGE_KEY);
    // Legacy "signal" tab (pre-Jul-2026 split) → land on Ticker,
    // which is where Master/Technical/Resonance subscriptions moved.
    // Rewriting the stored key here means the user only pays the
    // one-time migration on their first visit post-upgrade.
    if (raw === "signal") {
      try {
        localStorage.setItem(ALERT_TAB_STORAGE_KEY, "ticker");
      } catch {
        /* ignore – see catch below */
      }
      return "ticker";
    }
    if (raw && ALERT_TAB_VALUES.has(raw)) {
      return raw as AlertTab;
    }
  } catch {
    /* private mode / storage access denied — fall through to default */
  }
  return "ticker";
}

export default function BotPage() {
  const { data, loading, error, reload } = useBot();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const t = useT();

  // Controlled tab state so SSR always renders `"ticker"` and hydration
  // matches. Restoring the persisted tab happens in a mount effect below;
  // reading localStorage inside `useState`'s initializer would work in
  // isolation but reintroduces the SSR-vs-client render mismatch that
  // makes React scream in the console.
  const [alertTab, setAlertTab] = React.useState<AlertTab>("ticker");
  React.useEffect(() => {
    // `getInitialAlertTab()` migrates the legacy `"signal"` value to
    // `"ticker"` on read, so the returned value is always one of the
    // current AlertTab members — no extra guard needed here.
    setAlertTab(getInitialAlertTab());
  }, []);

  const run = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    setMessage(null);
    try {
      const res = await post({ action, ...extra });
      if (res?.detail) {
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

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader pageTitleKey="nav.bot" />
      <PageIntro pageKey="bot" />

      {error && <ErrorBanner message={error} retry={reload} />}
      {!data && !error && loading && <LoadingPage label={t("loading.botStatus")} />}

      {/*
        Alert-channel tabs come first — they're what users open /bot for.
        The Bot Status + Push Notification cards used to sit above the
        tabs but got demoted below in Jul 2026: they're infrastructure
        (worker heartbeat + device delivery setup) and only need
        attention when something's wrong. Everyday users care about
        "did any of my alerts fire?", which is the tabs.

        Five independent notification systems live in their own SQLite
        tables and have their own tick loops. Tabbing them keeps the
        /bot page short (each panel is ~200px tall when populated) and
        mirrors the mental model users already have: "I want to check
        my signal alerts" vs "I want to review news alerts" is a single
        click instead of a scroll-and-hunt through five stacked cards.

        Each panel keeps its own Card wrapper so the visual weight of the
        alert section matches the surrounding cards; the tabs themselves
        sit above the active card as a plain strip.

        Storing the active tab in `localStorage` keeps the last-viewed tab
        stable across reloads — a small quality-of-life win because most
        users only care about one or two channels day-to-day.
      */}
      <Tabs
        value={alertTab}
        onValueChange={(v) => {
          if (!ALERT_TAB_VALUES.has(v)) return;
          setAlertTab(v as typeof alertTab);
          try {
            localStorage.setItem(ALERT_TAB_STORAGE_KEY, v);
          } catch {
            /* private mode / quota-exceeded — the tab still works,
               we just lose the persistence. */
          }
        }}
      >
        {/*
          The old single "Signal" tab was split into "Ticker signal"
          and "Market signal" in Jul 2026 — users kept confusing
          per-symbol subscriptions (Master / Technical / Resonance)
          with market-segment subscriptions (Sector Resonance).
          Keeping them side by side but as distinct tabs makes the
          scope of each row unambiguous.
        */}
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="ticker" className="gap-1.5">
            <Target className="h-3.5 w-3.5" />
            <span>{t("bot.tabs.ticker")}</span>
          </TabsTrigger>
          <TabsTrigger value="market" className="gap-1.5">
            <Globe2 className="h-3.5 w-3.5" />
            <span>{t("bot.tabs.market")}</span>
          </TabsTrigger>
          <TabsTrigger value="portfolio" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            <span>{t("bot.tabs.portfolio")}</span>
          </TabsTrigger>
          <TabsTrigger value="insider" className="gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            <span>{t("bot.tabs.insider")}</span>
          </TabsTrigger>
          <TabsTrigger value="news" className="gap-1.5">
            <Newspaper className="h-3.5 w-3.5" />
            <span>{t("bot.tabs.news")}</span>
          </TabsTrigger>
          <TabsTrigger value="risks" className="gap-1.5">
            <AlertOctagon className="h-3.5 w-3.5" />
            <span>{t("bot.tabs.risks")}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="ticker"><SignalAlertsPanel scope="ticker" /></TabsContent>
        <TabsContent value="market"><SignalAlertsPanel scope="market" /></TabsContent>
        <TabsContent value="portfolio"><PortfolioAlertsPanel /></TabsContent>
        <TabsContent value="insider"><StockAlertsPanel /></TabsContent>
        <TabsContent value="news"><NewsAlertsPanel /></TabsContent>
        <TabsContent value="risks"><PortfolioRiskAlertsPanel /></TabsContent>
      </Tabs>

      {/*
        Infrastructure / delivery cards — demoted below the alert tabs
        in Jul 2026. Bot Status is the worker heartbeat + Telegram test
        button; Push Alerts is browser/device push setup. Neither is
        actionable in the "did my alert fire?" workflow, so they live
        down here as a small "Setup & delivery" appendix. A subtle
        heading separates them from the tabs above.
      */}
      <div className="mt-8 space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-border" />
          <span className="metric-label text-muted-foreground">
            {t("bot.infra.title")}
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <p className="text-xs text-muted-foreground">
          {t("bot.infra.hint")}
        </p>

        {data && (
          <div className="animate-fade-in">
            {/* Bot worker status — the shared heartbeat / on-off toggle
                that gates *all* alert channels (Technical Signal,
                6-Signal Resonance, Portfolio, Stock, News,
                Portfolio-Risk). Each channel has its own detailed
                panel in the tabs above. */}
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
                {message && <p className="text-xs text-primary">{message}</p>}
                <div className="pt-1">
                  <Button size="sm" variant="outline" onClick={() => run("test")} disabled={!data.telegramConfigured || !!busy}>
                    {t("bot.sendTest")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <PushAlertsPanel />
      </div>

      <KeyTerms
        terms={[
          "Signal",
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
    <Card>
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
        <PortfolioNotificationsList
          notifications={state?.notifications ?? null}
        />
      </CardContent>
    </Card>
  );
}

/**
 * Paginated view of the portfolio-alert notification history. Split into
 * its own component so the pagination state stays local — it wouldn't
 * make sense to reset the parent's tab state or refetch when the user
 * just wants page 2. Page size (10) is a compromise between "see enough
 * context at a glance" and "don't push the summary metrics off-screen."
 */
function PortfolioNotificationsList({
  notifications,
}: {
  notifications: StoredNotification[] | null;
}) {
  const t = useT();
  const list = notifications ?? [];
  const pager = usePagination(list, 10);
  return (
    <div>
      <div className="metric-label mb-2">
        Recent notifications ({list.length})
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No alerts fired yet. Alerts will appear here (and get pushed to your Telegram
          chat) once the poller catches a new trade matching one of your watches.
        </p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {pager.visibleItems.map((n) => (
              <NotificationRow key={n.eventId} n={n} />
            ))}
          </ul>
          <Pagination
            page={pager.page}
            pageCount={pager.pageCount}
            total={pager.total}
            range={pager.range}
            onPageChange={pager.setPage}
            pageSize={pager.pageSize}
            onPageSizeChange={pager.setPageSize}
            pageSizeOptions={[10, 25, 50, 100]}
            pageSizeLabel={t("pager.pageSizeLabel")}
            allLabel={t("pager.all")}
            className="mt-3"
            label={t("pager.notifications")}
          />
        </>
      )}
    </div>
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
    <Card>
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

        <StockNotificationsList notifications={state?.notifications ?? null} />
      </CardContent>
    </Card>
  );
}

function StockNotificationsList({
  notifications,
}: {
  notifications: StoredStockNotification[] | null;
}) {
  const t = useT();
  const list = notifications ?? [];
  const pager = usePagination(list, 10);
  return (
    <div>
      <div className="metric-label mb-2">
        Recent insider notifications ({list.length})
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No alerts fired yet. Once someone at a watched company files Form 4,
          you'll see it here and in your Telegram chat.
        </p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {pager.visibleItems.map((n) => (
              <StockNotificationRow key={n.eventId} n={n} />
            ))}
          </ul>
          <Pagination
            page={pager.page}
            pageCount={pager.pageCount}
            total={pager.total}
            range={pager.range}
            onPageChange={pager.setPage}
            pageSize={pager.pageSize}
            onPageSizeChange={pager.setPageSize}
            pageSizeOptions={[10, 25, 50, 100]}
            pageSizeLabel={t("pager.pageSizeLabel")}
            allLabel={t("pager.all")}
            className="mt-3"
            label={t("pager.notifications")}
          />
        </>
      )}
    </div>
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
    <Card>
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

        <NewsNotificationsList notifications={state?.notifications ?? null} />
      </CardContent>
    </Card>
  );
}

function NewsNotificationsList({
  notifications,
}: {
  notifications: StoredNewsNotification[] | null;
}) {
  const t = useT();
  const list = notifications ?? [];
  const pager = usePagination(list, 10);
  return (
    <div>
      <div className="metric-label mb-2">
        Recent news notifications ({list.length})
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No alerts fired yet. Once a new headline appears for a subscribed ticker,
          you'll see it here and in your Telegram chat.
        </p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {pager.visibleItems.map((n) => (
              <NewsNotificationRow key={n.eventId} n={n} />
            ))}
          </ul>
          <Pagination
            page={pager.page}
            pageCount={pager.pageCount}
            total={pager.total}
            range={pager.range}
            onPageChange={pager.setPage}
            pageSize={pager.pageSize}
            onPageSizeChange={pager.setPageSize}
            pageSizeOptions={[10, 25, 50, 100]}
            pageSizeLabel={t("pager.pageSizeLabel")}
            allLabel={t("pager.all")}
            className="mt-3"
            label={t("pager.notifications")}
          />
        </>
      )}
    </div>
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
  // Kept as a discriminated pair so success renders quiet blue and
  // errors render a full-width red banner with the actionable reason
  // (`enable()` throws targeted messages per capability — HTTPS
  // missing, iOS-not-PWA, permission denied, etc.).
  const [message, setMessage] = React.useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);

  const showIosHint =
    typeof window !== "undefined" &&
    /iPhone|iPad|iPod/i.test(navigator.userAgent) &&
    !(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);

  const run = async (action: string, fn: () => Promise<string | void>) => {
    setBusy(action);
    setMessage(null);
    try {
      const result = await fn();
      if (typeof result === "string" && result) {
        setMessage({ kind: "ok", text: result });
      } else {
        setMessage({ kind: "ok", text: "Done." });
      }
    } catch (e) {
      setMessage({
        kind: "error",
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(null);
    }
  };

  // No `mt-6` on this card — the parent `<div>` in the page shell owns
  // the vertical rhythm via `space-y-4` so this panel slots in cleanly
  // whether it's the first or the last child of the infrastructure
  // section.
  return (
    <Card>
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
        {/* Targeted "why is Enable disabled?" banner. Users hitting a
            mobile browser almost always fail one specific check (HTTPS,
            iOS-not-PWA, permission denied); showing the exact reason
            beats a generic "not supported". */}
        {!status.supported && !status.loading && (
          <PushBlockerBanner diagnostics={status.diagnostics} />
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

        {/* Always-visible diagnostic strip — collapsed by default. Lets
            users on any device inspect exactly which browser capability
            is (or isn't) available without opening devtools. Also shows
            the SW registrar's status, the local subscription state, and
            the server-side subscriber count so a user seeing "enabled
            but no notifications" can trace the pipeline end-to-end
            without touching a terminal. */}
        <PushDiagnosticsDetails
          diagnostics={status.diagnostics}
          permission={status.permission}
          swRegistration={status.swRegistration}
          subscribed={status.subscribed}
          subscriberCount={status.subscriberCount}
        />


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
              // Historically this button was disabled whenever
              // `status.supported === false`. That gate was doing more
              // harm than good: our client-side capability detection
              // sometimes false-negatives (fresh iOS PWA before the
              // display-mode media query flips, obscure Android
              // browsers we don't sniff, a hydration race where
              // `refresh()` hasn't run yet), and the user hit a wall
              // with no way to try. Now the button is always clickable
              // unless we're mid-request or the user has explicitly
              // denied permission — `enable()` itself throws a
              // targeted, actionable error per capability if it can't
              // proceed, which is far more useful than a silently
              // disabled button.
              <Button
                size="sm"
                variant="success"
                onClick={() => run("enable", enable)}
                disabled={status.permission === "denied" || !!busy}
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
          {message && (
            <div
              className={cn(
                "rounded-md border p-2 text-xs",
                message.kind === "error"
                  ? "border-danger/40 bg-danger/10 text-danger"
                  : "border-primary/40 bg-primary/5 text-primary",
              )}
              role={message.kind === "error" ? "alert" : "status"}
            >
              {message.text}
            </div>
          )}
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

// ---------------------------------------------------------------------------
// Push blocker banner — picks the single most-actionable reason the Enable
// button is disabled and renders a targeted fix.
//
// Precedence matters: if the transport is insecure (HTTP over LAN), no
// amount of iOS or permission tweaking helps, so we surface that first.
// The permission-denied banner is intentionally rendered separately by
// the parent (it applies even when supported=true), so we don't duplicate
// it here.
// ---------------------------------------------------------------------------

function PushBlockerBanner({ diagnostics: d }: { diagnostics: PushSupportDiagnostics }) {
  let title: string;
  let body: React.ReactNode;
  let tone: "warning" | "danger" | "primary" = "warning";

  if (!d.isSecureContext) {
    tone = "danger";
    title = "This page isn't served over HTTPS.";
    body = (
      <>
        Web Push only works on <strong>HTTPS</strong> or <strong>http://localhost</strong>.
        Your phone is loading this app over an insecure LAN IP, so the browser is
        refusing to expose the Push API. Put the app behind HTTPS (Caddy, Cloudflare
        Tunnel, ngrok, Tailscale Funnel, or a reverse proxy with a real certificate)
        and reopen it from your phone.
      </>
    );
  } else if (d.isIosSafariNotPwa) {
    tone = "primary";
    title = "iOS needs the app on your Home Screen first.";
    body = (
      <>
        Apple only delivers Web Push to installed PWAs. In Safari, tap the{" "}
        <em>Share</em> icon → <em>Add to Home Screen</em> → open the app from
        your Home Screen, then come back to this page and tap Enable.
      </>
    );
  } else if (!d.hasServiceWorker) {
    title = "Service Workers are unavailable in this browser.";
    body = (
      <>
        Chrome, Edge, Firefox, and Safari all ship with Service Worker support —
        if your browser doesn't, it's likely an in-app WeChat / Line / Instagram
        webview or a very old build. Open this URL in the real system browser
        (Chrome / Safari) instead.
      </>
    );
  } else if (!d.hasPushManager) {
    title = "This browser doesn't expose the Push API.";
    body = (
      <>
        Some older Chromium forks and privacy-first browsers strip out{" "}
        <code>PushManager</code>. Try Chrome, Edge, Firefox, or Safari 16.4+.
      </>
    );
  } else if (!d.hasNotificationApi) {
    title = "This browser doesn't expose the Notification API.";
    body = (
      <>
        The Notification API is missing from this browser. Try Chrome, Edge,
        Firefox, or Safari 16.4+ in a normal (non-in-app) window.
      </>
    );
  } else {
    title = "Push isn't available in this browser.";
    body = (
      <>
        Try opening this page in Chrome, Edge, Firefox, or Safari 16.4+ over
        HTTPS. On iPhone / iPad, first add the app to your Home Screen.
      </>
    );
  }

  const border =
    tone === "danger"
      ? "border-danger/40 bg-danger/10"
      : tone === "primary"
        ? "border-primary/40 bg-primary/5"
        : "border-warning/40 bg-warning/10";
  const titleColor =
    tone === "danger"
      ? "text-danger"
      : tone === "primary"
        ? "text-primary"
        : "text-warning";

  return (
    <div className={cn("rounded-md border p-3 text-xs", border)}>
      <p className={cn("font-medium", titleColor)}>{title}</p>
      <p className="mt-1 text-muted-foreground">{body}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible "why is my browser blocking push?" panel. Renders every
// capability check as a green/red row so users can copy this into a bug
// report or share it with support.
// ---------------------------------------------------------------------------

function PushDiagnosticsDetails({
  diagnostics: d,
  permission,
  swRegistration,
  subscribed,
  subscriberCount,
}: {
  diagnostics: PushSupportDiagnostics;
  permission: PermissionState;
  swRegistration: ServiceWorkerRegistrationStatus | null;
  subscribed: boolean;
  subscriberCount: number;
}) {
  // Derive human-friendly SW row inputs. The registrar writes an
  // async marker to `caches.sw-diag/__sw-register-status`; a `null`
  // reading means the marker hasn't been written yet (first ~1s
  // after page load) OR the browser has no Cache API. Either way,
  // we render it as neutral rather than red so we don't spuriously
  // scare users into filing bugs.
  const swOk = swRegistration?.state === "registered";
  const swNeutral =
    swRegistration === null || swRegistration.state === "registering";
  const swLabel = (() => {
    if (!swRegistration) return "Service Worker: checking…";
    switch (swRegistration.state) {
      case "unsupported":
        return "Service Worker: unsupported";
      case "registering":
        return "Service Worker: registering…";
      case "registered":
        return `Service Worker: ${swRegistration.phase ?? "active"}`;
      case "failed":
        return `Service Worker: failed`;
    }
  })();
  const swHint = (() => {
    if (!swRegistration) {
      return "Waiting for the SW registrar in /sw-register.js to report in — this usually takes under a second after page load.";
    }
    switch (swRegistration.state) {
      case "unsupported":
        return "This browser doesn't expose navigator.serviceWorker at all — try a mainstream browser.";
      case "registering":
        return "Registration is still in flight; refresh this panel in a moment.";
      case "registered":
        return `Registered for scope ${swRegistration.scope ?? "/"}. Push events will wake this worker.`;
      case "failed":
        return `register() rejected: ${swRegistration.reason ?? "unknown"}. Reload the page; if it persists, check the browser console for CSP / quota errors.`;
    }
  })();

  return (
    <details className="rounded-md border border-border/60 bg-muted/20 text-xs">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 select-none">
        <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">Push diagnostics (why isn&apos;t it working?)</span>
        <ChevronDown className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
      </summary>
      <ul className="space-y-1 px-3 pb-3">
        <DiagRow ok={d.isSecureContext} label="Secure context (HTTPS or localhost)" hint="Web Push refuses to run over plain HTTP LAN IPs." />
        <DiagRow ok={d.hasServiceWorker} label="Service Worker API available" hint="Required to receive pushes in the background." />
        <DiagRow ok={d.hasPushManager} label="Push API available" hint="Provides pushManager.subscribe()." />
        <DiagRow ok={d.hasNotificationApi} label="Notification API available" hint="Required to show OS-level alerts." />
        <DiagRow
          ok={!d.isIos || d.isStandalone}
          label={d.isIos ? "iOS Home Screen install" : "iOS not detected"}
          hint={
            d.isIos
              ? "iOS only delivers push to PWAs installed via Share → Add to Home Screen."
              : "This device isn't iOS, so the Home Screen install rule doesn't apply."
          }
          neutral={!d.isIos}
        />
        <DiagRow
          ok={permission === "granted"}
          neutral={permission === "default"}
          label={`Notification permission: ${permission}`}
          hint={
            permission === "denied"
              ? "You (or a previous visit) blocked notifications for this site — re-allow it in browser settings."
              : permission === "granted"
                ? "You've already granted permission."
                : "You'll be asked when you click Enable."
          }
        />
        {/* New rows below — these tell the user WHY notifications
             aren't arriving even AFTER Enable succeeded. The
             historical diagnostic panel only covered the "why is
             Enable disabled" case. */}
        <DiagRow
          ok={swOk}
          neutral={swNeutral}
          label={swLabel}
          hint={swHint}
        />
        <DiagRow
          ok={subscribed}
          label={
            subscribed
              ? "Push subscription: active on this device"
              : "Push subscription: not created yet"
          }
          hint={
            subscribed
              ? "The browser has a live PushManager subscription and the server knows about it."
              : "Click Enable push on this device above. If it succeeds but this row still says 'not created', the browser's pushManager.subscribe() failed silently — check the console for a NotAllowedError."
          }
        />
        <DiagRow
          ok={subscriberCount > 0}
          label={`Server-known subscribers: ${subscriberCount}`}
          hint={
            subscriberCount > 0
              ? `The server can deliver pushes to ${subscriberCount} device(s). Test with the "Send test push" button — if the toast doesn't appear, the issue is downstream of the server (OS DND / Focus Mode, browser site permission, or the push service).`
              : "The server has zero subscribers stored. Click Enable push on this device above; if the count stays at zero, the /api/push POST rejected the subscription (bad VAPID key, endpoint allow-list, or auth cookie missing on the SW request)."
          }
        />
      </ul>
    </details>
  );
}

function DiagRow({
  ok,
  neutral,
  label,
  hint,
}: {
  ok: boolean;
  neutral?: boolean;
  label: string;
  hint: string;
}) {
  const icon = neutral ? (
    <Minus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
  ) : ok ? (
    <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
  ) : (
    <XCircle className="h-3.5 w-3.5 text-danger shrink-0" />
  );
  return (
    <li className="flex items-start gap-2">
      {icon}
      <div className="min-w-0">
        <div className="font-medium">{label}</div>
        <div className="text-[0.7rem] text-muted-foreground">{hint}</div>
      </div>
    </li>
  );
}
