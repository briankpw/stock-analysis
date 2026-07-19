"use client";

/**
 * Configurator for per-ticker Master Verdict notifications.
 *
 * Slots into the header of `MasterVerdictCard`. Structurally identical
 * to `TechnicalAlertControl` — the popover layout, portal escape
 * hatch, and viewport-anchor plumbing are all copied verbatim so the
 * two UIs behave the same way (users learn one interaction pattern).
 *
 * Two independent notification channels share the same row (see the
 * `master_alerts` table docs):
 *
 *   • **Daily digest** — user picks HH:MM + timezone. Fires "here's
 *     today's fused verdict" once per local day at (or just after)
 *     that instant. Set to Off to disable.
 *
 *   • **On-change** — checkbox. Fires whenever the master band
 *     crosses since the last evaluation, gated by strength (All /
 *     Buy or Sell / Strong only). Uses the *master* band as the
 *     baseline — a technical-only flip that got absorbed by
 *     fundamentals won't trigger a change ping.
 *
 * `Test now` posts to `/api/master-alerts/test` so users can validate
 * the Telegram / Web-Push wiring without waiting for the daily slot.
 *
 * IMPORTANT — this control is intentionally NOT a shared component
 * with `TechnicalAlertControl`. They look the same today, but the two
 * subsystems can (and probably will) diverge on UX — a master-only
 * "min coverage" gate, different strength vocabulary, or a different
 * chip label. Factoring now would freeze the surface area
 * prematurely.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import {
  Bell,
  BellOff,
  Clock,
  Loader2,
  Trash2,
  Send,
  Check,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { useTicker } from "@/lib/state";
import { useMasterAlerts } from "@/hooks/use-master-alerts";
import type { AlertStrength } from "@/lib/master-watch/store";
import { DEFAULT_ALERT_DAILY_TIME } from "@/lib/alert-defaults";

// See the note in `technical-alert-control.tsx` for the rationale
// behind this fallback and the datalist below — same reasoning.
function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const STRENGTH_ORDER: AlertStrength[] = ["all", "buy_sell", "strong_only"];

export function MasterAlertControl() {
  const t = useT();
  const ticker = useTicker();
  const { find, upsert, remove, test } = useMasterAlerts();
  const current = find(ticker);

  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<
    "save" | "delete" | "test" | null
  >(null);
  const [status, setStatus] = React.useState<
    { kind: "ok" | "err"; message: string } | null
  >(null);

  // Portal + viewport-anchor plumbing — see the detailed rationale in
  // `technical-alert-control.tsx`. Every `<Card>` uses `.glass` which
  // creates a stacking context via `backdrop-filter`, so a nested
  // popover cannot rise above sibling cards; the portal escapes that.
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = React.useState<{
    top: number;
    right: number;
  } | null>(null);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useLayoutEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    const measure = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setAnchor({
        top: rect.bottom + 8,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const [digestEnabled, setDigestEnabled] = React.useState(false);
  const [dailyTime, setDailyTime] = React.useState(DEFAULT_ALERT_DAILY_TIME);
  const [timezone, setTimezone] = React.useState<string>(detectTimezone());
  const [notifyOnChange, setNotifyOnChange] = React.useState(true);
  const [minStrength, setMinStrength] =
    React.useState<AlertStrength>("buy_sell");

  // Re-sync the form whenever the persisted config or selected ticker
  // changes — keeps the popover honest if another tab edits the rule
  // between opens.
  React.useEffect(() => {
    if (current) {
      setDigestEnabled(current.dailyTime !== null);
      if (current.dailyTime) setDailyTime(current.dailyTime);
      setTimezone(current.timezone);
      setNotifyOnChange(current.notifyOnChange);
      setMinStrength(current.minStrength);
    } else {
      setDigestEnabled(false);
      setDailyTime(DEFAULT_ALERT_DAILY_TIME);
      setTimezone(detectTimezone());
      setNotifyOnChange(true);
      setMinStrength("buy_sell");
    }
    setStatus(null);
  }, [current, ticker]);

  const configured = Boolean(current);
  const buttonLabel = configured
    ? t("master.alert.button.configured")
    : t("master.alert.button.off");

  const onSave = async () => {
    setStatus(null);
    setBusy("save");
    try {
      await upsert({
        ticker,
        dailyTime: digestEnabled ? dailyTime : null,
        timezone,
        notifyOnChange,
        minStrength,
      });
      setStatus({ kind: "ok", message: t("master.alert.status.saved") });
    } catch (err) {
      setStatus({
        kind: "err",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async () => {
    setStatus(null);
    setBusy("delete");
    try {
      await remove(ticker);
      setStatus({ kind: "ok", message: t("master.alert.status.removed") });
    } catch (err) {
      setStatus({
        kind: "err",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  };

  const onTest = async () => {
    setStatus(null);
    setBusy("test");
    try {
      const res = await test(ticker);
      setStatus({
        kind: res.ok ? "ok" : "err",
        message: res.ok
          ? t("master.alert.status.testSent")
          : res.detail ?? t("master.alert.status.testFailed"),
      });
    } catch (err) {
      setStatus({
        kind: "err",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  };

  const dialog = open && anchor && (
    <>
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={() => setOpen(false)}
        className="fixed inset-0 z-[100] cursor-default"
      />

      <div
        role="dialog"
        aria-label={t("master.alert.title")}
        style={{ top: anchor.top, right: anchor.right }}
        className={cn(
          "fixed z-[101] w-[min(92vw,22rem)] max-h-[calc(100vh-2rem)] overflow-y-auto",
          "rounded-xl border border-border bg-card shadow-2xl",
          "p-3 space-y-3",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold flex items-center gap-1.5">
              <Bell className="h-3.5 w-3.5 text-primary" />
              {t("master.alert.title")}
            </p>
            <p className="text-[0.7rem] text-muted-foreground mt-0.5">
              {t("master.alert.subtitle", { ticker })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-muted-foreground hover:text-foreground text-lg leading-none"
            aria-label={t("master.alert.close")}
          >
            ×
          </button>
        </div>

        {/* --- Daily digest ---------------------------------------- */}
        <fieldset className="space-y-1.5 border border-border/60 rounded-lg p-2">
          <legend className="text-[0.7rem] font-semibold px-1 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {t("master.alert.digest.title")}
          </legend>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={digestEnabled}
              onChange={(e) => setDigestEnabled(e.target.checked)}
              className="rounded border-border"
            />
            <span>{t("master.alert.digest.enable")}</span>
          </label>
          <div
            className={cn(
              "grid grid-cols-2 gap-2 pl-6",
              !digestEnabled && "opacity-50 pointer-events-none",
            )}
          >
            <label className="flex flex-col gap-0.5 text-[0.65rem] text-muted-foreground">
              <span>{t("master.alert.digest.time")}</span>
              <input
                type="time"
                step={60}
                value={dailyTime}
                onChange={(e) => setDailyTime(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground font-mono"
                aria-label={t("master.alert.digest.time")}
              />
            </label>
            <label className="flex flex-col gap-0.5 text-[0.65rem] text-muted-foreground">
              <span>{t("master.alert.digest.timezone")}</span>
              <input
                type="text"
                list="master-tz-suggestions"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground font-mono truncate"
                aria-label={t("master.alert.digest.timezone")}
                placeholder="UTC"
              />
            </label>
            <datalist id="master-tz-suggestions">
              {TIMEZONE_SUGGESTIONS.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </div>
          <p className="text-[0.65rem] text-muted-foreground pl-6 leading-relaxed">
            {t("master.alert.digest.hint")}
          </p>
        </fieldset>

        {/* --- On-change ------------------------------------------ */}
        <fieldset className="space-y-1.5 border border-border/60 rounded-lg p-2">
          <legend className="text-[0.7rem] font-semibold px-1">
            {t("master.alert.change.title")}
          </legend>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={notifyOnChange}
              onChange={(e) => setNotifyOnChange(e.target.checked)}
              className="rounded border-border"
            />
            <span>{t("master.alert.change.enable")}</span>
          </label>
          <div
            className={cn(
              "pl-6 space-y-1",
              !notifyOnChange && "opacity-50 pointer-events-none",
            )}
          >
            <p className="text-[0.65rem] text-muted-foreground">
              {t("master.alert.change.strength")}
            </p>
            <div className="flex flex-wrap gap-1">
              {STRENGTH_ORDER.map((s) => {
                const active = minStrength === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setMinStrength(s)}
                    aria-pressed={active}
                    className={cn(
                      "text-[0.65rem] px-2 py-1 rounded-md border transition-colors",
                      active
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground",
                    )}
                  >
                    {t(`master.alert.change.strength.${s}`)}
                  </button>
                );
              })}
            </div>
          </div>
        </fieldset>

        {status && (
          <div
            role="status"
            className={cn(
              "text-[0.7rem] rounded-md px-2 py-1.5 flex items-start gap-1.5",
              status.kind === "ok"
                ? "bg-success/10 text-success border border-success/30"
                : "bg-danger/10 text-danger border border-danger/30",
            )}
          >
            {status.kind === "ok" ? (
              <Check className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            )}
            <span className="break-words">{status.message}</span>
          </div>
        )}

        {/* --- Actions -------------------------------------------- */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          <button
            type="button"
            onClick={onSave}
            disabled={busy !== null}
            className={cn(
              "text-xs font-medium rounded-md px-3 py-1.5 transition-colors inline-flex items-center gap-1.5",
              "border border-primary/40 bg-primary text-primary-foreground hover:bg-primary/90",
              "disabled:opacity-60 disabled:cursor-not-allowed",
            )}
          >
            {busy === "save" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
            {configured
              ? t("master.alert.actions.update")
              : t("master.alert.actions.save")}
          </button>
          {configured && (
            <button
              type="button"
              onClick={onTest}
              disabled={busy !== null}
              className={cn(
                "text-xs font-medium rounded-md px-3 py-1.5 transition-colors inline-flex items-center gap-1.5",
                "border border-border bg-card text-foreground hover:border-primary/30 hover:text-primary",
                "disabled:opacity-60 disabled:cursor-not-allowed",
              )}
              title={t("master.alert.actions.testTitle")}
            >
              {busy === "test" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              {t("master.alert.actions.test")}
            </button>
          )}
          {configured && (
            <button
              type="button"
              onClick={onDelete}
              disabled={busy !== null}
              className={cn(
                "text-xs font-medium rounded-md px-3 py-1.5 transition-colors inline-flex items-center gap-1.5",
                "border border-danger/30 bg-danger/5 text-danger hover:bg-danger/10",
                "disabled:opacity-60 disabled:cursor-not-allowed ml-auto",
              )}
            >
              {busy === "delete" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              {t("master.alert.actions.remove")}
            </button>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={buttonLabel}
        title={buttonLabel}
        className={cn(
          "inline-flex items-center gap-1.5 text-xs font-medium rounded-md border px-2.5 py-1.5 transition-colors",
          configured
            ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
            : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary",
        )}
      >
        {configured ? (
          <Bell className="h-3.5 w-3.5" />
        ) : (
          <BellOff className="h-3.5 w-3.5" />
        )}
        <span className="hidden sm:inline">
          {configured && current?.dailyTime
            ? t("master.alert.chip.digest", {
                time: current.dailyTime,
                tz: current.timezone,
              })
            : configured
              ? t("master.alert.chip.on")
              : t("master.alert.chip.off")}
        </span>
      </button>
      {mounted && dialog && createPortal(dialog, document.body)}
    </div>
  );
}

// Curated shortlist for the timezone datalist. The input remains a
// plain text field so any IANA zone can be typed, but this covers the
// most common ones on this app's user base. Ordered west→east.
const TIMEZONE_SUGGESTIONS: readonly string[] = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];
