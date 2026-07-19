"use client";

/**
 * /bot dashboard panel for the Portfolio Risk notification channel.
 *
 * The Risks tab in `/my-portfolio` is where users flip risk
 * notifications on and configure the min-severity gate. Once on, the
 * client keeps pushing the current holding set to
 * `/api/portfolio/risks/watches` — that becomes the server-side watch
 * list the worker walks every tick for going-concern audits, delisting
 * notices, price collapse, etc.
 *
 * This panel is the /bot-side counterpart: it lets users see and manage
 * the resulting watches without having to re-import a CSV first. It
 * surfaces:
 *
 *   • enable/disable toggle + min-severity picker (mirrors the tab)
 *   • the currently-monitored ticker list (fresh `fetchWatches()`)
 *   • per-ticker last-known severity + last-notified-at
 *   • a per-ticker remove button (calls DELETE on the endpoint)
 *   • deep-link back to `/my-portfolio?tab=risks` for re-sync + details
 *
 * Deliberately does NOT try to re-sync the watch list from here — the
 * holdings live only in the /my-portfolio localStorage, which this
 * page has no way to read. The user gets a call-to-action pointing
 * back to that page when the sync is stale.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertOctagon,
  AlertTriangle,
  Bell,
  BellOff,
  ExternalLink,
  Loader2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { useT } from "@/lib/i18n";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useRiskNotifications } from "@/hooks/use-portfolio-risks";
import { SEVERITY_UI } from "@/lib/portfolio-risk/signals";
import type { RiskSeverity } from "@/lib/portfolio-risk/signals";
import type {
  MinRiskSeverity,
  RiskWatch,
} from "@/lib/portfolio-risk/store";

// ---------------------------------------------------------------------------
// Server-list hook (local to this panel)
//
// The /my-portfolio Risks tab holds the master `useRiskNotifications`
// state but has no reason to keep the server watch list itself in
// memory — that tab already knows the exact tickers because the local
// holdings are the source of truth. Here on /bot we don't have that
// side data, so we fetch the server list directly on mount and expose
// a small delete-and-refetch API.
// ---------------------------------------------------------------------------

function useRiskWatches() {
  const [watches, setWatches] = React.useState<RiskWatch[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio/risks/watches", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { watches: RiskWatch[] };
      setWatches(body.watches);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const removeOne = React.useCallback(
    async (ticker: string): Promise<void> => {
      const res = await fetch(
        `/api/portfolio/risks/watches?ticker=${encodeURIComponent(ticker)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setWatches((prev) => prev.filter((w) => w.ticker !== ticker));
    },
    [],
  );

  return { watches, loading, error, reload: load, removeOne };
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function PortfolioRiskAlertsPanel() {
  const t = useT();
  const router = useRouter();

  const {
    enabled,
    minSeverity,
    setEnabled,
    setMinSeverity,
    lastSyncedAt,
    lastReport,
  } = useRiskNotifications();

  const { watches, loading, error, reload, removeOne } = useRiskWatches();

  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{
    tone: "ok" | "err";
    text: string;
  } | null>(null);

  // Sort by severity (critical first) then by newest-first for tie-breaks
  // so users see the loudest rows first. Weakest surface goes last.
  const orderedWatches = React.useMemo(() => {
    const sevRank: Record<RiskSeverity | "unknown", number> = {
      critical: 0,
      high: 1,
      medium: 2,
      unknown: 3,
    };
    return watches.slice().sort((a, b) => {
      const ra = sevRank[a.lastSeverity ?? "unknown"];
      const rb = sevRank[b.lastSeverity ?? "unknown"];
      if (ra !== rb) return ra - rb;
      return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
    });
  }, [watches]);

  const pager = usePagination(orderedWatches, 10);

  const handleToggle = async () => {
    setBusy("toggle");
    setMessage(null);
    try {
      await setEnabled(!enabled);
      setMessage({
        tone: "ok",
        text: enabled
          ? t("bot.riskAlerts.disabled")
          : t("bot.riskAlerts.enabled"),
      });
      await reload();
    } catch (e) {
      setMessage({
        tone: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (ticker: string) => {
    if (
      !confirm(
        t("bot.riskAlerts.confirmRemove", { ticker }),
      )
    ) {
      return;
    }
    setBusy(`remove:${ticker}`);
    setMessage(null);
    try {
      await removeOne(ticker);
      setMessage({
        tone: "ok",
        text: t("bot.riskAlerts.removed", { ticker }),
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

  const openManage = () => {
    // The Risks tab drives sync from the imported holdings and is where
    // users add / prune the watch list at scale. Deep-link so a single
    // click from here gets them there.
    router.push("/my-portfolio?tab=risks");
  };

  const summaryChip = enabled ? (
    <span className="chip chip-bull text-[0.65rem]">
      <Bell className="h-3 w-3" />
      {t("bot.riskAlerts.on")}
    </span>
  ) : (
    <span className="chip chip-neu text-[0.65rem]">
      <BellOff className="h-3 w-3" />
      {t("bot.riskAlerts.off")}
    </span>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <AlertOctagon className="h-4 w-4 text-primary" />
          <CardTitle>{t("bot.riskAlerts.title")}</CardTitle>
          {summaryChip}
          <span className="text-xs text-muted-foreground">
            {t("bot.riskAlerts.subtitle")}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status + toggle row */}
        <div
          className={cn(
            "rounded-lg border p-3 flex flex-col gap-2",
            enabled
              ? "border-primary/40 bg-primary/5"
              : "border-border bg-card/40",
          )}
        >
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                enabled
                  ? "bg-primary/15 text-primary"
                  : "bg-muted/40 text-muted-foreground",
              )}
            >
              {enabled ? (
                <Bell className="h-4 w-4" />
              ) : (
                <BellOff className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {t("bot.riskAlerts.statusTitle")}
              </p>
              <p className="text-xs text-muted-foreground">
                {enabled
                  ? t("bot.riskAlerts.statusBodyOn", {
                      n: watches.length,
                    })
                  : t("bot.riskAlerts.statusBodyOff")}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              disabled={busy === "toggle"}
              onClick={handleToggle}
              className={cn(
                "shrink-0 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                enabled
                  ? "border-primary/40 bg-primary text-primary-foreground hover:bg-primary/90"
                  : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary",
                "disabled:opacity-60 disabled:cursor-not-allowed",
              )}
            >
              {busy === "toggle" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : enabled ? (
                <BellOff className="h-3 w-3" />
              ) : (
                <Bell className="h-3 w-3" />
              )}
              {enabled
                ? t("bot.riskAlerts.turnOff")
                : t("bot.riskAlerts.turnOn")}
            </button>
          </div>

          {/* Sensitivity picker — only relevant when notifications are on */}
          {enabled && (
            <div className="flex flex-wrap items-center gap-2 pl-11">
              <span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
                {t("bot.riskAlerts.severity")}
              </span>
              {(["high", "critical"] as MinRiskSeverity[]).map((s) => {
                const active = minSeverity === s;
                // Only two chip variants are globally defined
                // (`chip-bull`, `chip-bear`, `chip-neu`); the "high"
                // active tone is built inline against the warning
                // palette so it matches the other warning surfaces on
                // this page.
                const activeCls =
                  s === "critical"
                    ? "chip-bear"
                    : "border-warning/40 bg-warning/10 text-warning";
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setMinSeverity(s)}
                    className={cn(
                      "chip text-[0.65rem]",
                      active
                        ? activeCls
                        : "chip-neu opacity-70 hover:opacity-100",
                    )}
                    title={t(`bot.riskAlerts.severity.${s}.tip`)}
                  >
                    {s === "critical" ? (
                      <AlertOctagon className="h-3 w-3" />
                    ) : (
                      <AlertTriangle className="h-3 w-3" />
                    )}
                    {t(`bot.riskAlerts.severity.${s}`)}
                  </button>
                );
              })}
              {lastSyncedAt && (
                <span className="text-[0.65rem] text-muted-foreground ml-auto">
                  {t("bot.riskAlerts.lastSync", {
                    when: relativeTime(lastSyncedAt),
                  })}
                  {lastReport
                    ? ` · ${t("bot.riskAlerts.lastReport", {
                        total: lastReport.total,
                        added: lastReport.added,
                        removed: lastReport.removed,
                      })}`
                    : ""}
                </span>
              )}
            </div>
          )}
        </div>

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
        {error && <p className="text-xs text-danger">{error}</p>}

        {/* Monitored tickers */}
        <div>
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <span className="metric-label">
              {t("bot.riskAlerts.watches.title")} ({watches.length})
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={openManage}
                className="h-7 text-xs"
              >
                <ExternalLink className="h-3 w-3 mr-1" />
                {t("bot.riskAlerts.watches.manage")}
              </Button>
            </div>
          </div>
          <p className="text-[0.7rem] text-muted-foreground mb-2">
            {t("bot.riskAlerts.watches.hint")}
          </p>
          {loading ? (
            <p className="text-xs text-muted-foreground">…</p>
          ) : watches.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {enabled ? (
                <>
                  {t("bot.riskAlerts.watches.emptyOnBefore")}{" "}
                  <button
                    type="button"
                    onClick={openManage}
                    className="text-primary hover:underline"
                  >
                    {t("bot.riskAlerts.watches.emptyOnLink")}
                  </button>{" "}
                  {t("bot.riskAlerts.watches.emptyOnAfter")}
                </>
              ) : (
                t("bot.riskAlerts.watches.emptyOff")
              )}
            </p>
          ) : (
            <>
              <ul className="space-y-1.5">
                {pager.visibleItems.map((w) => (
                  <RiskWatchRow
                    key={w.ticker}
                    watch={w}
                    busy={busy}
                    onRemove={() => handleRemove(w.ticker)}
                  />
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
                className="mt-2"
                label={t("pager.watches")}
              />
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function RiskWatchRow({
  watch,
  busy,
  onRemove,
}: {
  watch: RiskWatch;
  busy: string | null;
  onRemove: () => void;
}) {
  const t = useT();
  const removeBusy = busy === `remove:${watch.ticker}`;
  const sev = watch.lastSeverity;
  const sevUi = sev ? SEVERITY_UI[sev] : null;

  return (
    <li className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-xs flex-wrap">
      <span className="chip chip-neu font-mono">{watch.ticker}</span>

      {sev && sevUi ? (
        <span
          className={cn(
            "chip text-[0.65rem] border",
            sevUi.chip,
          )}
          title={t(`bot.riskAlerts.severity.${sev}.tip`)}
        >
          {sev === "critical" ? (
            <AlertOctagon className="h-3 w-3" />
          ) : sev === "high" ? (
            <AlertTriangle className="h-3 w-3" />
          ) : (
            // `medium` gets the same triangle glyph but the sevUi
            // palette above already tints it amber so it reads as
            // distinct from `high` at a glance.
            <AlertTriangle className="h-3 w-3" />
          )}
          {t(`bot.riskAlerts.rowSeverity.${sev}`)}
        </span>
      ) : (
        <span className="chip chip-neu text-[0.65rem]" title={t("bot.riskAlerts.rowSeverity.none.tip")}>
          {t("bot.riskAlerts.rowSeverity.none")}
        </span>
      )}

      <span className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
        {t("bot.riskAlerts.rowMinSev", {
          sev: t(`bot.riskAlerts.severity.${watch.minSeverity}`),
        })}
      </span>

      {watch.lastNotifiedAt ? (
        <span className="text-[0.65rem] text-muted-foreground">
          {t("bot.riskAlerts.lastNotified", {
            when: relativeTime(watch.lastNotifiedAt),
          })}
        </span>
      ) : (
        <span className="text-[0.65rem] text-muted-foreground italic">
          {t("bot.riskAlerts.neverNotified")}
        </span>
      )}

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={onRemove}
          disabled={removeBusy}
          title={t("bot.riskAlerts.remove", { ticker: watch.ticker })}
          aria-label={t("bot.riskAlerts.remove", { ticker: watch.ticker })}
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
