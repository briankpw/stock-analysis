"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Layers,
  LayoutGrid,
  List,
  Loader2,
  Minus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ErrorBanner, LoadingPage } from "@/components/loading";
import { TechnicalSignalCard } from "@/components/technical-signal-card";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import { KeyTerms } from "@/components/key-terms";
import {
  SegmentHeatmap,
  type HeatmapItem,
  type WeightOption,
} from "@/components/segment-heatmap";
import { useT } from "@/lib/i18n";
import { useLocale, useUi } from "@/lib/state";
import { cn } from "@/lib/utils";
import { findSegment } from "@/lib/segments";
import type {
  ConstituentRow,
  SegmentDetailResponse,
} from "@/app/api/segments/[id]/route";

// ---------------------------------------------------------------------------
// Data hook
// ---------------------------------------------------------------------------

function useSegmentDetail(id: string) {
  const [data, setData] = React.useState<SegmentDetailResponse | null>(null);
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
          `/api/segments/${id}${nonce > 0 ? `?_=${nonce}` : ""}`,
          { cache: "no-store" },
        );
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(body?.error ?? `HTTP ${res.status}`);
        } else {
          setData(body as SegmentDetailResponse);
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
  }, [id, nonce]);

  return { data, loading, error, reload };
}

// ---------------------------------------------------------------------------
// Formatting helpers
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

function stanceChipClass(stance: "bullish" | "bearish" | "neutral"): string {
  return stance === "bullish"
    ? "chip chip-bull"
    : stance === "bearish"
      ? "chip chip-bear"
      : "chip chip-neu";
}

function StanceIcon({ stance }: { stance: "bullish" | "bearish" | "neutral" }) {
  if (stance === "bullish") return <TrendingUp className="h-3.5 w-3.5" />;
  if (stance === "bearish") return <TrendingDown className="h-3.5 w-3.5" />;
  return <Minus className="h-3.5 w-3.5" />;
}

// ---------------------------------------------------------------------------
// Constituent table (with pagination)
// ---------------------------------------------------------------------------

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

function ConstituentTable({ rows }: { rows: ConstituentRow[] }) {
  const t = useT();
  const router = useRouter();
  const setTicker = useUi((s) => s.setTicker);
  const [pageSize, setPageSize] = React.useState<PageSize>(25);
  const [page, setPage] = React.useState(0);

  // Snap the current page back into range if the underlying row set
  // shrinks (e.g. a refresh dropped a ticker) or the page size grows.
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  React.useEffect(() => {
    if (page > pageCount - 1) setPage(0);
  }, [page, pageCount]);

  const openStock = React.useCallback(
    (ticker: string) => {
      setTicker(ticker);
      router.push("/overview");
    },
    [router, setTicker],
  );

  const stanceLabels = {
    bullish: t("segments.stance.bullish"),
    bearish: t("segments.stance.bearish"),
    neutral: t("segments.stance.neutral"),
  };

  const start = page * pageSize;
  const end = Math.min(start + pageSize, rows.length);
  const paged = rows.slice(start, end);
  const showPager = rows.length > PAGE_SIZE_OPTIONS[0]!;

  return (
    <div>
      <div className="overflow-x-auto -mx-4 sm:mx-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[0.65rem] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="text-left px-4 sm:px-3 py-2 font-medium">{t("segments.tbl.ticker")}</th>
              <th className="text-right px-3 py-2 font-medium">{t("segments.tbl.price")}</th>
              <th className="text-right px-3 py-2 font-medium">{t("segments.tbl.change")}</th>
              <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">{t("segments.tbl.trend")}</th>
              <th className="text-left px-3 py-2 font-medium hidden md:table-cell">{t("segments.tbl.rsi")}</th>
              <th className="text-left px-3 py-2 font-medium hidden lg:table-cell">{t("segments.tbl.macd")}</th>
              <th className="text-left px-3 py-2 font-medium">{t("segments.tbl.stance")}</th>
              <th aria-hidden className="w-20" />
            </tr>
          </thead>
          <tbody>
            {paged.map((row) => {
              const changePct = row.quote?.changePercent ?? null;
              const price = row.quote?.price ?? null;
              const hasSignals = !!row.signals;
              return (
                <tr
                  key={row.ticker}
                  className="border-b border-border/60 hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => openStock(row.ticker)}
                >
                  <td className="px-4 sm:px-3 py-2.5 font-semibold tabular-nums">{row.ticker}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                    {fmtPrice(price)}
                  </td>
                  <td className={cn("px-3 py-2.5 text-right font-mono tabular-nums", pctClass(changePct))}>
                    {fmtPct(changePct)}
                  </td>
                  <td className="px-3 py-2.5 hidden sm:table-cell text-xs text-muted-foreground truncate max-w-[10rem]">
                    {hasSignals ? row.signals!.trend : "—"}
                  </td>
                  <td className="px-3 py-2.5 hidden md:table-cell text-xs text-muted-foreground truncate max-w-[8rem]">
                    {hasSignals ? row.signals!.rsi : "—"}
                  </td>
                  <td className="px-3 py-2.5 hidden lg:table-cell text-xs text-muted-foreground truncate max-w-[6rem]">
                    {hasSignals ? row.signals!.macd : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    {row.status === "ok" ? (
                      <span className={stanceChipClass(row.stance)}>
                        <StanceIcon stance={row.stance} />
                        {stanceLabels[row.stance]}
                      </span>
                    ) : (
                      <span className="text-[0.65rem] uppercase text-warning">
                        {t("segments.errorTag")}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <div
                      className="inline-flex items-center gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <AddToWatchlistButton symbol={row.ticker} />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openStock(row.ticker);
                        }}
                        aria-label={t("segments.tbl.openStock", { ticker: row.ticker })}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-primary transition-colors"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showPager && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 sm:px-3 py-2.5 border-t border-border text-xs text-muted-foreground">
          <span>
            {t("segments.tbl.pager.showing", {
              start: start + 1,
              end,
              total: rows.length,
            })}
          </span>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="inline-flex items-center gap-1.5">
              <span>{t("segments.tbl.pager.pageSize")}</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value) as PageSize);
                  setPage(0);
                }}
                className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs"
                aria-label={t("segments.tbl.pager.pageSize")}
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                aria-label={t("segments.tbl.pager.prev")}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="tabular-nums">
                {t("segments.tbl.pager.pageOf", {
                  page: page + 1,
                  total: pageCount,
                })}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
                aria-label={t("segments.tbl.pager.next")}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Constituent heatmap
// ---------------------------------------------------------------------------

function ConstituentHeatmap({ rows }: { rows: ConstituentRow[] }) {
  const t = useT();
  const router = useRouter();
  const setTicker = useUi((s) => s.setTicker);

  const openStock = React.useCallback(
    (ticker: string) => {
      setTicker(ticker);
      router.push("/overview");
    },
    [router, setTicker],
  );

  const weightOptions = React.useMemo<
    WeightOption<ConstituentRow>[]
  >(
    () => [
      {
        id: "marketCap",
        label: t("segments.heatmap.weight.marketCap"),
        description: t("segments.heatmap.weight.marketCap.desc"),
        compute: (item) => (item.data as ConstituentRow | undefined)?.quote?.marketCap ?? 0,
      },
      {
        id: "dollarVolume",
        label: t("segments.heatmap.weight.dollarVolume"),
        description: t("segments.heatmap.weight.dollarVolume.desc"),
        compute: (item) => {
          const r = item.data as ConstituentRow | undefined;
          const v = r?.quote?.volume ?? 0;
          const p = r?.quote?.price ?? 0;
          return v > 0 && p > 0 ? v * p : 0;
        },
      },
      {
        id: "volume",
        label: t("segments.heatmap.weight.volumeShares"),
        description: t("segments.heatmap.weight.volumeShares.desc"),
        compute: (item) => (item.data as ConstituentRow | undefined)?.quote?.volume ?? 0,
      },
      {
        id: "abs-change",
        label: t("segments.heatmap.weight.absChange"),
        description: t("segments.heatmap.weight.absChange.desc"),
        compute: (item) => Math.abs(item.changePercent ?? 0),
      },
      {
        id: "equal",
        label: t("segments.heatmap.weight.equal"),
        description: t("segments.heatmap.weight.equal.desc"),
        compute: () => 1,
      },
    ],
    [t],
  );

  const items = React.useMemo<HeatmapItem<ConstituentRow>[]>(
    () =>
      rows.map((r) => ({
        id: r.ticker,
        label: r.ticker,
        sublabel: fmtPrice(r.quote?.price ?? null),
        changePercent: r.quote?.changePercent ?? null,
        // Use an explicit click handler (not `href`) so we can also
        // update the sticky ticker before navigating — matches the
        // table row's behaviour.
        data: r,
      })),
    [rows],
  );

  return (
    <SegmentHeatmap
      items={items}
      weightOptions={weightOptions}
      weightLabel={t("segments.heatmap.weightLabel")}
      renderTileBody={(item) => {
        const r = item.data as ConstituentRow;
        // Sibling layout — the openStock button covers the tile, and the
        // AddToWatchlistButton floats in the top-right corner. Using
        // absolute positioning keeps the two buttons as separate DOM
        // subtrees (invalid HTML to nest a <button> inside a <button>).
        return (
          <div className="relative h-full w-full">
            <button
              type="button"
              onClick={() => openStock(r.ticker)}
              aria-label={t("segments.tbl.openStock", { ticker: r.ticker })}
              className="flex flex-col justify-between h-full w-full min-w-0 p-1.5 text-left"
            >
              <div className="min-w-0 pr-6">
                <p className="text-xs font-bold tabular-nums truncate leading-tight">
                  {r.ticker}
                </p>
                {r.quote?.price != null && (
                  <p className="text-[0.6rem] opacity-80 truncate leading-tight mt-0.5 tabular-nums">
                    {fmtPrice(r.quote.price)}
                  </p>
                )}
              </div>
              <p className="text-[0.7rem] font-semibold tabular-nums leading-tight">
                {fmtPct(r.quote?.changePercent ?? null)}
              </p>
            </button>
            <div className="absolute top-1 right-1">
              <AddToWatchlistButton
                symbol={r.ticker}
                className="h-5 w-5 bg-background/70 backdrop-blur-sm"
              />
            </div>
          </div>
        );
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Constituents section — view toggle (Heatmap ↔ Table)
// ---------------------------------------------------------------------------

type ConstituentView = "heatmap" | "table";

function ConstituentsSection({ rows }: { rows: ConstituentRow[] }) {
  const t = useT();
  const [view, setView] = React.useState<ConstituentView>("heatmap");

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-base sm:text-lg font-semibold">
            {t("segments.detail.constituentsTitle")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("segments.detail.constituentsHint")}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
            {t("segments.tickerCount", { n: rows.length })}
          </p>
          <div
            role="radiogroup"
            aria-label={t("segments.detail.view.label")}
            className="inline-flex rounded-md border border-border bg-muted/30 p-0.5"
          >
            <button
              type="button"
              role="radio"
              aria-checked={view === "heatmap"}
              onClick={() => setView("heatmap")}
              className={cn(
                "inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded transition-colors",
                view === "heatmap"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              {t("segments.detail.view.heatmap")}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={view === "table"}
              onClick={() => setView("table")}
              className={cn(
                "inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded transition-colors",
                view === "table"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <List className="h-3.5 w-3.5" />
              {t("segments.detail.view.table")}
            </button>
          </div>
        </div>
      </div>
      <Card>
        <CardContent className={cn(view === "table" ? "p-0" : "p-4")}>
          {view === "heatmap" ? (
            <ConstituentHeatmap rows={rows} />
          ) : (
            <ConstituentTable rows={rows} />
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SegmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = React.use(params);
  const seg = findSegment(id);
  const t = useT();
  const locale = useLocale();
  const { data, loading, error, reload } = useSegmentDetail(id);

  if (!seg) {
    return (
      <div className="mx-auto max-w-3xl py-10 text-center">
        <p className="text-lg font-semibold">404</p>
        <p className="text-sm text-muted-foreground mt-2">
          {t("segments.detail.backToSegments")}
        </p>
        <Link
          href="/market/segments"
          className="mt-4 inline-flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("segments.detail.backToSegments")}
        </Link>
      </div>
    );
  }

  const displayName = locale === "zh-CN" && seg.nameZh ? seg.nameZh : seg.name;
  const displayDesc =
    locale === "zh-CN" && seg.descriptionZh ? seg.descriptionZh : seg.description;

  const proxyStanceLabel =
    data?.proxy.status === "ok"
      ? data.proxy.stance === "bullish"
        ? t("segments.stance.bullish")
        : data.proxy.stance === "bearish"
          ? t("segments.stance.bearish")
          : t("segments.stance.neutral")
      : null;

  return (
    <div className="mx-auto max-w-7xl">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-5 lg:pb-6 border-b border-border mb-5 lg:mb-6">
        <div className="min-w-0">
          <p className="metric-label mb-1 flex items-center gap-1 flex-wrap">
            <Link href="/market" className="hover:text-primary transition-colors">
              {t("nav.market")}
            </Link>
            <span aria-hidden>/</span>
            <Link
              href="/market/segments"
              className="hover:text-primary transition-colors"
            >
              {t("nav.segments")}
            </Link>
            <span aria-hidden>/</span>
            <span className="text-foreground/80">{displayName}</span>
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary shrink-0">
              <Layers className="h-5 w-5" />
            </span>
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold tracking-tight">
              {displayName}
            </h1>
            {proxyStanceLabel && data?.proxy.status === "ok" && (
              <span className={stanceChipClass(data.proxy.stance)}>
                <StanceIcon stance={data.proxy.stance} />
                {proxyStanceLabel}
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-3xl">
            {displayDesc}
          </p>
          <p className="text-[0.7rem] text-muted-foreground mt-1">
            {t("segments.detail.trackedByFull", {
              ticker: seg.proxyEtf,
              name: seg.proxyEtfName,
            })}
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

      {error && <ErrorBanner message={error} retry={reload} />}
      {!data && !error && loading && (
        <LoadingPage label={t("segments.loading")} />
      )}

      {data && (
        <div className="space-y-6 animate-fade-in">
          {/* ---- Proxy ETF signal ---- */}
          <section>
            <div className="mb-3">
              <h2 className="text-base sm:text-lg font-semibold flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                {t("segments.detail.overviewTitle")}
              </h2>
              <p className="text-xs text-muted-foreground">
                {t("segments.detail.overviewHint")}
              </p>
            </div>

            {data.proxy.status === "ok" && data.proxy.signal ? (
              <div className="space-y-3">
                <Card>
                  <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                    <div className="min-w-0">
                      <CardTitle className="text-base flex items-center gap-2">
                        {seg.proxyEtf}
                        <span className="text-xs font-normal text-muted-foreground truncate">
                          {seg.proxyEtfName}
                        </span>
                      </CardTitle>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg font-bold tabular-nums">
                        {fmtPrice(data.proxy.quote?.price ?? null)}
                      </p>
                      <p
                        className={cn(
                          "text-sm font-semibold tabular-nums",
                          pctClass(data.proxy.quote?.changePercent ?? null),
                        )}
                      >
                        {fmtPct(data.proxy.quote?.changePercent ?? null)}
                      </p>
                    </div>
                  </CardHeader>
                </Card>
                <TechnicalSignalCard signal={data.proxy.signal} />
              </div>
            ) : (
              <Card>
                <CardContent className="py-6 text-center text-sm text-muted-foreground">
                  {t("segments.detail.emptyProxy")}
                </CardContent>
              </Card>
            )}
          </section>

          {/* ---- Constituents (heatmap ↔ table toggle) ---- */}
          <ConstituentsSection rows={data.constituents} />

          {/* ---- Key terms on this page (Beginner mode only) ----
              Explains the vocabulary a new user meets on this specific
              page: the heatmap itself, each entry in the "Weight by"
              toggle, and segment-structure jargon (Constituents,
              Proxy ETF, etc.). Advanced-mode users don't see this. */}
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
              "Constituents",
              "Proxy ETF",
              "Sector",
              "Segment",
              "Technical Signal",
              "Bullish",
              "Bearish",
            ]}
          />
        </div>
      )}
    </div>
  );
}
