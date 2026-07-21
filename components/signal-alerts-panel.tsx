"use client";

/**
 * Central listing of per-ticker Technical Signal, 6-Signal Resonance,
 * Master Verdict, and per-segment Sector 6-Signal Resonance alerts.
 *
 * The alert configurators on the Technical Signal card, the 6-Signal
 * Resonance card, the Master Verdict card, and the Sector Resonance
 * section each write to their own SQLite table (via
 * `use-technical-alerts`, `use-resonance-alerts`, `use-master-alerts`,
 * and `use-sector-resonance-alerts`). They render inline on each
 * per-ticker / per-segment page, which is great for turning an alert
 * on — but it means users can't answer "which subscriptions do I
 * currently have?" without visiting each page one by one.
 *
 * This panel is the missing dashboard: every configured alert appears
 * in a compact row with its digest time, on-change gate, and last-fired
 * timestamp, plus row-level Test / Delete / Open-in-analysis buttons.
 * Delete pops the row from the store immediately (optimistic via the
 * shared cache); Open navigates to the Signal page (technical/resonance),
 * the Overview page (master), or the segment detail page (sector) with
 * the correct context pre-selected so the user can update the config.
 *
 * Renders as one Card containing four subsections rather than four
 * separate Cards so the visual density stays consistent with the
 * surrounding portfolio / stock / news panels below it on the /bot page.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  Bell,
  Clock,
  ExternalLink,
  Gauge,
  Loader2,
  Send,
  Target,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { useT } from "@/lib/i18n";
import { useUi } from "@/lib/state";
import { relativeTime } from "@/lib/format";
import { useTechnicalAlerts } from "@/hooks/use-technical-alerts";
import { useResonanceAlerts } from "@/hooks/use-resonance-alerts";
import { useMasterAlerts } from "@/hooks/use-master-alerts";
import { useSectorResonanceAlerts } from "@/hooks/use-sector-resonance-alerts";
import { useSectorTechnicalAlerts } from "@/hooks/use-sector-technical-alerts";
import { findSegment } from "@/lib/segments";
import { cn } from "@/lib/utils";
import type {
  AlertStrength,
  TechnicalAlert,
} from "@/lib/technical-watch/store";
import type {
  ResonanceAlert,
  ResonanceAlertStrength,
} from "@/lib/resonance-watch/store";
import type { MasterAlert } from "@/lib/master-watch/store";
import type {
  SectorResonanceAlert,
  SectorResonanceAlertStrength,
} from "@/lib/sector-resonance-watch/store";
import type { SectorTechnicalAlert } from "@/lib/sector-technical-watch/store";
import type { NotifyFrequency } from "@/lib/alert-frequency";

type AlertKind =
  | "technical"
  | "resonance"
  | "master"
  | "sector-resonance"
  | "sector-technical";

// ---------------------------------------------------------------------------
// Strength copy — matches the labels used in the individual alert popovers
// so the /bot summary reads the same as the configurator the user just left.
// ---------------------------------------------------------------------------

type Translator = (
  key: string,
  params?: Record<string, string | number>,
) => string;

/**
 * Compact chip that surfaces the per-rule frequency ('always' | 'daily'
 * | 'once') when the user has narrowed it below the default. The
 * default `always` mode is rendered as `null` so the row stays clean
 * for the common case — chips are for CONFIGURED overrides, not
 * defaults. The `once` chip also flips its style to warning when the
 * alert has already fired to remind the user they need to re-save to
 * re-arm.
 */
function frequencyChipFor(
  frequency: NotifyFrequency | undefined,
  firedOnce: boolean,
  t: Translator,
): React.ReactNode | null {
  if (!frequency || frequency === "always") return null;
  const label = t(`alert.frequency.${frequency}`);
  const hint = t(`alert.frequency.${frequency}.hint`);
  const styleName =
    frequency === "once" && firedOnce
      ? "chip chip-neu text-[0.65rem] border border-warning/40 bg-warning/10 text-warning"
      : "chip chip-neu text-[0.65rem] border border-primary/30 bg-primary/5 text-primary";
  return (
    <span
      className={styleName}
      title={hint}
    >
      {label}
    </span>
  );
}

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

// Master Verdict shares the AlertStrength enum with Technical, so the
// same three localised labels apply. Kept as its own function (rather
// than aliasing to `techStrengthLabel`) to keep the call site readable —
// `masterStrengthLabel(a.minStrength, t)` telegraphs which subsystem the
// row belongs to without the reader having to consult the import list.
function masterStrengthLabel(s: AlertStrength, t: Translator): string {
  return techStrengthLabel(s, t);
}

// Sector resonance uses the same three-value strength enum as the
// per-ticker resonance store, so we reuse its label helper.
function sectorResStrengthLabel(
  s: SectorResonanceAlertStrength,
  t: Translator,
): string {
  return resStrengthLabel(s, t);
}

// Sector Technical shares the AlertStrength enum with the per-ticker
// technical store (all / buy_sell / strong_only), so the same three
// localised labels apply. Kept as a named alias for readability at
// the call site.
function sectorTechStrengthLabel(s: AlertStrength, t: Translator): string {
  return techStrengthLabel(s, t);
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/**
 * Scope filter for the panel. Split into two families because users
 * kept confusing per-ticker alerts (Master / Technical / Resonance)
 * with market/sector alerts (Sector Resonance) — they live in the
 * same store but are semantically very different subscriptions.
 *
 *  - `"ticker"` : Master Verdict + Technical Signal + 6-Signal Resonance
 *                 (each attached to a single symbol)
 *  - `"market"` : Sector 6-Signal Resonance (attached to a market
 *                 segment / proxy ETF, not a specific ticker)
 *
 * Defaults to `"ticker"` for backward compat with the previous
 * "one big Signal tab" layout.
 */
export type SignalAlertsScope = "ticker" | "market";

export function SignalAlertsPanel({
  scope = "ticker",
}: {
  scope?: SignalAlertsScope;
} = {}) {
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
  const {
    alerts: masterAlerts,
    loading: masterLoading,
    remove: removeMaster,
    test: testMaster,
  } = useMasterAlerts();
  const {
    alerts: sectorResAlerts,
    loading: sectorResLoading,
    remove: removeSectorResonance,
    test: testSectorResonance,
  } = useSectorResonanceAlerts();
  const {
    alerts: sectorTechAlerts,
    loading: sectorTechLoading,
    remove: removeSectorTechnical,
    test: testSectorTechnical,
  } = useSectorTechnicalAlerts();

  // 10 per page matches the notifications tables on the /bot dashboard.
  // Alert-configurations for these channels are usually modest (a few
  // dozen subscriptions max), so this typically resolves to a single
  // page and `hideWhenSingle` on the control keeps the footer out of
  // the way.
  const techPager = usePagination(techAlerts, 10);
  const resPager = usePagination(resAlerts, 10);
  const masterPager = usePagination(masterAlerts, 10);
  const sectorResPager = usePagination(sectorResAlerts, 10);
  const sectorTechPager = usePagination(sectorTechAlerts, 10);

  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{
    tone: "ok" | "err";
    text: string;
  } | null>(null);

  const openInAnalysis = React.useCallback(
    (ticker: string, kind: AlertKind) => {
      setTicker(ticker);
      // Master Verdict lives on /overview (the fused-signal card that
      // powers it renders there). Technical + Resonance both live on
      // the consolidated Technical Signal page (/signal). Routing
      // straight to the surface that owns the configurator saves the
      // user an extra hop.
      router.push(kind === "master" ? "/overview" : "/signal");
    },
    [router, setTicker],
  );

  /**
   * Sector rows deep-link to `/market/segments/[id]` rather than
   * any per-ticker page — the configurator that owns the
   * subscription lives on the segment detail page, and the sticky
   * sidebar ticker is irrelevant here.
   */
  const openSegment = React.useCallback(
    (segmentId: string) => {
      router.push(`/market/segments/${segmentId}`);
    },
    [router],
  );

  const handleRemove = async (
    kind: AlertKind,
    key: string,
    label: string,
    fn: (key: string) => Promise<void>,
  ) => {
    const confirmLabel =
      kind === "technical"
        ? t("bot.signalAlerts.confirmRemoveTechnical", { ticker: label })
        : kind === "resonance"
          ? t("bot.signalAlerts.confirmRemoveResonance", { ticker: label })
          : kind === "master"
            ? t("bot.signalAlerts.confirmRemoveMaster", { ticker: label })
            : kind === "sector-technical"
              ? t("bot.signalAlerts.confirmRemoveSectorTechnical", {
                  segment: label,
                })
              : t("bot.signalAlerts.confirmRemoveSectorResonance", {
                  segment: label,
                });
    if (!confirm(confirmLabel)) return;
    const id = `${kind}:remove:${key}`;
    setBusy(id);
    setMessage(null);
    try {
      await fn(key);
      setMessage({
        tone: "ok",
        text: t("bot.signalAlerts.removed", { ticker: label }),
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
    key: string,
    label: string,
    fn: (key: string) => Promise<{ ok: boolean; detail?: string }>,
  ) => {
    const id = `${kind}:test:${key}`;
    setBusy(id);
    setMessage(null);
    try {
      const res = await fn(key);
      setMessage({
        tone: res.ok ? "ok" : "err",
        text: res.detail ?? t("bot.signalAlerts.testSent", { ticker: label }),
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

  // Each scope only actually needs a subset of the alert hooks; the
  // "wrong-scope" ones still fire off their initial fetch but are cheap
  // (single localStorage read + JSON parse). Not worth conditional-hook
  // gymnastics — keeps the render tree simpler and ESLint happy.
  const loading =
    scope === "market"
      ? sectorResLoading || sectorTechLoading
      : techLoading || resLoading || masterLoading;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <Bell className="h-4 w-4 text-primary" />
          <CardTitle>
            {scope === "market"
              ? t("bot.signalAlerts.market.title")
              : t("bot.signalAlerts.ticker.title")}
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {scope === "market"
              ? t("bot.signalAlerts.market.subtitle")
              : t("bot.signalAlerts.ticker.subtitle")}
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

        {/*
          Display order deliberately runs top-down from the most
          holistic signal to the most granular:
            1. Master Verdict  — fused mood + fundamentals + technical
            2. Technical Signal — indicator-weighted buy/sell score
            3. 6-Signal Resonance — six TDX-style momentum checks
          This mirrors how users read the analysis pages themselves
          (Overview → Signal), so the /bot dashboard reinforces the
          same mental model.

          All three are gated behind `scope === "ticker"` — the
          Market Signal tab (`scope === "market"`) skips straight to
          the Sector Resonance subsection below.
        */}
        {scope === "ticker" && (<>
        <AlertsSubsection
          icon={<Gauge className="h-3.5 w-3.5 text-primary" />}
          title={t("bot.signalAlerts.master.title")}
          hint={t("bot.signalAlerts.master.hint")}
          count={masterAlerts.length}
          loading={loading && masterAlerts.length === 0}
          pager={masterPager}
          emptyHint={
            <>
              {t("bot.signalAlerts.master.emptyBefore")}{" "}
              <button
                type="button"
                onClick={() => router.push("/overview")}
                className="text-primary hover:underline"
              >
                {t("bot.signalAlerts.master.emptyLink")}
              </button>{" "}
              {t("bot.signalAlerts.master.emptyAfter")}
            </>
          }
        >
          {masterPager.visibleItems.map((a) => (
            <MasterAlertRow
              key={a.ticker}
              alert={a}
              busy={busy}
              onOpen={() => openInAnalysis(a.ticker, "master")}
              onRemove={() =>
                handleRemove("master", a.ticker, a.ticker, removeMaster)
              }
              onTest={() =>
                handleTest("master", a.ticker, a.ticker, testMaster)
              }
            />
          ))}
        </AlertsSubsection>

        <AlertsSubsection
          icon={<Target className="h-3.5 w-3.5 text-primary" />}
          title={t("bot.signalAlerts.technical.title")}
          hint={t("bot.signalAlerts.technical.hint")}
          count={techAlerts.length}
          loading={loading && techAlerts.length === 0}
          pager={techPager}
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
          {techPager.visibleItems.map((a) => (
            <TechnicalAlertRow
              key={a.ticker}
              alert={a}
              busy={busy}
              onOpen={() => openInAnalysis(a.ticker, "technical")}
              onRemove={() =>
                handleRemove(
                  "technical",
                  a.ticker,
                  a.ticker,
                  removeTechnical,
                )
              }
              onTest={() =>
                handleTest(
                  "technical",
                  a.ticker,
                  a.ticker,
                  testTechnical,
                )
              }
            />
          ))}
        </AlertsSubsection>

        <AlertsSubsection
          icon={<Activity className="h-3.5 w-3.5 text-primary" />}
          title={t("bot.signalAlerts.resonance.title")}
          hint={t("bot.signalAlerts.resonance.hint")}
          count={resAlerts.length}
          loading={loading && resAlerts.length === 0}
          pager={resPager}
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
          {resPager.visibleItems.map((a) => (
            <ResonanceAlertRow
              key={a.ticker}
              alert={a}
              busy={busy}
              onOpen={() => openInAnalysis(a.ticker, "resonance")}
              onRemove={() =>
                handleRemove(
                  "resonance",
                  a.ticker,
                  a.ticker,
                  removeResonance,
                )
              }
              onTest={() =>
                handleTest(
                  "resonance",
                  a.ticker,
                  a.ticker,
                  testResonance,
                )
              }
            />
          ))}
        </AlertsSubsection>
        </>)}

        {/*
          Market-scoped subsections. Display order mirrors the ticker
          scope above (Technical first, then Resonance) so users learn
          one mental model regardless of which tab they're on.

          Both are keyed by `segmentId` in their own SQLite tables
          (`sector_technical_alerts`, `sector_resonance_alerts`) rather
          than by ticker, and share the segment slug → proxy-ETF
          resolution at the engine layer. The bell on each segment
          detail page writes here; the /bot Market tab reads back.
        */}
        {scope === "market" && (<>
        <AlertsSubsection
          icon={<Target className="h-3.5 w-3.5 text-primary" />}
          title={t("bot.signalAlerts.sectorTechnical.title")}
          hint={t("bot.signalAlerts.sectorTechnical.hint")}
          count={sectorTechAlerts.length}
          loading={loading && sectorTechAlerts.length === 0}
          pager={sectorTechPager}
          emptyHint={
            <>
              {t("bot.signalAlerts.sectorTechnical.emptyBefore")}{" "}
              <button
                type="button"
                onClick={() => router.push("/market/segments")}
                className="text-primary hover:underline"
              >
                {t("bot.signalAlerts.sectorTechnical.emptyLink")}
              </button>{" "}
              {t("bot.signalAlerts.sectorTechnical.emptyAfter")}
            </>
          }
        >
          {sectorTechPager.visibleItems.map((a) => {
            const seg = findSegment(a.segmentId);
            const displayName = seg?.name ?? a.segmentId;
            const proxyTicker = seg?.proxyEtf ?? "?";
            return (
              <SectorTechnicalAlertRow
                key={a.segmentId}
                alert={a}
                displayName={displayName}
                proxyTicker={proxyTicker}
                busy={busy}
                onOpen={() => openSegment(a.segmentId)}
                onRemove={() =>
                  handleRemove(
                    "sector-technical",
                    a.segmentId,
                    displayName,
                    removeSectorTechnical,
                  )
                }
                onTest={() =>
                  handleTest(
                    "sector-technical",
                    a.segmentId,
                    displayName,
                    testSectorTechnical,
                  )
                }
              />
            );
          })}
        </AlertsSubsection>

        <AlertsSubsection
          icon={<Activity className="h-3.5 w-3.5 text-primary" />}
          title={t("bot.signalAlerts.sectorResonance.title")}
          hint={t("bot.signalAlerts.sectorResonance.hint")}
          count={sectorResAlerts.length}
          loading={loading && sectorResAlerts.length === 0}
          pager={sectorResPager}
          emptyHint={
            <>
              {t("bot.signalAlerts.sectorResonance.emptyBefore")}{" "}
              <button
                type="button"
                onClick={() => router.push("/market/segments")}
                className="text-primary hover:underline"
              >
                {t("bot.signalAlerts.sectorResonance.emptyLink")}
              </button>{" "}
              {t("bot.signalAlerts.sectorResonance.emptyAfter")}
            </>
          }
        >
          {sectorResPager.visibleItems.map((a) => {
            const seg = findSegment(a.segmentId);
            // Fall back to the raw slug when a segment definition
            // has been removed from `SEGMENTS[]` since the row was
            // written — better than a blank chip.
            const displayName = seg?.name ?? a.segmentId;
            const proxyTicker = seg?.proxyEtf ?? "?";
            return (
              <SectorResonanceAlertRow
                key={a.segmentId}
                alert={a}
                displayName={displayName}
                proxyTicker={proxyTicker}
                busy={busy}
                onOpen={() => openSegment(a.segmentId)}
                onRemove={() =>
                  handleRemove(
                    "sector-resonance",
                    a.segmentId,
                    displayName,
                    removeSectorResonance,
                  )
                }
                onTest={() =>
                  handleTest(
                    "sector-resonance",
                    a.segmentId,
                    displayName,
                    testSectorResonance,
                  )
                }
              />
            );
          })}
        </AlertsSubsection>
        </>)}
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
  pager,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  count: number;
  loading: boolean;
  emptyHint: React.ReactNode;
  children: React.ReactNode;
  /**
   * Optional pagination state. When present the footer is rendered below
   * the list; when omitted the subsection is un-paginated (used for
   * short, always-small lists elsewhere in the future).
   */
  pager?: {
    page: number;
    pageCount: number;
    total: number;
    range: readonly [number, number];
    setPage: (n: number) => void;
    pageSize: number;
    setPageSize: (n: number) => void;
  };
}) {
  const t = useT();
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
        <>
          <ul className="space-y-1.5">{children}</ul>
          {pager && (
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
              label={t("pager.alerts")}
            />
          )}
        </>
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
  frequencyChip,
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
  frequencyChip?: React.ReactNode | null;
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
      {frequencyChip}
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
  const frequencyChip = frequencyChipFor(
    alert.frequency,
    Boolean(alert.lastChangeNotifiedAt),
    t,
  );
  return (
    <AlertRowShell
      ticker={alert.ticker}
      digestChip={digestChip}
      onChangeChip={onChangeChip}
      strengthChip={strengthChip}
      frequencyChip={frequencyChip}
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
  const frequencyChip = frequencyChipFor(
    alert.frequency,
    Boolean(alert.lastChangeNotifiedAt),
    t,
  );
  return (
    <AlertRowShell
      ticker={alert.ticker}
      digestChip={digestChip}
      onChangeChip={onChangeChip}
      strengthChip={strengthChip}
      frequencyChip={frequencyChip}
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

/**
 * Sector 6-Signal Resonance row.
 *
 * Keyed by segment slug, but the visible chip shows the segment's
 * human name (e.g. "Artificial Intelligence") with the proxy ETF
 * ticker rendered as a small secondary chip. That gives users the
 * subscription-level identity ("what did I ask to be alerted on?")
 * in the primary slot, and the measurement-level identity ("what's
 * the resonance actually computed against?") in the secondary
 * slot, so nobody's left wondering where the numbers come from.
 */
function SectorResonanceAlertRow({
  alert,
  displayName,
  proxyTicker,
  busy,
  onOpen,
  onTest,
  onRemove,
}: {
  alert: SectorResonanceAlert;
  displayName: string;
  proxyTicker: string;
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
  // Compose strength label + proxy tag into a single trailing chip
  // so `AlertRowShell` still lays out cleanly regardless of screen
  // width. The proxy tag is intentionally small — it's context,
  // not the primary identity.
  const strengthChip = (
    <span className="text-[0.65rem] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
      {alert.notifyOnChange ? (
        <span>{sectorResStrengthLabel(alert.minStrength, t)}</span>
      ) : null}
      <span className="chip chip-neu font-mono normal-case tracking-normal">
        {t("bot.signalAlerts.sectorResonance.proxyTag", {
          proxy: proxyTicker,
        })}
      </span>
    </span>
  );
  const frequencyChip = frequencyChipFor(
    alert.frequency,
    Boolean(alert.lastChangeNotifiedAt),
    t,
  );
  return (
    <AlertRowShell
      ticker={displayName}
      digestChip={digestChip}
      onChangeChip={onChangeChip}
      strengthChip={strengthChip}
      frequencyChip={frequencyChip}
      lastNotified={alert.lastNotifiedAt}
      onOpen={onOpen}
      onTest={onTest}
      onRemove={onRemove}
      busy={busy}
      testId={`sector-resonance:test:${alert.segmentId}`}
      removeId={`sector-resonance:remove:${alert.segmentId}`}
      openTitle={t("bot.signalAlerts.openSector", { segment: displayName })}
      testTitle={t("bot.signalAlerts.test", { ticker: displayName })}
      removeTitle={t("bot.signalAlerts.remove", { ticker: displayName })}
    />
  );
}

/**
 * Sector Technical Signal row.
 *
 * Structural twin of `SectorResonanceAlertRow` above — same
 * segment-name-as-primary + proxy-ETF-as-secondary layout so both
 * market-scoped subsections read the same at a glance. The only
 * difference is the strength enum (`buy_sell` vs `trigger_only`)
 * and the test-id prefix that keeps concurrent test/remove clicks
 * on different channels from stepping on each other's `busy` state.
 */
function SectorTechnicalAlertRow({
  alert,
  displayName,
  proxyTicker,
  busy,
  onOpen,
  onTest,
  onRemove,
}: {
  alert: SectorTechnicalAlert;
  displayName: string;
  proxyTicker: string;
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
  // Same trailing-chip composition as the sector-resonance row.
  const strengthChip = (
    <span className="text-[0.65rem] uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
      {alert.notifyOnChange ? (
        <span>{sectorTechStrengthLabel(alert.minStrength, t)}</span>
      ) : null}
      <span className="chip chip-neu font-mono normal-case tracking-normal">
        {t("bot.signalAlerts.sectorResonance.proxyTag", {
          proxy: proxyTicker,
        })}
      </span>
    </span>
  );
  const frequencyChip = frequencyChipFor(
    alert.frequency,
    Boolean(alert.lastChangeNotifiedAt),
    t,
  );
  return (
    <AlertRowShell
      ticker={displayName}
      digestChip={digestChip}
      onChangeChip={onChangeChip}
      strengthChip={strengthChip}
      frequencyChip={frequencyChip}
      lastNotified={alert.lastNotifiedAt}
      onOpen={onOpen}
      onTest={onTest}
      onRemove={onRemove}
      busy={busy}
      testId={`sector-technical:test:${alert.segmentId}`}
      removeId={`sector-technical:remove:${alert.segmentId}`}
      openTitle={t("bot.signalAlerts.openSector", { segment: displayName })}
      testTitle={t("bot.signalAlerts.test", { ticker: displayName })}
      removeTitle={t("bot.signalAlerts.remove", { ticker: displayName })}
    />
  );
}

function MasterAlertRow({
  alert,
  busy,
  onOpen,
  onTest,
  onRemove,
}: {
  alert: MasterAlert;
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
      {masterStrengthLabel(alert.minStrength, t)}
    </span>
  ) : null;
  const frequencyChip = frequencyChipFor(
    alert.frequency,
    Boolean(alert.lastChangeNotifiedAt),
    t,
  );
  return (
    <AlertRowShell
      ticker={alert.ticker}
      digestChip={digestChip}
      onChangeChip={onChangeChip}
      strengthChip={strengthChip}
      frequencyChip={frequencyChip}
      lastNotified={alert.lastNotifiedAt}
      onOpen={onOpen}
      onTest={onTest}
      onRemove={onRemove}
      busy={busy}
      testId={`master:test:${alert.ticker}`}
      removeId={`master:remove:${alert.ticker}`}
      openTitle={t("bot.signalAlerts.openMaster", { ticker: alert.ticker })}
      testTitle={t("bot.signalAlerts.test", { ticker: alert.ticker })}
      removeTitle={t("bot.signalAlerts.remove", { ticker: alert.ticker })}
    />
  );
}
