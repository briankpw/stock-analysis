"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  ChevronDown,
  Gauge,
  Layers,
  Loader2,
  Minus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ErrorBanner, LoadingPage } from "@/components/loading";
import { PageIntro } from "@/components/page-intro";
import { KeyTerms } from "@/components/key-terms";
import {
  SegmentHeatmap,
  type HeatmapItem,
  type WeightOption,
} from "@/components/segment-heatmap";
import { useT } from "@/lib/i18n";
import { useLocale } from "@/lib/state";
import { cn } from "@/lib/utils";
import type {
  IndexSummary,
  SegmentSummary,
  SegmentsResponse,
  StanceMode,
} from "@/app/api/segments/route";

// ---------------------------------------------------------------------------
// Data hook
// ---------------------------------------------------------------------------

function useSegments() {
  const [data, setData] = React.useState<SegmentsResponse | null>(null);
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
          `/api/segments${nonce > 0 ? `?_=${nonce}` : ""}`,
          { cache: "no-store" },
        );
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.error ?? `HTTP ${res.status}`);
        } else {
          setData(body as SegmentsResponse);
        }
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
// Small formatting helpers
// ---------------------------------------------------------------------------

function fmtPrice(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return v.toFixed(2);
}

function fmtPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(2)}%`;
}

function pctClass(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "text-muted-foreground";
  if (v > 0) return "text-success";
  if (v < 0) return "text-danger";
  return "text-muted-foreground";
}

// ---------------------------------------------------------------------------
// Stance chip — bull/neutral/bear with an icon
// ---------------------------------------------------------------------------

function StanceChip({
  stance,
  labels,
  interpretation,
}: {
  stance: "bullish" | "bearish" | "neutral";
  labels: { bullish: string; bearish: string; neutral: string };
  /**
   * Optional interpretation-mode hint. When set to `inverted` or
   * `mixed`, the chip gets wrapped in a tooltip that explains why
   * the label doesn't just mirror the raw price direction. `direct`
   * or `undefined` renders the plain chip.
   */
  interpretation?: {
    mode: StanceMode;
    title: string;
    body: string;
  };
}) {
  const map = {
    bullish: {
      icon: <TrendingUp className="h-3.5 w-3.5" />,
      cls: "chip-bull",
      label: labels.bullish,
    },
    bearish: {
      icon: <TrendingDown className="h-3.5 w-3.5" />,
      cls: "chip-bear",
      label: labels.bearish,
    },
    neutral: {
      icon: <Minus className="h-3.5 w-3.5" />,
      cls: "chip-neu",
      label: labels.neutral,
    },
  }[stance];

  const needsTooltip =
    interpretation && interpretation.mode !== "direct";

  // On the inverted / mixed variants we render a subtle info dot next
  // to the label so the chip visibly announces "there's a tooltip
  // here" without adding noisy underline decoration on top of an
  // already-coloured chip.
  const chip = (
    <span
      className={cn("chip", map.cls, needsTooltip && "cursor-help")}
    >
      {map.icon}
      {map.label}
      {needsTooltip && (
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-60"
        />
      )}
    </span>
  );

  if (!needsTooltip) return chip;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent className="max-w-xs" side="bottom">
        <p className="font-semibold text-sm mb-1">{interpretation!.title}</p>
        <p className="text-[0.7rem] text-muted-foreground leading-relaxed">
          {interpretation!.body}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Index card
// ---------------------------------------------------------------------------

// Per-ticker slug for the stance-mode tooltip strings. Yahoo tickers
// contain characters that read poorly inside i18n keys (^VIX, DX-Y.NYB,
// GC=F, BTC-USD…), so we normalise to human slugs here and let the
// dictionary key on those instead.
const STANCE_TICKER_SLUG: Readonly<Record<string, string>> = {
  "^VIX": "vix",
  "^TNX": "tnx",
  "DX-Y.NYB": "dxy",
  "GC=F": "gold",
  "CL=F": "crude",
  "BTC-USD": "btc",
};

function IndexRow({ ix }: { ix: IndexSummary }) {
  const t = useT();
  const locale = useLocale();
  const displayName = locale === "zh-CN" && ix.nameZh ? ix.nameZh : ix.name;

  // When the stance was inverted or the underlying is a "mixed"
  // reader (gold, crude, bitcoin), wire up a tooltip so the chip
  // explains itself instead of quietly misleading equity-focused
  // users. Direct-mode indices skip the tooltip entirely.
  //
  // The dictionary carries a per-ticker body when we have a
  // hand-crafted one (VIX / 10Y / DXY / Gold / Crude / BTC) and a
  // generic `.default` for any future ticker we mark inverted/mixed
  // without adding copy first. `translate()` returns the raw key on
  // miss, so we detect that and fall back explicitly.
  const interpretation = React.useMemo(() => {
    if (ix.stanceMode === "direct") return undefined;
    const slug = STANCE_TICKER_SLUG[ix.ticker];
    const specificKey = slug
      ? `segments.stanceMode.${ix.stanceMode}.${slug}`
      : null;
    const specificBody = specificKey ? t(specificKey) : null;
    const hasSpecific =
      specificBody !== null && specificBody !== specificKey;
    return {
      mode: ix.stanceMode,
      title: t(`segments.stanceMode.${ix.stanceMode}.title`),
      body: hasSpecific
        ? specificBody!
        : t(`segments.stanceMode.${ix.stanceMode}.default`),
    };
  }, [t, ix.stanceMode, ix.ticker]);

  return (
    <li className="glass rounded-lg p-3 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{displayName}</p>
          <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
            {ix.ticker}
          </p>
        </div>
        {ix.status === "ok" ? (
          <StanceChip
            stance={ix.stance}
            labels={{
              bullish: t("segments.stance.bullish"),
              bearish: t("segments.stance.bearish"),
              neutral: t("segments.stance.neutral"),
            }}
            interpretation={interpretation}
          />
        ) : (
          <span className="text-[0.65rem] uppercase text-warning">
            {t("segments.errorTag")}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-base font-bold tabular-nums">
          {fmtPrice(ix.quote?.price ?? null)}
        </span>
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            pctClass(ix.quote?.changePercent ?? null),
          )}
        >
          {fmtPct(ix.quote?.changePercent ?? null)}
        </span>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Segment card
// ---------------------------------------------------------------------------

function SegmentCard({ seg }: { seg: SegmentSummary }) {
  const t = useT();
  const locale = useLocale();
  const displayName = locale === "zh-CN" && seg.nameZh ? seg.nameZh : seg.name;
  const displayDesc =
    locale === "zh-CN" && seg.descriptionZh ? seg.descriptionZh : seg.description;

  return (
    <Link
      href={`/market/segments/${seg.id}`}
      className={cn(
        "group block rounded-xl border border-border bg-card p-4 hover:border-primary/50 hover:bg-muted/30 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-base font-semibold truncate">{displayName}</h3>
            {seg.status === "ok" && (
              <StanceChip
                stance={seg.stance}
                labels={{
                  bullish: t("segments.stance.bullish"),
                  bearish: t("segments.stance.bearish"),
                  neutral: t("segments.stance.neutral"),
                }}
              />
            )}
          </div>
          <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground mt-1">
            {t("segments.trackedBy", { ticker: seg.proxyEtf })} ·{" "}
            {t("segments.tickerCount", { n: seg.tickerCount })}
          </p>
        </div>
        <ArrowRight
          className="h-4 w-4 text-muted-foreground group-hover:text-primary shrink-0 mt-1 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </div>

      <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
        {displayDesc}
      </p>

      <div className="mt-3 flex items-baseline gap-3 flex-wrap">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xs text-muted-foreground">{t("segments.price")}</span>
          <span className="text-sm font-bold tabular-nums">
            {fmtPrice(seg.quote?.price ?? null)}
          </span>
        </div>
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            pctClass(seg.quote?.changePercent ?? null),
          )}
        >
          {fmtPct(seg.quote?.changePercent ?? null)}
        </span>
      </div>

      {seg.signals && (
        <ul className="mt-3 grid grid-cols-3 gap-1.5 text-[0.65rem]">
          <MiniStat label={t("segments.mini.trend")} value={seg.signals.trend} />
          <MiniStat label={t("segments.mini.rsi")} value={seg.signals.rsi} />
          <MiniStat label={t("segments.mini.macd")} value={seg.signals.macd} />
        </ul>
      )}
    </Link>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <li className="rounded-md bg-muted/30 px-2 py-1.5 min-w-0">
      <p className="uppercase tracking-wider text-muted-foreground truncate">{label}</p>
      <p className="font-medium mt-0.5 truncate">{value}</p>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Segment grid sorting
// ---------------------------------------------------------------------------

/**
 * Sort modes for the Themes & Sectors grid. `default` preserves the
 * curated order the API returns (which itself mirrors the hand-tuned
 * order in `lib/segments.ts` — sensible groupings like Big Tech →
 * Semis → Cloud → Software etc.).
 *
 * The `change*` modes lean on the day's proxy-ETF % change and push
 * error/no-data segments to the bottom so they don't pollute the top
 * of a "biggest gainer" list.
 */
type SegmentSortMode =
  | "default"
  | "nameAsc"
  | "changeDesc"
  | "changeAsc"
  | "sizeDesc"
  | "sizeAsc";

const SEGMENT_SORT_MODES: SegmentSortMode[] = [
  "default",
  "nameAsc",
  "changeDesc",
  "changeAsc",
  "sizeDesc",
  "sizeAsc",
];

function sortSegments(
  segments: SegmentSummary[],
  mode: SegmentSortMode,
  locale: string,
): SegmentSummary[] {
  if (mode === "default") return segments;

  const nameOf = (s: SegmentSummary) =>
    locale === "zh-CN" && s.nameZh ? s.nameZh : s.name;

  const withOriginalIndex = segments.map((s, i) => ({ s, i }));

  const changeKey = (s: SegmentSummary): number | null => {
    const v = s.quote?.changePercent;
    return v !== null && v !== undefined && Number.isFinite(v) ? v : null;
  };

  switch (mode) {
    case "nameAsc":
      return [...withOriginalIndex]
        .sort((a, b) => {
          const cmp = nameOf(a.s).localeCompare(nameOf(b.s), locale);
          return cmp !== 0 ? cmp : a.i - b.i;
        })
        .map((r) => r.s);

    case "changeDesc":
    case "changeAsc": {
      const dir = mode === "changeDesc" ? -1 : 1;
      return [...withOriginalIndex]
        .sort((a, b) => {
          const av = changeKey(a.s);
          const bv = changeKey(b.s);
          // Push nulls (error / no data) to the bottom regardless of dir.
          if (av === null && bv === null) return a.i - b.i;
          if (av === null) return 1;
          if (bv === null) return -1;
          if (av === bv) return a.i - b.i;
          return (av - bv) * dir;
        })
        .map((r) => r.s);
    }

    case "sizeDesc":
    case "sizeAsc": {
      const dir = mode === "sizeDesc" ? -1 : 1;
      return [...withOriginalIndex]
        .sort((a, b) => {
          const diff = (a.s.tickerCount - b.s.tickerCount) * dir;
          return diff !== 0 ? diff : a.i - b.i;
        })
        .map((r) => r.s);
    }

    default:
      return segments;
  }
}

// ---------------------------------------------------------------------------
// Segments heatmap card — treemap of all themes/sectors, sized by a
// user-selectable weight metric (constituent count / proxy volume / |Δ|)
// and coloured by the day's move on the proxy ETF.
// ---------------------------------------------------------------------------

function SegmentsHeatmapCard({ segments }: { segments: SegmentSummary[] }) {
  const t = useT();
  const locale = useLocale();

  // Weight options for the OVERVIEW heatmap. `marketCap` isn't
  // meaningful for an ETF proxy, so we lean on constituent count and
  // proxy dollar-volume instead.
  const weightOptions = React.useMemo<
    WeightOption<SegmentSummary>[]
  >(
    () => [
      {
        id: "companies",
        label: t("segments.heatmap.weight.companies"),
        description: t("segments.heatmap.weight.companies.desc"),
        compute: (item) => (item.data as SegmentSummary | undefined)?.tickerCount ?? 1,
      },
      {
        id: "volume",
        label: t("segments.heatmap.weight.volume"),
        description: t("segments.heatmap.weight.volume.desc"),
        compute: (item) => {
          const seg = item.data as SegmentSummary | undefined;
          const v = seg?.quote?.volume ?? 0;
          const p = seg?.quote?.price ?? 0;
          // Dollar volume prevents penny-price / mega-price bias.
          return v > 0 && p > 0 ? v * p : 0;
        },
      },
      {
        id: "abs-change",
        label: t("segments.heatmap.weight.absChange"),
        description: t("segments.heatmap.weight.absChange.desc"),
        compute: (item) => Math.abs(item.changePercent ?? 0),
      },
    ],
    [t],
  );

  const items = React.useMemo<HeatmapItem<SegmentSummary>[]>(
    () =>
      segments.map((seg) => ({
        id: seg.id,
        label: locale === "zh-CN" && seg.nameZh ? seg.nameZh : seg.name,
        sublabel: seg.proxyEtf,
        changePercent: seg.quote?.changePercent ?? null,
        href: `/market/segments/${seg.id}`,
        data: seg,
      })),
    [segments, locale],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <BarChart3 className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">
            {t("segments.heatmap.title")}
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {t("segments.heatmap.hint")}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <SegmentHeatmap
          items={items}
          weightOptions={weightOptions}
          weightLabel={t("segments.heatmap.weightLabel")}
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * How many indices to show before the expand-toggle kicks in. Four fits
 * exactly one row on the lg breakpoint (`lg:grid-cols-4`) so the
 * collapsed default reads as a single tidy strip — the four core US
 * equity benchmarks (S&P 500, Nasdaq Composite, Nasdaq 100, Dow) —
 * with the rest tucked behind "Show all".
 */
const INDICES_COLLAPSED_COUNT = 4;

export default function SegmentsPage() {
  const t = useT();
  const locale = useLocale();
  const { data, loading, error, reload } = useSegments();
  const [indicesExpanded, setIndicesExpanded] = React.useState(false);
  const [sortMode, setSortMode] = React.useState<SegmentSortMode>("default");

  const sortedSegments = React.useMemo(
    () => (data ? sortSegments(data.segments, sortMode, locale) : []),
    [data, sortMode, locale],
  );

  return (
    <div className="mx-auto max-w-7xl">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-5 lg:pb-6 border-b border-border mb-5 lg:mb-6">
        <div className="min-w-0">
          <p className="metric-label mb-1">
            <Link href="/market" className="hover:text-primary transition-colors">
              {t("nav.market")}
            </Link>
            {" / "}
            {t("nav.segments")}
          </p>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary shrink-0">
              <Layers className="h-5 w-5" />
            </span>
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight">
              {t("segments.heading")}
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            {t("segments.subheading")}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={reload} disabled={loading}>
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {t("common.refresh")}
        </Button>
      </header>

      <PageIntro pageKey="segments" />

      {error && <ErrorBanner message={error} retry={reload} />}
      {!data && !error && loading && (
        <LoadingPage label={t("segments.loading")} />
      )}

      {data && (
        <div className="space-y-6 animate-fade-in">
          {/* ---- Indices ---- */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2 flex-wrap">
                <Gauge className="h-4 w-4 text-primary" />
                <CardTitle className="text-base">{t("segments.indices.title")}</CardTitle>
                <span className="text-xs text-muted-foreground">
                  {t("segments.indices.hint")}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              {(() => {
                // Collapse to the top-N core benchmarks by default; the
                // rest (VIX, DXY, HSI, Nikkei, DAX, commodities…) are
                // still one click away via the toggle below.
                const total = data.indices.length;
                const canCollapse = total > INDICES_COLLAPSED_COUNT;
                const visible =
                  canCollapse && !indicesExpanded
                    ? data.indices.slice(0, INDICES_COLLAPSED_COUNT)
                    : data.indices;
                return (
                  <>
                    <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                      {visible.map((ix) => (
                        <IndexRow key={ix.id} ix={ix} />
                      ))}
                    </ul>
                    {canCollapse && (
                      <div className="mt-3 flex justify-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setIndicesExpanded((v) => !v)}
                          aria-expanded={indicesExpanded}
                          className="gap-1"
                        >
                          {indicesExpanded
                            ? t("segments.indices.showLess")
                            : t("segments.indices.showAll", {
                                n: total - INDICES_COLLAPSED_COUNT,
                              })}
                          <ChevronDown
                            className={cn(
                              "h-3.5 w-3.5 transition-transform",
                              indicesExpanded && "rotate-180",
                            )}
                            aria-hidden
                          />
                        </Button>
                      </div>
                    )}
                  </>
                );
              })()}
            </CardContent>
          </Card>

          {/* ---- Segment heatmap ---- */}
          <SegmentsHeatmapCard segments={data.segments} />

          {/* ---- Segments grid ---- */}
          <div>
            <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
              <div>
                <h2 className="text-base sm:text-lg font-semibold flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  {t("segments.grid.title")}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {t("segments.grid.hint")}
                </p>
              </div>
              <div className="flex items-center gap-3 flex-wrap ml-auto">
                <label className="inline-flex items-center gap-2 text-[0.7rem] uppercase tracking-wider text-muted-foreground">
                  {t("segments.grid.sortLabel")}
                  <select
                    value={sortMode}
                    onChange={(e) =>
                      setSortMode(e.target.value as SegmentSortMode)
                    }
                    className="h-8 rounded-md border border-border bg-card px-2 text-xs normal-case tracking-normal text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    aria-label={t("segments.grid.sortLabel")}
                  >
                    {SEGMENT_SORT_MODES.map((m) => (
                      <option key={m} value={m}>
                        {t(`segments.grid.sort.${m}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
                  {t("segments.grid.count", { n: sortedSegments.length })}
                </p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {sortedSegments.map((seg) => (
                <SegmentCard key={seg.id} seg={seg} />
              ))}
            </div>
          </div>

          <KeyTerms
            terms={[
              "Heatmap",
              "Weighting",
              "Market Cap",
              "Dollar Volume",
              "Volume (shares)",
              "Absolute Change",
              "Equal Weight",
              "Change",
              "Segment",
              "Sector",
              "Constituents",
              "Proxy ETF",
              "SMA",
              "RSI",
              "MACD",
              "Bull Market",
              "Bear Market",
              "ETF",
              "VIX",
              "DXY",
              "10Y Yield",
            ]}
          />
        </div>
      )}
    </div>
  );
}
