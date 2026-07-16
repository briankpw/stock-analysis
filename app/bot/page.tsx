"use client";

import * as React from "react";
import { CheckCircle2, XCircle, TrendingDown, TrendingUp, Minus, Send } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageIntro } from "@/components/page-intro";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ErrorBanner, LoadingPage } from "@/components/loading";
import { useUi } from "@/lib/state";
import { relativeTime, fmtCurrency } from "@/lib/format";
import type { StoredSignal } from "@/lib/bot/store";
import type { StrategyKey } from "@/lib/bot/strategy";
import { humanName } from "@/lib/bot/strategy";
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
  const icon = s.type === "BUY" ? <TrendingUp className="h-3.5 w-3.5" />
             : s.type === "SELL" ? <TrendingDown className="h-3.5 w-3.5" />
             :                     <Minus className="h-3.5 w-3.5" />;
  return (
    <li className="glass rounded-lg p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn(
          "chip",
          s.type === "BUY" ? "chip-bull" : s.type === "SELL" ? "chip-bear" : "chip-neu",
        )}>{icon} {s.type}</span>
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
          <Send className="h-2.5 w-2.5 inline" /> alerted via Telegram
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

  const run = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    setMessage(null);
    try {
      const res = await post({ action, ...extra });
      if (res?.report) {
        setMessage(`Tick complete: ${res.report.signalsFired} signals, ${res.report.notifiesSent} alerts sent.`);
      } else if (res?.detail) {
        setMessage(res.detail);
      } else {
        setMessage("Done.");
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
      <PageHeader pageTitle="Alert Bot" />
      <PageIntro pageKey="bot" />

      {error && <ErrorBanner message={error} retry={reload} />}
      {!data && !error && loading && <LoadingPage label="Loading bot status…" />}

      {data && (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr] animate-fade-in">
          {/* Left column: config */}
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle>Status</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span>Enabled</span>
                  <Button
                    size="sm"
                    variant={data.enabled ? "success" : "outline"}
                    onClick={() => run("set-enabled", { enabled: !data.enabled })}
                    disabled={busy === "set-enabled"}
                  >
                    {data.enabled ? "ON" : "OFF"}
                  </Button>
                </div>
                <div className="flex items-center justify-between">
                  <span>Telegram</span>
                  {data.telegramConfigured ? (
                    <span className="chip chip-bull"><CheckCircle2 className="h-3.5 w-3.5" /> Configured</span>
                  ) : (
                    <span className="chip chip-bear"><XCircle className="h-3.5 w-3.5" /> Missing token / chat id</span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span>Poll interval</span>
                  <span>{data.pollIntervalSeconds}s</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Last tick</span>
                  <span>{data.lastTickAt ? relativeTime(data.lastTickAt) : "—"}</span>
                </div>
                {data.lastTickStatus?.errors && data.lastTickStatus.errors.length > 0 && (
                  <div>
                    <p className="metric-label mb-1">Last errors</p>
                    <ul className="space-y-1 text-xs text-danger">
                      {data.lastTickStatus.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}
                {message && <p className="text-xs text-primary">{message}</p>}
                <div className="flex flex-col gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => run("run-tick", { ticker })} disabled={!!busy}>
                    Run one tick now
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => run("test")} disabled={!data.telegramConfigured || !!busy}>
                    Send test alert
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => run("clear-history", { ticker })} disabled={!!busy}>
                    Clear signal history for {ticker}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Strategies</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {data.availableStrategies.map((k) => (
                  <label key={k} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={data.activeStrategies.includes(k)}
                      onChange={() => toggleStrategy(k)}
                      className="h-4 w-4"
                    />
                    <span className="text-sm">{humanName(k)}</span>
                  </label>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Right column: history */}
          <Card>
            <CardHeader>
              <CardTitle>Signal history · {ticker}</CardTitle>
              <p className="text-xs text-muted-foreground">
                All signals recorded by the bot, most recent first. Only cross-events get sent to Telegram.
              </p>
            </CardHeader>
            <CardContent>
              {data.signals.length === 0 ? (
                <p className="text-sm text-muted-foreground">No signals recorded yet. Run one tick to seed the feed.</p>
              ) : (
                <ul className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                  {data.signals.map((s) => <SignalRow key={s.id} s={s} />)}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
