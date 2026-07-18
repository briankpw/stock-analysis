"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageIntro } from "@/components/page-intro";
import { KeyTerms } from "@/components/key-terms";
import { TermTip } from "@/components/term-tip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ErrorBanner, LoadingPage } from "@/components/loading";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import { useBundle } from "@/hooks/use-bundle";
import { useUi, useLocale } from "@/lib/state";
import { useT, translateSignalValue } from "@/lib/i18n";
import {
  fmtCurrency,
  fmtNumber,
  fmtSigned,
  fmtSignedPercent,
  relativeTime,
} from "@/lib/format";
import type { Valuation, Side } from "@/lib/paper-trading";
import type {
  EnrichedTrade,
  PortfolioAnalytics,
  SymbolPerformance,
} from "@/lib/paper-analytics";
import type { Reason, Recommendation } from "@/lib/target-recommender";
import { cn } from "@/lib/utils";

type Trigger = {
  symbol: string;
  reason: "stop-loss" | "take-profit";
  level: number;
  price: number;
  tradeId: number;
};

type PaperResponse = {
  valuation: Valuation;
  trades: EnrichedTrade[];
  analytics: { portfolio: PortfolioAnalytics; perSymbol: SymbolPerformance[] };
  triggered: Trigger[];
};

function usePaper() {
  const [data, setData] = React.useState<PaperResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/paper${nonce > 0 ? `?_=${nonce}` : ""}`,
          { cache: "no-store" },
        );
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(body?.error ?? `HTTP ${res.status}`);
        else setData(body as PaperResponse);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { data, loading, error, reload };
}

// ---------------------------------------------------------------------------
// Order form (now supports optional bracket SL/TP for buys)
// ---------------------------------------------------------------------------

/**
 * Preset SL/TP ratios keyed to a rough "how much of a swing can this
 * position take before I bail" heuristic — reward ≥ 2× the risk side
 * (William O'Neil CANSLIM: cap losses at 7-8%, target ~20-25% gains).
 *
 * On the order form these anchor to the *entry price* the user typed
 * (a fresh buy has no avg cost yet). On the position editor they
 * anchor to the persisted avg_cost.
 */
const PRESETS = [
  { key: "conservative", slPct: 0.03, tpPct: 0.06 },
  { key: "moderate",     slPct: 0.05, tpPct: 0.15 },
  { key: "aggressive",   slPct: 0.08, tpPct: 0.25 },
] as const;

type PresetKey = (typeof PRESETS)[number]["key"];

function OrderForm({ onSubmitted }: { onSubmitted: () => void }) {
  const ticker = useUi((s) => s.ticker);
  const { data: bundle } = useBundle();
  const [side, setSide] = React.useState<Side>("buy");
  const [shares, setShares] = React.useState("10");
  const [price, setPrice] = React.useState("");
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Bracket-order fields. Only submitted on `side === "buy"`. Empty
  // string = "don't attach" (the buy goes through with no guard, same
  // as the pre-bracket behaviour).
  const [attachBracket, setAttachBracket] = React.useState(false);
  const [stopLoss, setStopLoss] = React.useState("");
  const [takeProfit, setTakeProfit] = React.useState("");
  const t = useT();

  const suggestedPrice = bundle?.quote.price ?? null;
  React.useEffect(() => {
    if (suggestedPrice !== null && !price) setPrice(String(suggestedPrice));
  }, [suggestedPrice, price]);

  const applyPreset = (key: PresetKey) => {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) return;
    const basis = Number(price);
    if (!Number.isFinite(basis) || basis <= 0) {
      setError(t("paper.bracket.needPrice"));
      return;
    }
    setStopLoss((basis * (1 - preset.slPct)).toFixed(2));
    setTakeProfit((basis * (1 + preset.tpPct)).toFixed(2));
    setAttachBracket(true);
    setError(null);
  };

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      // Parse bracket levels only for buys where the user attached them.
      // Empty string in an input means "no guard on that side".
      const parseLevel = (raw: string): number | null | "invalid" => {
        const s = raw.trim();
        if (!s) return null;
        const n = Number(s);
        if (!Number.isFinite(n) || n <= 0) return "invalid";
        return n;
      };
      const bracketPayload: {
        stopLoss?: number | null;
        takeProfit?: number | null;
      } = {};
      if (side === "buy" && attachBracket) {
        const sl = parseLevel(stopLoss);
        const tp = parseLevel(takeProfit);
        if (sl === "invalid" || tp === "invalid") {
          throw new Error(t("paper.bracket.invalid"));
        }
        // At least one guard has to be non-null to make sense of the
        // "attach bracket" checkbox. Otherwise the toggle was left on
        // by mistake — collapse to a plain order silently.
        if (sl !== null) bracketPayload.stopLoss = sl;
        if (tp !== null) bracketPayload.takeProfit = tp;
      }
      const res = await fetch("/api/paper", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: ticker,
          side,
          shares: Number(shares),
          price: Number(price),
          note: note || undefined,
          ...bracketPayload,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setNote("");
      setAttachBracket(false);
      setStopLoss("");
      setTakeProfit("");
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const priceNum = Number(price);
  const priceValid = Number.isFinite(priceNum) && priceNum > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("paper.card.placeOrder")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant={side === "buy" ? "success" : "outline"}
            onClick={() => setSide("buy")}
          >
            {t("paper.side.buy")}
          </Button>
          <Button
            variant={side === "sell" ? "danger" : "outline"}
            onClick={() => {
              setSide("sell");
              setAttachBracket(false);
            }}
          >
            {t("paper.side.sell")}
          </Button>
        </div>
        <div>
          <label className="metric-label">{t("paper.field.symbol")}</label>
          <input
            value={ticker}
            readOnly
            className="mt-1 w-full h-9 rounded-md border border-border bg-muted/40 px-3 text-sm cursor-not-allowed"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="metric-label">{t("paper.field.shares")}</label>
            <input
              type="number"
              min="0"
              step="1"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              className="mt-1 w-full h-9 rounded-md border border-border bg-card px-3 text-sm tabular-nums"
            />
          </div>
          <div>
            <label className="metric-label">{t("paper.field.price")}</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="mt-1 w-full h-9 rounded-md border border-border bg-card px-3 text-sm tabular-nums"
            />
          </div>
        </div>
        <div>
          <label className="metric-label">{t("paper.field.note")}</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("paper.field.notePlaceholder")}
            className="mt-1 w-full h-9 rounded-md border border-border bg-card px-3 text-sm"
          />
        </div>

        {/* Bracket order — visible only for buys. Wrapped in a labelled
            fieldset so screen readers announce "Attach protective levels"
            as the group heading. */}
        {side === "buy" && (
          <fieldset className="border border-border/60 rounded-md p-2 space-y-2">
            <legend className="metric-label px-1">
              <TermTip term="Bracket Order">
                {t("paper.bracket.title")}
              </TermTip>
            </legend>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={attachBracket}
                onChange={(e) => setAttachBracket(e.target.checked)}
                className="rounded border-border"
              />
              <span>{t("paper.bracket.attach")}</span>
            </label>
            <div
              className={cn(
                "space-y-2",
                !attachBracket && "opacity-50 pointer-events-none",
              )}
            >
              <div className="grid grid-cols-3 gap-1.5">
                {PRESETS.map((p) => {
                  const slPctLabel = `-${(p.slPct * 100).toFixed(0)}%`;
                  const tpPctLabel = `+${(p.tpPct * 100).toFixed(0)}%`;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => applyPreset(p.key)}
                      disabled={!priceValid}
                      className="rounded-md border border-border bg-card px-2 py-1.5 text-[0.7rem] hover:bg-muted/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-left"
                    >
                      <div className="font-semibold text-foreground">
                        {t(`paper.targets.preset.${p.key}`)}
                      </div>
                      <div className="text-danger tabular-nums">{slPctLabel}</div>
                      <div className="text-success tabular-nums">{tpPctLabel}</div>
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="metric-label text-[0.65rem]">
                    <TermTip term="Stop-Loss">
                      {t("paper.targets.stopLoss")}
                    </TermTip>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={stopLoss}
                    onChange={(e) => setStopLoss(e.target.value)}
                    placeholder={t("paper.targets.off")}
                    className="mt-1 w-full h-8 rounded-md border border-border bg-card px-2 text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="metric-label text-[0.65rem]">
                    <TermTip term="Take-Profit">
                      {t("paper.targets.takeProfit")}
                    </TermTip>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={takeProfit}
                    onChange={(e) => setTakeProfit(e.target.value)}
                    placeholder={t("paper.targets.off")}
                    className="mt-1 w-full h-8 rounded-md border border-border bg-card px-2 text-xs tabular-nums"
                  />
                </div>
              </div>
              <p className="text-[0.65rem] text-muted-foreground leading-relaxed">
                {t("paper.bracket.hint")}
              </p>
            </div>
          </fieldset>
        )}

        {error && <p className="text-xs text-danger">{error}</p>}
        <Button
          onClick={submit}
          disabled={submitting || !shares || !price}
          variant={side === "buy" ? "success" : "danger"}
          className="w-full"
        >
          {submitting
            ? t("paper.submitting")
            : t("paper.submit", {
                side:
                  side === "buy"
                    ? t("paper.side.buy")
                    : t("paper.side.sell"),
                n: shares || 0,
                ticker,
              })}
        </Button>
        <p className="text-[0.7rem] text-muted-foreground text-center">
          {t("paper.disclaimer")}
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Smart-recommender + preset panel (unchanged from the previous
// TargetsEditor — extracted verbatim so the file stays readable)
// ---------------------------------------------------------------------------

function ReasonBullet({ reason }: { reason: Reason }) {
  const t = useT();
  const locale = useLocale();
  const params = React.useMemo<Record<string, string | number>>(() => {
    const raw = reason.values ?? {};
    const out: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(raw)) {
      out[k] = typeof v === "number" || typeof v === "string" ? v : String(v);
    }
    if (typeof out.label === "string" && out.label.length > 0) {
      out.label = translateSignalValue("trend", out.label, locale);
    }
    return out;
  }, [reason, locale]);
  return <li>{t(`paper.targets.${reason.key}`, params)}</li>;
}

function SmartRecommendation({
  position,
  rec,
  loading,
  error,
  onFetch,
  onApply,
}: {
  position: Valuation["positions"][number];
  rec: Recommendation | null;
  loading: boolean;
  error: string | null;
  onFetch: () => void;
  onApply: () => void;
}) {
  const t = useT();

  if (!rec && !loading && !error) {
    return (
      <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {t("paper.targets.smart.title")}
            </p>
            <p className="text-[0.7rem] text-muted-foreground mt-0.5">
              {t("paper.targets.smart.blurb")}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={onFetch}>
            {t("paper.targets.smart.suggest")}
          </Button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
        <p className="text-sm text-muted-foreground">
          {t("paper.targets.smart.analyzing")}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
        <p className="text-sm text-warning font-semibold">
          {t("paper.targets.smart.errorTitle")}
        </p>
        <p className="text-xs text-muted-foreground mt-1">{error}</p>
        <div className="mt-2">
          <Button size="sm" variant="ghost" onClick={onFetch}>
            {t("common.retry")}
          </Button>
        </div>
      </div>
    );
  }

  if (!rec) return null;

  const slPctLabel = `-${(rec.stopLossPct * 100).toFixed(1)}%`;
  const tpPctLabel = `+${(rec.takeProfitPct * 100).toFixed(1)}%`;

  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground flex items-center gap-2">
            {t("paper.targets.smart.title")}
            {rec.fallback && (
              <span className="chip text-warning border-warning/40 bg-warning/10 text-[0.65rem]">
                {t("paper.targets.smart.fallbackBadge")}
              </span>
            )}
          </p>
          <p className="text-[0.7rem] text-muted-foreground mt-0.5">
            {t("paper.targets.smart.forSymbol", {
              symbol: position.symbol,
              avg: fmtCurrency(position.avgCost),
            })}
          </p>
        </div>
        <Button size="sm" onClick={onApply}>
          {t("paper.targets.smart.apply")}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs tabular-nums">
        <div className="rounded-md border border-danger/30 bg-danger/5 p-2">
          <p className="metric-label text-[0.65rem]">
            <TermTip term="Stop-Loss">{t("paper.targets.stopLoss")}</TermTip>
          </p>
          <p className="text-sm font-semibold text-danger">
            {fmtCurrency(rec.stopLoss)}
          </p>
          <p className="text-[0.65rem] text-danger/80">{slPctLabel}</p>
        </div>
        <div className="rounded-md border border-success/30 bg-success/5 p-2">
          <p className="metric-label text-[0.65rem]">
            <TermTip term="Take-Profit">
              {t("paper.targets.takeProfit")}
            </TermTip>
          </p>
          <p className="text-sm font-semibold text-success">
            {fmtCurrency(rec.takeProfit)}
          </p>
          <p className="text-[0.65rem] text-success/80">{tpPctLabel}</p>
        </div>
        <div className="rounded-md border border-border bg-card p-2">
          <p className="metric-label text-[0.65rem]">
            <TermTip term="Risk-Reward">
              {t("paper.targets.smart.riskReward")}
            </TermTip>
          </p>
          <p className="text-sm font-semibold">
            1 : {rec.riskReward.toFixed(2)}
          </p>
          <p className="text-[0.65rem] text-muted-foreground">
            {t("paper.targets.smart.rrHint")}
          </p>
        </div>
      </div>

      {rec.reasons.length > 0 && (
        <div>
          <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground font-semibold">
            {t("paper.targets.smart.whyHeading")}
          </p>
          <ul className="text-[0.7rem] text-muted-foreground mt-0.5 space-y-0.5 list-disc list-inside leading-relaxed">
            {rec.reasons.map((r, i) => (
              <ReasonBullet key={`${r.key}-${i}`} reason={r} />
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-3 items-center text-[0.65rem] text-muted-foreground">
        <button
          type="button"
          onClick={onFetch}
          className="underline hover:text-foreground transition-colors"
        >
          {t("paper.targets.smart.refresh")}
        </button>
        <span>·</span>
        <span>{t("paper.targets.smart.disclaimer")}</span>
      </div>
    </div>
  );
}

type RecommendResponse =
  | {
      ok: true;
      symbol: string;
      avgCost: number;
      currentPrice: number | null;
      hasPosition: boolean;
      recommendation: Recommendation;
    }
  | { ok: false; error: string };

function TargetsEditor({
  position,
  onSaved,
  onCancel,
}: {
  position: Valuation["positions"][number];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [stopLoss, setStopLoss] = React.useState(
    position.stopLoss === null ? "" : String(position.stopLoss),
  );
  const [takeProfit, setTakeProfit] = React.useState(
    position.takeProfit === null ? "" : String(position.takeProfit),
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [rec, setRec] = React.useState<Recommendation | null>(null);
  const [recLoading, setRecLoading] = React.useState(false);
  const [recError, setRecError] = React.useState<string | null>(null);

  const loadRecommendation = React.useCallback(async () => {
    setRecError(null);
    setRecLoading(true);
    try {
      const res = await fetch(
        `/api/paper/recommend?symbol=${encodeURIComponent(position.symbol)}`,
        { cache: "no-store" },
      );
      const body = (await res.json()) as RecommendResponse;
      if (!body.ok) {
        setRecError(body.error || `HTTP ${res.status}`);
        setRec(null);
        return;
      }
      setRec(body.recommendation);
    } catch (e) {
      setRecError(e instanceof Error ? e.message : String(e));
      setRec(null);
    } finally {
      setRecLoading(false);
    }
  }, [position.symbol]);

  const applyRecommendation = () => {
    if (!rec) return;
    setStopLoss(rec.stopLoss.toFixed(2));
    setTakeProfit(rec.takeProfit.toFixed(2));
    setError(null);
  };

  const applyPreset = (key: PresetKey) => {
    const preset = PRESETS.find((p) => p.key === key);
    if (!preset) return;
    const basis = position.avgCost;
    setStopLoss((basis * (1 - preset.slPct)).toFixed(2));
    setTakeProfit((basis * (1 + preset.tpPct)).toFixed(2));
    setError(null);
  };

  const parseLevel = (raw: string): number | null | "invalid" => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0) return "invalid";
    return n;
  };

  const save = async () => {
    const sl = parseLevel(stopLoss);
    const tp = parseLevel(takeProfit);
    if (sl === "invalid" || tp === "invalid") {
      setError(t("paper.targets.invalid"));
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/paper", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: position.symbol,
          stopLoss: sl,
          takeProfit: tp,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 rounded-md border border-border bg-card/50 p-3 space-y-3">
      <SmartRecommendation
        position={position}
        rec={rec}
        loading={recLoading}
        error={recError}
        onFetch={loadRecommendation}
        onApply={applyRecommendation}
      />

      <div>
        <p className="metric-label mb-1.5">{t("paper.targets.presetsLabel")}</p>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((p) => {
            const slPrice = position.avgCost * (1 - p.slPct);
            const tpPrice = position.avgCost * (1 + p.tpPct);
            const slPctLabel = `-${(p.slPct * 100).toFixed(0)}%`;
            const tpPctLabel = `+${(p.tpPct * 100).toFixed(0)}%`;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p.key)}
                className="rounded-md border border-border bg-card px-3 py-2 text-left text-xs hover:bg-muted/40 transition-colors"
              >
                <div className="font-semibold text-foreground">
                  {t(`paper.targets.preset.${p.key}`)}
                </div>
                <div className="text-danger tabular-nums">
                  {slPctLabel} · {fmtCurrency(slPrice)}
                </div>
                <div className="text-success tabular-nums">
                  {tpPctLabel} · {fmtCurrency(tpPrice)}
                </div>
              </button>
            );
          })}
        </div>
        <p className="text-[0.7rem] text-muted-foreground mt-1.5">
          {t("paper.targets.presetsHint", { avg: fmtCurrency(position.avgCost) })}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 pt-1">
        <div>
          <label className="metric-label">
            <TermTip term="Stop-Loss">{t("paper.targets.stopLoss")}</TermTip>
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            placeholder={t("paper.targets.off")}
            className="mt-1 w-full h-9 rounded-md border border-border bg-card px-3 text-sm tabular-nums"
          />
        </div>
        <div>
          <label className="metric-label">
            <TermTip term="Take-Profit">{t("paper.targets.takeProfit")}</TermTip>
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={takeProfit}
            onChange={(e) => setTakeProfit(e.target.value)}
            placeholder={t("paper.targets.off")}
            className="mt-1 w-full h-9 rounded-md border border-border bg-card px-3 text-sm tabular-nums"
          />
        </div>
      </div>
      <p className="text-[0.7rem] text-muted-foreground">{t("paper.targets.hint")}</p>
      {error && <p className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? t("paper.submitting") : t("common.save")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

function PositionRow({
  position,
  onChanged,
}: {
  position: Valuation["positions"][number];
  onChanged: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = React.useState(false);
  const pnlPos = (position.unrealised ?? 0) >= 0;
  const hasTargets = position.stopLoss !== null || position.takeProfit !== null;

  return (
    <li className="glass rounded-lg p-3">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="font-semibold">{position.symbol}</span>
          <AddToWatchlistButton symbol={position.symbol} />
          <span className="text-sm text-muted-foreground">
            {fmtNumber(position.shares, 0)} @{" "}
            <TermTip term="Avg Cost">{t("paper.avg")}</TermTip>{" "}
            {fmtCurrency(position.avgCost)}
          </span>
        </div>
        <div className="text-right text-sm tabular-nums">
          <div>
            {t("paper.last")}{" "}
            {position.last === null ? "—" : fmtCurrency(position.last)}
          </div>
          <div className={cn("font-semibold", pnlPos ? "text-success" : "text-danger")}>
            {position.unrealised === null
              ? "—"
              : fmtSigned(position.unrealised)}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {position.stopLoss !== null && (
          <span className="chip chip-bear">
            <TermTip term="Stop-Loss">{t("paper.targets.slChip")}</TermTip>{" "}
            {fmtCurrency(position.stopLoss)}
          </span>
        )}
        {position.takeProfit !== null && (
          <span className="chip chip-bull">
            <TermTip term="Take-Profit">{t("paper.targets.tpChip")}</TermTip>{" "}
            {fmtCurrency(position.takeProfit)}
          </span>
        )}
        {!hasTargets && (
          <span className="text-muted-foreground">{t("paper.targets.none")}</span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => setEditing((v) => !v)}
        >
          {editing
            ? t("common.cancel")
            : hasTargets
              ? t("paper.targets.edit")
              : t("paper.targets.set")}
        </Button>
      </div>

      {editing && (
        <TargetsEditor
          position={position}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </li>
  );
}

function PortfolioCard({
  valuation,
  analytics,
  onReset,
  onChanged,
}: {
  valuation: Valuation;
  analytics: PortfolioAnalytics;
  onReset: () => void;
  onChanged: () => void;
}) {
  const pnlPos = valuation.totalPnl >= 0;
  const realizedPos = analytics.totalRealizedPnl >= 0;
  const t = useT();

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <CardTitle>{t("paper.card.portfolio")}</CardTitle>
        <Button variant="outline" size="sm" onClick={onReset}>
          {t("common.reset")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <p className="metric-label">{t("paper.stat.totalValue")}</p>
            <p className="metric-value">{fmtCurrency(valuation.totalValue)}</p>
          </div>
          <div>
            <p className="metric-label">{t("paper.stat.cash")}</p>
            <p className="metric-value">{fmtCurrency(valuation.cash)}</p>
          </div>
          <div>
            <p className="metric-label">
              <TermTip term="Market Value">
                {t("paper.stat.positionsValue")}
              </TermTip>
            </p>
            <p className="text-lg font-semibold tabular-nums">
              {fmtCurrency(valuation.marketValue)}
            </p>
          </div>
          <div>
            <p className="metric-label">
              <TermTip term="Unrealised P&L">
                {t("paper.stat.totalPnl")}
              </TermTip>
            </p>
            <p
              className={cn(
                "text-lg font-semibold tabular-nums",
                pnlPos ? "text-success" : "text-danger",
              )}
            >
              {fmtSigned(valuation.totalPnl)}{" "}
              <span className="text-xs">
                ({fmtSignedPercent(valuation.totalPnlPct)})
              </span>
            </p>
          </div>
          <div>
            <p className="metric-label">
              <TermTip term="Realised P&L">
                {t("paper.stat.realizedPnl")}
              </TermTip>
            </p>
            <p
              className={cn(
                "text-lg font-semibold tabular-nums",
                realizedPos ? "text-success" : "text-danger",
              )}
            >
              {fmtSigned(analytics.totalRealizedPnl)}
            </p>
          </div>
          <div>
            <p className="metric-label">{t("paper.stat.commissions")}</p>
            <p className="text-lg font-semibold tabular-nums text-muted-foreground">
              {fmtCurrency(analytics.totalCommissions)}
            </p>
          </div>
        </div>

        {valuation.positions.length > 0 && (
          <div>
            <p className="metric-label mb-2 mt-4">
              <TermTip term="Position">{t("paper.openPositions")}</TermTip>
            </p>
            <ul className="space-y-2">
              {valuation.positions.map((p) => (
                <PositionRow
                  key={p.symbol}
                  position={p}
                  onChanged={onChanged}
                />
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Analytics card — portfolio-wide performance
// ---------------------------------------------------------------------------

function AnalyticsCard({ analytics }: { analytics: PortfolioAnalytics }) {
  const t = useT();
  if (analytics.sellCount === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("paper.card.analytics")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t("paper.analytics.emptyHint")}
          </p>
        </CardContent>
      </Card>
    );
  }

  const winRateStr =
    analytics.winRate === null
      ? "—"
      : `${(analytics.winRate * 100).toFixed(1)}%`;
  const payoffStr =
    analytics.payoffRatio === null
      ? "—"
      : `${analytics.payoffRatio.toFixed(2)} : 1`;
  // Reconstruct the raw win count from the ratio for the caption
  // (we don't ship it separately in `analytics.portfolio` to keep the
  // JSON payload small — winRate + sellCount is all the info needed).
  const winCount =
    analytics.winRate === null
      ? 0
      : Math.round(analytics.winRate * analytics.sellCount);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <TermTip term="Realised P&L">{t("paper.card.analytics")}</TermTip>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="metric-label">
              <TermTip term="Win Rate">
                {t("paper.analytics.winRate")}
              </TermTip>
            </p>
            <p className="text-lg font-semibold tabular-nums">{winRateStr}</p>
            <p className="text-[0.65rem] text-muted-foreground">
              {t("paper.analytics.winsOverSells", {
                wins: winCount,
                total: analytics.sellCount,
              })}
            </p>
          </div>
          <div>
            <p className="metric-label">
              <TermTip term="Avg Win">
                {t("paper.analytics.avgWin")}
              </TermTip>
            </p>
            <p className="text-lg font-semibold tabular-nums text-success">
              {analytics.averageWin === null
                ? "—"
                : fmtSigned(analytics.averageWin)}
            </p>
          </div>
          <div>
            <p className="metric-label">
              <TermTip term="Avg Loss">
                {t("paper.analytics.avgLoss")}
              </TermTip>
            </p>
            <p className="text-lg font-semibold tabular-nums text-danger">
              {analytics.averageLoss === null
                ? "—"
                : fmtSigned(analytics.averageLoss)}
            </p>
          </div>
          <div>
            <p className="metric-label">
              <TermTip term="Payoff Ratio">
                {t("paper.analytics.payoff")}
              </TermTip>
            </p>
            <p className="text-lg font-semibold tabular-nums">{payoffStr}</p>
            <p className="text-[0.65rem] text-muted-foreground">
              {t("paper.analytics.payoffHint")}
            </p>
          </div>
        </div>

        {(analytics.bestSymbol || analytics.worstSymbol) && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            {analytics.bestSymbol && (
              <div className="rounded-md border border-success/30 bg-success/5 p-3">
                <p className="text-[0.65rem] uppercase tracking-wider text-success font-semibold">
                  {t("paper.analytics.bestSymbol")}
                </p>
                <p className="text-lg font-bold text-success">
                  {analytics.bestSymbol.symbol}
                </p>
                <p className="text-sm tabular-nums">
                  {fmtSigned(analytics.bestSymbol.realizedPnl)}
                </p>
              </div>
            )}
            {analytics.worstSymbol &&
              analytics.worstSymbol.symbol !== analytics.bestSymbol?.symbol && (
                <div className="rounded-md border border-danger/30 bg-danger/5 p-3">
                  <p className="text-[0.65rem] uppercase tracking-wider text-danger font-semibold">
                    {t("paper.analytics.worstSymbol")}
                  </p>
                  <p className="text-lg font-bold text-danger">
                    {analytics.worstSymbol.symbol}
                  </p>
                  <p className="text-sm tabular-nums">
                    {fmtSigned(analytics.worstSymbol.realizedPnl)}
                  </p>
                </div>
              )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[0.7rem] text-muted-foreground">
          <span>
            {t("paper.analytics.tradesTotal", { n: analytics.tradeCount })}
          </span>
          <span>
            {t("paper.analytics.symbolsTraded", { n: analytics.symbolCount })}
          </span>
          <span>
            {t("paper.analytics.openSymbols", { n: analytics.openSymbolCount })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Per-symbol earnings table — "how much did I make on each stock?"
// ---------------------------------------------------------------------------

type SymbolSortKey =
  | "symbol"
  | "realizedPnl"
  | "roundTrips"
  | "winCount"
  | "openShares"
  | "lastTradeAt";

function SortHeader({
  active,
  dir,
  onClick,
  children,
  numeric,
}: {
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  children: React.ReactNode;
  numeric?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 hover:text-foreground transition-colors",
        numeric && "justify-end w-full",
      )}
    >
      <span>{children}</span>
      {active ? (
        dir === "asc" ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}

function PerSymbolTable({ rows }: { rows: SymbolPerformance[] }) {
  const t = useT();
  const [sortKey, setSortKey] = React.useState<SymbolSortKey>("realizedPnl");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");

  const sorted = React.useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      let av: number | string, bv: number | string;
      switch (sortKey) {
        case "symbol":
          av = a.symbol;
          bv = b.symbol;
          break;
        case "roundTrips":
          av = a.roundTrips;
          bv = b.roundTrips;
          break;
        case "winCount":
          av = a.winCount;
          bv = b.winCount;
          break;
        case "openShares":
          av = a.openShares;
          bv = b.openShares;
          break;
        case "lastTradeAt":
          av = a.lastTradeAt;
          bv = b.lastTradeAt;
          break;
        default:
          av = a.realizedPnl;
          bv = b.realizedPnl;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const toggle = (k: SymbolSortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "symbol" ? "asc" : "desc");
    }
  };

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("paper.card.perSymbol")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t("paper.perSymbol.empty")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("paper.card.perSymbol")}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[0.65rem] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="text-left px-3 sm:px-4 py-2 font-medium">
                  <SortHeader
                    active={sortKey === "symbol"}
                    dir={sortDir}
                    onClick={() => toggle("symbol")}
                  >
                    {t("paper.perSymbol.col.symbol")}
                  </SortHeader>
                </th>
                <th className="text-right px-3 py-2 font-medium">
                  <SortHeader
                    active={sortKey === "realizedPnl"}
                    dir={sortDir}
                    onClick={() => toggle("realizedPnl")}
                    numeric
                  >
                    {t("paper.perSymbol.col.realizedPnl")}
                  </SortHeader>
                </th>
                <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">
                  <SortHeader
                    active={sortKey === "roundTrips"}
                    dir={sortDir}
                    onClick={() => toggle("roundTrips")}
                    numeric
                  >
                    {t("paper.perSymbol.col.roundTrips")}
                  </SortHeader>
                </th>
                <th className="text-right px-3 py-2 font-medium hidden md:table-cell">
                  <SortHeader
                    active={sortKey === "winCount"}
                    dir={sortDir}
                    onClick={() => toggle("winCount")}
                    numeric
                  >
                    {t("paper.perSymbol.col.wl")}
                  </SortHeader>
                </th>
                <th className="text-right px-3 py-2 font-medium hidden md:table-cell">
                  {t("paper.perSymbol.col.bestWorst")}
                </th>
                <th className="text-right px-3 py-2 font-medium">
                  <SortHeader
                    active={sortKey === "openShares"}
                    dir={sortDir}
                    onClick={() => toggle("openShares")}
                    numeric
                  >
                    {t("paper.perSymbol.col.open")}
                  </SortHeader>
                </th>
                <th className="text-right px-3 py-2 font-medium hidden lg:table-cell">
                  <SortHeader
                    active={sortKey === "lastTradeAt"}
                    dir={sortDir}
                    onClick={() => toggle("lastTradeAt")}
                    numeric
                  >
                    {t("paper.perSymbol.col.last")}
                  </SortHeader>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const pos = row.realizedPnl > 0;
                const neg = row.realizedPnl < 0;
                return (
                  <tr
                    key={row.symbol}
                    className="border-b border-border/60 hover:bg-muted/30"
                  >
                    <td className="px-3 sm:px-4 py-2 font-semibold">
                      <div className="flex items-center gap-2">
                        <span>{row.symbol}</span>
                        <AddToWatchlistButton symbol={row.symbol} />
                      </div>
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular-nums font-semibold",
                        pos && "text-success",
                        neg && "text-danger",
                      )}
                    >
                      {fmtSigned(row.realizedPnl)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums hidden sm:table-cell text-muted-foreground">
                      {row.roundTrips}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell">
                      <span className="text-success">{row.winCount}</span>
                      <span className="text-muted-foreground"> / </span>
                      <span className="text-danger">{row.lossCount}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums hidden md:table-cell text-[0.7rem]">
                      {row.bestTrade === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          <span className="text-success">
                            {fmtSigned(row.bestTrade)}
                          </span>
                          {row.worstTrade !== null &&
                            row.worstTrade !== row.bestTrade && (
                              <>
                                <span className="text-muted-foreground"> / </span>
                                <span className="text-danger">
                                  {fmtSigned(row.worstTrade)}
                                </span>
                              </>
                            )}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.openShares > 0 ? (
                        <span>
                          {fmtNumber(row.openShares, 0)}
                          {row.openAvgCost !== null && (
                            <span className="text-muted-foreground text-[0.65rem]">
                              {" "}
                              @ {fmtCurrency(row.openAvgCost)}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-[0.7rem]">
                          {t("paper.perSymbol.flat")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums hidden lg:table-cell text-[0.7rem] text-muted-foreground">
                      {relativeTime(row.lastTradeAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Trades table (sortable, filterable)
// ---------------------------------------------------------------------------

type TradeSortKey = "createdAt" | "symbol" | "side" | "notional" | "realizedPnl";

/**
 * Content of the expanded row under a clicked trade.
 *
 * Two shapes depending on whether the symbol still has an open position:
 *
 * 1. **Open position** — render the full `TargetsEditor` so the user can
 *    tweak SL/TP without leaving the trade log. Also shows a compact
 *    "you own N @ $X, currently $Y" summary above the editor so it's
 *    clear which position the edits will apply to.
 * 2. **Flat** (nothing left of that symbol) — SL/TP is meaningless
 *    because there's no live position to protect. We show a friendly
 *    "you no longer hold …" hint plus a "Trade this again" shortcut
 *    that sets the sidebar ticker so the user can buy back in with one
 *    click.
 */
function TradeExpandedPanel({
  trade,
  openPosition,
  onSaved,
  onOpenTicker,
}: {
  trade: EnrichedTrade;
  openPosition: Valuation["positions"][number] | null;
  onSaved: () => void;
  onOpenTicker: () => void;
}) {
  const t = useT();
  if (openPosition) {
    const unrealPos = (openPosition.unrealised ?? 0) >= 0;
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
          <span className="font-semibold text-foreground text-sm">
            {openPosition.symbol}
          </span>
          <span className="text-muted-foreground">
            {t("paper.trades.expanded.open", {
              n: fmtNumber(openPosition.shares, 0),
              avg: fmtCurrency(openPosition.avgCost),
            })}
          </span>
          {openPosition.last !== null && (
            <span className="text-muted-foreground">
              · {t("paper.last")} {fmtCurrency(openPosition.last)}
            </span>
          )}
          {openPosition.unrealised !== null && (
            <span
              className={cn(
                "font-semibold tabular-nums",
                unrealPos ? "text-success" : "text-danger",
              )}
            >
              {fmtSigned(openPosition.unrealised)}
            </span>
          )}
        </div>
        <TargetsEditor
          position={openPosition}
          onSaved={onSaved}
          onCancel={onSaved}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm">
      <div>
        <p className="font-semibold">
          {t("paper.trades.expanded.flatTitle", { symbol: trade.symbol })}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t("paper.trades.expanded.flatHint")}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onOpenTicker}>
        {t("paper.trades.expanded.tradeAgain", { symbol: trade.symbol })}
      </Button>
    </div>
  );
}

function TradesTable({
  trades,
  positions,
  onChanged,
}: {
  trades: EnrichedTrade[];
  /** Currently-open positions from the valuation — used so a row click can
   *  either drop a live SL/TP editor for the symbol, or show a "you're
   *  flat" hint if the trade is from a position that's been fully closed. */
  positions: Valuation["positions"];
  /** Called after a successful SL/TP save so the parent can refetch. */
  onChanged: () => void;
}) {
  const t = useT();
  const setTicker = useUi((s) => s.setTicker);
  const [sortKey, setSortKey] = React.useState<TradeSortKey>("createdAt");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");
  const [symbolFilter, setSymbolFilter] = React.useState("");
  const [sideFilter, setSideFilter] = React.useState<"all" | "buy" | "sell">(
    "all",
  );
  const [pnlFilter, setPnlFilter] = React.useState<"all" | "wins" | "losses">(
    "all",
  );
  // Only one row expanded at a time — keeps the table readable and
  // avoids racing edits on multiple TargetsEditor instances.
  const [expandedId, setExpandedId] = React.useState<number | null>(null);

  const availableSymbols = React.useMemo(() => {
    const s = new Set<string>();
    for (const tr of trades) s.add(tr.symbol);
    return [...s].sort();
  }, [trades]);

  const positionBySymbol = React.useMemo(() => {
    const m = new Map<string, Valuation["positions"][number]>();
    for (const p of positions) m.set(p.symbol, p);
    return m;
  }, [positions]);

  // Number of visible <th> cells — used by the expanded row's colSpan
  // so the inline editor spans the full table width regardless of
  // which breakpoint is active. We render eight <th> here; the editor
  // renders inside `<td colSpan={8}>`.
  const columnCount = 8;

  const filtered = React.useMemo(() => {
    return trades.filter((tr) => {
      if (symbolFilter && tr.symbol !== symbolFilter) return false;
      if (sideFilter !== "all" && tr.side !== sideFilter) return false;
      if (pnlFilter === "wins" && !(tr.realizedPnl !== null && tr.realizedPnl > 0))
        return false;
      if (pnlFilter === "losses" && !(tr.realizedPnl !== null && tr.realizedPnl < 0))
        return false;
      return true;
    });
  }, [trades, symbolFilter, sideFilter, pnlFilter]);

  const sorted = React.useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let av: number | string, bv: number | string;
      switch (sortKey) {
        case "symbol":
          av = a.symbol;
          bv = b.symbol;
          break;
        case "side":
          av = a.side;
          bv = b.side;
          break;
        case "notional":
          av = a.shares * a.price;
          bv = b.shares * b.price;
          break;
        case "realizedPnl":
          // Push nulls (buys) to the end regardless of direction so the
          // list stays readable when sorted by P&L.
          av = a.realizedPnl ?? (sortDir === "asc" ? Infinity : -Infinity);
          bv = b.realizedPnl ?? (sortDir === "asc" ? Infinity : -Infinity);
          break;
        default:
          av = a.createdAt;
          bv = b.createdAt;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const toggle = (k: TradeSortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "symbol" || k === "side" ? "asc" : "desc");
    }
  };

  const clearFilters = () => {
    setSymbolFilter("");
    setSideFilter("all");
    setPnlFilter("all");
  };
  const anyFilter =
    symbolFilter !== "" || sideFilter !== "all" || pnlFilter !== "all";

  if (trades.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("paper.card.trades")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t("paper.noTrades")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <CardTitle>{t("paper.card.trades")}</CardTitle>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <select
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value)}
            className="h-8 rounded-md border border-border bg-card px-2 text-xs"
            aria-label={t("paper.trades.filter.symbol")}
          >
            <option value="">{t("paper.trades.filter.allSymbols")}</option>
            {availableSymbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={sideFilter}
            onChange={(e) =>
              setSideFilter(e.target.value as "all" | "buy" | "sell")
            }
            className="h-8 rounded-md border border-border bg-card px-2 text-xs"
            aria-label={t("paper.trades.filter.side")}
          >
            <option value="all">{t("paper.trades.filter.allSides")}</option>
            <option value="buy">{t("paper.side.buy")}</option>
            <option value="sell">{t("paper.side.sell")}</option>
          </select>
          <select
            value={pnlFilter}
            onChange={(e) =>
              setPnlFilter(e.target.value as "all" | "wins" | "losses")
            }
            className="h-8 rounded-md border border-border bg-card px-2 text-xs"
            aria-label={t("paper.trades.filter.pnl")}
          >
            <option value="all">{t("paper.trades.filter.allPnl")}</option>
            <option value="wins">{t("paper.trades.filter.winsOnly")}</option>
            <option value="losses">
              {t("paper.trades.filter.lossesOnly")}
            </option>
          </select>
          {anyFilter && (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              {t("paper.trades.filter.clear")}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[0.65rem] uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="text-left px-3 sm:px-4 py-2 font-medium">
                  <SortHeader
                    active={sortKey === "createdAt"}
                    dir={sortDir}
                    onClick={() => toggle("createdAt")}
                  >
                    {t("paper.trades.col.when")}
                  </SortHeader>
                </th>
                <th className="text-left px-3 py-2 font-medium">
                  <SortHeader
                    active={sortKey === "symbol"}
                    dir={sortDir}
                    onClick={() => toggle("symbol")}
                  >
                    {t("paper.trades.col.symbol")}
                  </SortHeader>
                </th>
                <th className="text-left px-3 py-2 font-medium">
                  <SortHeader
                    active={sortKey === "side"}
                    dir={sortDir}
                    onClick={() => toggle("side")}
                  >
                    {t("paper.trades.col.side")}
                  </SortHeader>
                </th>
                <th className="text-right px-3 py-2 font-medium">
                  {t("paper.trades.col.shares")}
                </th>
                <th className="text-right px-3 py-2 font-medium">
                  {t("paper.trades.col.price")}
                </th>
                <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">
                  <SortHeader
                    active={sortKey === "notional"}
                    dir={sortDir}
                    onClick={() => toggle("notional")}
                    numeric
                  >
                    {t("paper.trades.col.notional")}
                  </SortHeader>
                </th>
                <th className="text-right px-3 py-2 font-medium">
                  <SortHeader
                    active={sortKey === "realizedPnl"}
                    dir={sortDir}
                    onClick={() => toggle("realizedPnl")}
                    numeric
                  >
                    {t("paper.trades.col.pnl")}
                  </SortHeader>
                </th>
                <th className="text-left px-3 py-2 font-medium hidden md:table-cell">
                  {t("paper.trades.col.note")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((trade) => {
                const notional = trade.shares * trade.price;
                const pnlPos =
                  trade.realizedPnl !== null && trade.realizedPnl > 0;
                const pnlNeg =
                  trade.realizedPnl !== null && trade.realizedPnl < 0;
                const isExpanded = expandedId === trade.id;
                const openPos = positionBySymbol.get(trade.symbol) ?? null;
                const hasTargets =
                  openPos !== null &&
                  (openPos.stopLoss !== null || openPos.takeProfit !== null);
                const toggleRow = () =>
                  setExpandedId((cur) => (cur === trade.id ? null : trade.id));
                return (
                  <React.Fragment key={trade.id}>
                    <tr
                      className={cn(
                        "border-b border-border/60 hover:bg-muted/30 cursor-pointer",
                        isExpanded && "bg-muted/40",
                      )}
                      onClick={toggleRow}
                      aria-expanded={isExpanded}
                      title={t("paper.trades.expandHint")}
                    >
                      <td className="px-3 sm:px-4 py-2 text-[0.7rem] text-muted-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          {isExpanded ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                          {relativeTime(trade.createdAt)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div
                          className="flex items-center gap-1.5"
                          // Stop the row click from firing when the user
                          // interacts with the watchlist toggle.
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="font-semibold">{trade.symbol}</span>
                          <AddToWatchlistButton symbol={trade.symbol} />
                          {hasTargets && (
                            <span
                              className="chip text-[0.55rem] px-1.5 py-0"
                              title={t("paper.trades.hasTargets")}
                            >
                              SL/TP
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "chip text-[0.65rem]",
                            trade.side === "buy" ? "chip-bull" : "chip-bear",
                          )}
                        >
                          {trade.side === "buy"
                            ? t("paper.side.buy")
                            : t("paper.side.sell")}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmtNumber(trade.shares, 0)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmtCurrency(trade.price)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums hidden sm:table-cell">
                        {fmtCurrency(notional)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right tabular-nums font-semibold",
                          pnlPos && "text-success",
                          pnlNeg && "text-danger",
                        )}
                      >
                        {trade.realizedPnl === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            {fmtSigned(trade.realizedPnl)}
                            {trade.realizedPnlPct !== null && (
                              <span className="text-[0.65rem] block font-normal opacity-80">
                                {fmtSignedPercent(trade.realizedPnlPct)}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[0.7rem] text-muted-foreground hidden md:table-cell max-w-[16rem] truncate">
                        {trade.note ?? ""}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-border/60 bg-muted/20">
                        <td colSpan={columnCount} className="px-3 sm:px-4 py-3">
                          <TradeExpandedPanel
                            trade={trade}
                            openPosition={openPos}
                            onSaved={() => {
                              setExpandedId(null);
                              onChanged();
                            }}
                            onOpenTicker={() => {
                              setTicker(trade.symbol);
                              setExpandedId(null);
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {sorted.length === 0 && anyFilter && (
          <div className="p-4 text-center text-sm text-muted-foreground">
            {t("paper.trades.filter.noMatch")}
          </div>
        )}
        <div className="px-4 py-2 border-t border-border text-[0.7rem] text-muted-foreground text-right">
          {t("paper.trades.showing", {
            visible: sorted.length,
            total: trades.length,
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Trigger banner + page
// ---------------------------------------------------------------------------

function TriggerBanner({ triggered }: { triggered: Trigger[] }) {
  const t = useT();
  if (triggered.length === 0) return null;
  return (
    <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3 space-y-1 animate-fade-in">
      <p className="text-sm font-semibold text-warning">
        {t("paper.targets.triggeredTitle", { n: triggered.length })}
      </p>
      <ul className="text-xs text-muted-foreground space-y-1">
        {triggered.map((tr) => (
          <li key={`${tr.symbol}:${tr.tradeId}`} className="tabular-nums">
            <span className="font-semibold text-foreground">{tr.symbol}</span>{" "}
            {tr.reason === "stop-loss"
              ? t("paper.targets.triggeredSL", {
                  level: fmtCurrency(tr.level),
                  price: fmtCurrency(tr.price),
                })
              : t("paper.targets.triggeredTP", {
                  level: fmtCurrency(tr.level),
                  price: fmtCurrency(tr.price),
                })}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PaperTradingPage() {
  const { data, loading, error, reload } = usePaper();
  const t = useT();

  const doReset = async () => {
    if (!confirm(t("paper.resetConfirm"))) return;
    await fetch("/api/paper", { method: "DELETE" });
    reload();
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader pageTitleKey="nav.paper" />
      <PageIntro pageKey="paper" />

      {error && <ErrorBanner message={error} retry={reload} />}
      {!data && !error && loading && <LoadingPage label={t("loading.portfolio")} />}

      {data && (
        <>
          <TriggerBanner triggered={data.triggered ?? []} />
          <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr] animate-fade-in">
            <OrderForm onSubmitted={reload} />
            <div className="space-y-4">
              <PortfolioCard
                valuation={data.valuation}
                analytics={data.analytics.portfolio}
                onReset={doReset}
                onChanged={reload}
              />
              <AnalyticsCard analytics={data.analytics.portfolio} />
              <PerSymbolTable rows={data.analytics.perSymbol} />
            </div>
          </div>

          <div className="mt-4 animate-fade-in">
            <TradesTable
              trades={data.trades}
              positions={data.valuation.positions}
              onChanged={reload}
            />
          </div>

          <KeyTerms
            terms={[
              "Paper Trading",
              "Position",
              "Cost Basis",
              "Avg Cost",
              "Market Value",
              "Realised P&L",
              "Unrealised P&L",
              "Stop-Loss",
              "Take-Profit",
              "Bracket Order",
              "Win Rate",
              "Payoff Ratio",
              "Round Trip",
              "Avg Win",
              "Avg Loss",
              "ATR",
              "Risk-Reward",
              "Long",
              "Short",
            ]}
          />
        </>
      )}
    </div>
  );
}
