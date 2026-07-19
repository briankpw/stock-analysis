"use client";

/**
 * Configurator for per-market-segment 6-Signal Resonance
 * notifications.
 *
 * Structural mirror of `ResonanceAlertControl` — same portal-anchored
 * popover, same daily-digest + on-change controls, same strength
 * gate. The only meaningful difference is the primary key: this
 * component takes an explicit `segmentId` prop rather than reading
 * the current ticker from the global UI store. Segment context
 * (name, proxy ETF) is passed in so the popover header can identify
 * the subscription in the user's own words.
 *
 * Slots into the header of the segment detail page's Sector
 * Resonance section — replaces the `showAlertControl={false}`
 * marker that was there when sector alerts didn't exist yet.
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
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { useSectorResonanceAlerts } from "@/hooks/use-sector-resonance-alerts";
import type { SectorResonanceAlertStrength } from "@/lib/sector-resonance-watch/store";
import { DEFAULT_ALERT_DAILY_TIME } from "@/lib/alert-defaults";

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const STRENGTH_ORDER: SectorResonanceAlertStrength[] = [
  "all",
  "trigger_only",
  "strong_only",
];

export interface SectorResonanceAlertControlProps {
  segmentId: string;
  segmentName: string;
  proxyTicker: string;
}

export function SectorResonanceAlertControl({
  segmentId,
  segmentName,
  proxyTicker,
}: SectorResonanceAlertControlProps) {
  const t = useT();
  const { find, upsert, remove, test } = useSectorResonanceAlerts();
  const current = find(segmentId);

  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<
    "save" | "delete" | "test" | null
  >(null);
  const [status, setStatus] = React.useState<
    { kind: "ok" | "err"; message: string } | null
  >(null);

  // Portal + viewport-anchor plumbing — same rationale as
  // ResonanceAlertControl. Every `<Card>` applies `.glass`
  // (backdrop-filter), creating a stacking context; a z-50 popover
  // inside one card can never paint above a sibling card. Render
  // through a portal to `document.body` and position via `fixed`.
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
    React.useState<SectorResonanceAlertStrength>("trigger_only");

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
      setMinStrength("trigger_only");
    }
    setStatus(null);
  }, [current, segmentId]);

  const configured = Boolean(current);
  const buttonLabel = configured
    ? t("srs.alert.button.configured")
    : t("srs.alert.button.off");

  const onSave = async () => {
    setStatus(null);
    setBusy("save");
    try {
      await upsert({
        segmentId,
        dailyTime: digestEnabled ? dailyTime : null,
        timezone,
        notifyOnChange,
        minStrength,
      });
      setStatus({ kind: "ok", message: t("srs.alert.status.saved") });
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
      await remove(segmentId);
      setStatus({ kind: "ok", message: t("srs.alert.status.removed") });
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
      const res = await test(segmentId);
      setStatus({
        kind: res.ok ? "ok" : "err",
        message: res.ok
          ? t("srs.alert.status.testSent")
          : res.detail ?? t("srs.alert.status.testFailed"),
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
        aria-label={t("srs.alert.title")}
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
              <Activity className="h-3.5 w-3.5 text-primary" />
              {t("srs.alert.title")}
            </p>
            <p className="text-[0.7rem] text-muted-foreground mt-0.5">
              {t("srs.alert.subtitle", {
                segment: segmentName,
                proxy: proxyTicker,
              })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-muted-foreground hover:text-foreground text-lg leading-none"
            aria-label={t("srs.alert.close")}
          >
            ×
          </button>
        </div>

        {/* --- Daily digest ------------------------------------------ */}
        <fieldset className="space-y-1.5 border border-border/60 rounded-lg p-2">
          <legend className="text-[0.7rem] font-semibold px-1 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {t("srs.alert.digest.title")}
          </legend>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={digestEnabled}
              onChange={(e) => setDigestEnabled(e.target.checked)}
              className="rounded border-border"
            />
            <span>{t("srs.alert.digest.enable")}</span>
          </label>
          <div
            className={cn(
              "grid grid-cols-2 gap-2 pl-6",
              !digestEnabled && "opacity-50 pointer-events-none",
            )}
          >
            <label className="flex flex-col gap-0.5 text-[0.65rem] text-muted-foreground">
              <span>{t("srs.alert.digest.time")}</span>
              <input
                type="time"
                step={60}
                value={dailyTime}
                onChange={(e) => setDailyTime(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground font-mono"
                aria-label={t("srs.alert.digest.time")}
              />
            </label>
            <label className="flex flex-col gap-0.5 text-[0.65rem] text-muted-foreground">
              <span>{t("srs.alert.digest.timezone")}</span>
              <input
                type="text"
                list="srs-tz-suggestions"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground font-mono truncate"
                aria-label={t("srs.alert.digest.timezone")}
                placeholder="UTC"
              />
            </label>
            <datalist id="srs-tz-suggestions">
              {TIMEZONE_SUGGESTIONS.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </div>
          <p className="text-[0.65rem] text-muted-foreground pl-6 leading-relaxed">
            {t("srs.alert.digest.hint")}
          </p>
        </fieldset>

        {/* --- On-change --------------------------------------------- */}
        <fieldset className="space-y-1.5 border border-border/60 rounded-lg p-2">
          <legend className="text-[0.7rem] font-semibold px-1">
            {t("srs.alert.change.title")}
          </legend>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={notifyOnChange}
              onChange={(e) => setNotifyOnChange(e.target.checked)}
              className="rounded border-border"
            />
            <span>{t("srs.alert.change.enable")}</span>
          </label>
          <div
            className={cn(
              "pl-6 space-y-1",
              !notifyOnChange && "opacity-50 pointer-events-none",
            )}
          >
            <p className="text-[0.65rem] text-muted-foreground">
              {t("srs.alert.change.strength")}
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
                    {t(`srs.alert.change.strength.${s}`)}
                  </button>
                );
              })}
            </div>
            <p className="text-[0.6rem] text-muted-foreground italic pt-0.5">
              {t(`srs.alert.change.strength.${minStrength}.hint`)}
            </p>
          </div>
        </fieldset>

        <p className="text-[0.6rem] text-muted-foreground/80 leading-relaxed">
          {t("srs.alert.footnote", { proxy: proxyTicker })}
        </p>

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

        {/* --- Actions ----------------------------------------------- */}
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
              ? t("srs.alert.actions.update")
              : t("srs.alert.actions.save")}
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
              title={t("srs.alert.actions.testTitle")}
            >
              {busy === "test" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              {t("srs.alert.actions.test")}
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
              {t("srs.alert.actions.remove")}
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
            ? t("srs.alert.chip.digest", {
                time: current.dailyTime,
                tz: current.timezone,
              })
            : configured
              ? t("srs.alert.chip.on")
              : t("srs.alert.chip.off")}
        </span>
      </button>
      {mounted && dialog && createPortal(dialog, document.body)}
    </div>
  );
}

// Same curated IANA list used by ResonanceAlertControl. The input
// is a free-text field so users can type any zone; this datalist
// just provides one-click access to the most common ones.
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
