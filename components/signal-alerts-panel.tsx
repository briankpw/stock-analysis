"use client";

/**
 * Central listing of per-ticker Signal & Resonance alerts.
 *
 * The alert configurators for the Technical Signal card and the 6-Signal
 * Resonance card each write to their own SQLite table (via
 * `use-technical-alerts` / `use-resonance-alerts`). They render inline
 * on each ticker's analysis page, which is great for turning an alert
 * on — but it means users can't answer "which tickers do I currently
 * have alerts on?" without visiting each page one by one.
 *
 * This panel is the missing dashboard: every configured alert appears
 * in a compact row with its digest time, on-change gate, and last-fired
 * timestamp, plus row-level Test / Delete / Open-in-analysis buttons.
 * Delete pops the row from the store immediately (optimistic via the
 * shared cache); Open navigates to the Signal page with that ticker
 * pre-selected so the user can update the config.
 *
 * Renders as one Card containing two subsections rather than two Cards
 * so the visual density stays consistent with the surrounding portfolio
 * / stock / news panels below it on the /bot page.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  Bell,
  Clock,
  ExternalLink,
  Loader2,
  Send,
  Target,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/lib/i18n";
import { useUi } from "@/lib/state";
import { relativeTime } from "@/lib/format";
import { useTechnicalAlerts } from "@/hooks/use-technical-alerts";
import { useResonanceAlerts } from "@/hooks/use-resonance-alerts";
import { cn } from "@/lib/utils";
import type {
  AlertStrength,
  TechnicalAlert,
} from "@/lib/technical-watch/store";
import type {
  ResonanceAlert,
  ResonanceAlertStrength,
} from "@/lib/resonance-watch/store";

type AlertKind = "technical" | "resonance";

// ---------------------------------------------------------------------------
// Strength copy — matches the labels used in the individual alert popovers
// so the /bot summary reads the same as the configurator the user just left.
// ---------------------------------------------------------------------------

type Translator = (
  key: string,
  params?: Record<string, string | number>,
) => string;

function techStrengthLabel(s: AlertStrength, t: Translator): string {
  switch (s) {
    case "all":
      return t("bot.signalAlerts.strength.all");
    case "buy_sell":
      return t("bot.signalAlerts.strength.buySell");
    case "strong_only":
      return t("bot.signalAlerts.strength.strongOnly");
  }
}

function resStrengthLabel(
  s: ResonanceAlertStrength,
  t: Translator,
): string {
  switch (s) {
    case "all":
      return t("bot.signalAlerts.strength.all");
    case "trigger_only":
      return t("bot.signalAlerts.strength.triggerOnly");
    case "strong_only":
      return t("bot.signalAlerts.strength.strongOnly");
  }
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function SignalAlertsPanel() {
  const t = useT();
  const router = useRouter();
  const setTicker = useUi((s) => s.setTicker);

  const {
    alerts: techAlerts,
    loading: techLoading,
    remove: removeTechnical,
    test: testTechnical,
  } = useTechnicalAlerts();
  const {
    alerts: resAlerts,
    loading: resLoading,
    remove: removeResonance,
    test: testResonance,
  } = useResonanceAlerts();

  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{
    tone: "ok" | "err";
    text: string;
  } | null>(null);

  const openInAnalysis = React.useCallback(
    (ticker: string) => {
      setTicker(ticker);
      router.push("/signal");
    },
    [router, setTicker],
  );

  const handleRemove = async (
    kind: AlertKind,
    ticker: string,
    fn: (ticker: string) => Promise<void>,
  ) => {
    const label =
      kind === "technical"
        ? t("bot.signalAlerts.confirmRemoveTechnical", { ticker })
        : t("bot.signalAlerts.confirmRemoveResonance", { ticker });
    if (!confirm(label)) return;
    const id = `${kind}:remove:${ticker}`;
    setBusy(id);
    setMessage(null);
    try {
      await fn(ticker);
      setMessage({
        tone: "ok",
        text: t("bot.signalAlerts.removed", { ticker }),
      });
    } catch (e) {
      setMessage({
        tone: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async (
    kind: AlertKind,
    ticker: string,
    fn: (ticker: string) => Promise<{ ok: boolean; detail?: string }>,
  ) => {
    const id = `${kind}:test:${ticker}`;
    setBusy(id);
    setMessage(null);
    try {
      const res = await fn(ticker);
      setMessage({
        tone: res.ok ? "ok" : "err",
        text: res.detail ?? t("bot.signalAlerts.testSent", { ticker }),
      });
    } catch (e) {
      setMessage({
        tone: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(null);
    }
  };

  const loading = techLoading || resLoading;

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <Bell className="h-4 w-4 text-primary" />
          <CardTitle>{t("bot.signalAlerts.title")}</CardTitle>
          <span className="text-xs text-muted-foreground">
            {t("bot.signalAlerts.subtitle")}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {message && (
          <p
            className={cn(
              "text-xs",
              message.tone === "ok" ? "text-primary" : "text-danger",
            )}
          >
            {message.text}
          </p>
        )}

        <AlertsSubsection
          icon={<Target className="h-3.5 w-3.5 text-primary" />}
          title={t("bot.signalAlerts.technical.title")}
          hint={t("bot.signalAlerts.technical.hint")}
          count={techAlerts.length}
          loading={loading && techAlerts.length === 0}
          emptyHint={
            <>
              {t("bot.signalAlerts.technical.emptyBefore")}{" "}
              <button
                type="button"
                onClick={() => router.push("/signal")}
                className="text-primary hover:underline"
              >
                {t("bot.signalAlerts.technical.emptyLink")}
              </button>{" "}
              {t("bot.signalAlerts.technical.emptyAfter")}
            </>
          }
        >
          {techAlerts.map((a) => (
            <TechnicalAlertRow
              key={a.ticker}
              alert={a}
              busy={busy}
              onOpen={() => openInAnalysis(a.ticker)}
              onRemove={() =>
                handleRemove("technical", a.ticker, removeTechnical)
              }
              onTest={() => handleTest("technical", a.ticker, testTechnical)}
            />
          ))}
        </AlertsSubsection>

        <AlertsSubsection
          icon={<Activity className="h-3.5 w-3.5 text-primary" />}
          title={t("bot.signalAlerts.resonance.title")}
          hint={t("bot.signalAlerts.resonance.hint")}
          count={resAlerts.length}
          loading={loading && resAlerts.length === 0}
          emptyHint={
            <>
              {t("bot.signalAlerts.resonance.emptyBefore")}{" "}
              <button
                type="button"
                onClick={() => router.push("/signal")}
                className="text-primary hover:underline"
              >
                {t("bot.signalAlerts.resonance.emptyLink")}
              </button>{" "}
              {t("bot.signalAlerts.resonance.emptyAfter")}
            </>
          }
        >
          {resAlerts.map((a) => (
            <ResonanceAlertRow
              key={a.ticker}
              alert={a}
              busy={busy}
              onOpen={() => openInAnalysis(a.ticker)}
              onRemove={() =>
                handleRemove("resonance", a.ticker, removeResonance)
              }
              onTest={() => handleTest("resonance", a.ticker, testResonance)}
            />
          ))}
        </AlertsSubsection>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Subsection shell (shared by technical + resonance lists)
// ---------------------------------------------------------------------------

function AlertsSubsection({
  icon,
  title,
  hint,
  count,
  loading,
  emptyHint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  count: number;
  loading: boolean;
  emptyHint: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <span className="metric-label">
          {title} ({count})
        </span>
      </div>
      <p className="text-[0.7rem] text-muted-foreground mb-2">{hint}</p>
      {loading ? (
        <p className="text-xs text-muted-foreground">…</p>
      ) : count === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
      ) : (
        <ul className="space-y-1.5">{children}</ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row components — kept per-kind so the strength chip pulls from the right
// enum without a generic gymnastics layer.
// ---------------------------------------------------------------------------

function AlertRowShell({
  ticker,
  digestChip,
  strengthChip,
  onChangeChip,
  lastNotified,
  onOpen,
  onTest,
  onRemove,
  busy,
  testId,
  removeId,
  openTitle,
  testTitle,
  removeTitle,
}: {
  ticker: string;
  digestChip: React.ReactNode | null;
  strengthChip: React.ReactNode | null;
  onChangeChip: React.ReactNode | null;
  lastNotified: string | null;
  onOpen: () => void;
  onTest: () => void;
  onRemove: () => void;
  busy: string | null;
  testId: string;
  removeId: string;
  openTitle: string;
  testTitle: string;
  removeTitle: string;
}) {
  const t = useT();
  const testBusy = busy === testId;
  const removeBusy = busy === removeId;
  return (
    <li className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-xs flex-wrap">
      <button
        type="button"
        onClick={onOpen}
        title={openTitle}
        className="chip chip-bull font-mono hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {ticker}
      </button>
      {digestChip}
      {onChangeChip}
      {strengthChip}
      {lastNotified && (
        <span className="text-[0.65rem] text-muted-foreground">
          {t("bot.signalAlerts.lastNotified", {
            when: relativeTime(lastNotified),
          })}
        </span>
      )}
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={onTest}
          disabled={testBusy || removeBusy}
          title={testTitle}
          aria-label={testTitle}
          className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-primary/15 hover:text-primary text-muted-foreground disabled:opacity-40"
        >
          {testBusy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Send className="h-3 w-3" />
          )}
        </button>
        <button
          type="button"
          onClick={onOpen}
          title={openTitle}
          aria-label={openTitle}
          className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-primary/15 hover:text-primary text-muted-foreground"
        >
          <ExternalLink className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={testBusy || removeBusy}
          title={removeTitle}
          aria-label={removeTitle}
          className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-danger/15 hover:text-danger text-muted-foreground disabled:opacity-40"
        >
          {removeBusy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="h-3 w-3" />
          )}
        </button>
      </div>
    </li>
  );
}

function TechnicalAlertRow({
  alert,
  busy,
  onOpen,
  onTest,
  onRemove,
}: {
  alert: TechnicalAlert;
  busy: string | null;
  onOpen: () => void;
  onTest: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const digestChip = alert.dailyTime ? (
    <span
      className="chip chip-neu text-[0.65rem]"
      title={t("bot.signalAlerts.digestTitle", {
        time: alert.dailyTime,
        tz: alert.timezone,
      })}
    >
      <Clock className="h-3 w-3" /> {alert.dailyTime}
      <span className="opacity-70 ml-1">{alert.timezone}</span>
    </span>
  ) : null;
  const onChangeChip = alert.notifyOnChange ? (
    <span className="chip chip-bull text-[0.65rem]">
      {t("bot.signalAlerts.onChange")}
    </span>
  ) : null;
  const strengthChip = alert.notifyOnChange ? (
    <span className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
      {techStrengthLabel(alert.minStrength, t)}
    </span>
  ) : null;
  return (
    <AlertRowShell
      ticker={alert.ticker}
      digestChip={digestChip}
      onChangeChip={onChangeChip}
      strengthChip={strengthChip}
      lastNotified={alert.lastNotifiedAt}
      onOpen={onOpen}
      onTest={onTest}
      onRemove={onRemove}
      busy={busy}
      testId={`technical:test:${alert.ticker}`}
      removeId={`technical:remove:${alert.ticker}`}
      openTitle={t("bot.signalAlerts.open", { ticker: alert.ticker })}
      testTitle={t("bot.signalAlerts.test", { ticker: alert.ticker })}
      removeTitle={t("bot.signalAlerts.remove", { ticker: alert.ticker })}
    />
  );
}

function ResonanceAlertRow({
  alert,
  busy,
  onOpen,
  onTest,
  onRemove,
}: {
  alert: ResonanceAlert;
  busy: string | null;
  onOpen: () => void;
  onTest: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const digestChip = alert.dailyTime ? (
    <span
      className="chip chip-neu text-[0.65rem]"
      title={t("bot.signalAlerts.digestTitle", {
        time: alert.dailyTime,
        tz: alert.timezone,
      })}
    >
      <Clock className="h-3 w-3" /> {alert.dailyTime}
      <span className="opacity-70 ml-1">{alert.timezone}</span>
    </span>
  ) : null;
  const onChangeChip = alert.notifyOnChange ? (
    <span className="chip chip-bull text-[0.65rem]">
      {t("bot.signalAlerts.onChange")}
    </span>
  ) : null;
  const strengthChip = alert.notifyOnChange ? (
    <span className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
      {resStrengthLabel(alert.minStrength, t)}
    </span>
  ) : null;
  return (
    <AlertRowShell
      ticker={alert.ticker}
      digestChip={digestChip}
      onChangeChip={onChangeChip}
      strengthChip={strengthChip}
      lastNotified={alert.lastNotifiedAt}
      onOpen={onOpen}
      onTest={onTest}
      onRemove={onRemove}
      busy={busy}
      testId={`resonance:test:${alert.ticker}`}
      removeId={`resonance:remove:${alert.ticker}`}
      openTitle={t("bot.signalAlerts.open", { ticker: alert.ticker })}
      testTitle={t("bot.signalAlerts.test", { ticker: alert.ticker })}
      removeTitle={t("bot.signalAlerts.remove", { ticker: alert.ticker })}
    />
  );
}
