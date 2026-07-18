"use client";

/**
 * Squarified-treemap heatmap.
 *
 * Drives both the segments-overview heatmap (each cell = one theme) and
 * the drilldown heatmap (each cell = one constituent).  Callers hand in
 * `items` plus a set of `weightOptions` (which metric to use for the
 * box size — market cap / dollar volume / etc.); the component owns the
 * "Weight by" toggle state itself so both pages get identical UX for
 * free.
 *
 * Layout: classic Bruls/Huijbregts/van Wijk squarified treemap
 * (https://www.win.tue.nl/~vanwijk/stm.pdf) — greedy row-packing that
 * keeps each cell's aspect ratio close to a square, so nothing renders
 * as a two-pixel sliver even when the weight distribution is very
 * skewed. Layout runs client-side once the container's on-screen size
 * is known (via ResizeObserver); before that we render a placeholder
 * so the initial paint doesn't jump.
 *
 * Colour: hard-coded five-band ramp anchored on the app's success/danger
 * tokens, so a green cell here matches a green chip elsewhere on the
 * page. `null` change is neutral grey (not a bug — it's the *cache
 * miss / rate-limited* state, and we don't want it to look bullish or
 * bearish).
 */

import * as React from "react";
import Link from "next/link";
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One tile the heatmap can draw. `data` is opaque payload the caller
 * can index back to their own row when they need to invalidate or link
 * out — the heatmap doesn't touch it.
 */
export interface HeatmapItem<T = unknown> {
  id: string;
  /** Big label — usually the ticker or short name. */
  label: string;
  /** Small caption under the label (optional). */
  sublabel?: string;
  /** Day change as a fraction (0.023 = +2.3%). `null` = neutral cell. */
  changePercent: number | null;
  /** `<Link>` target when clicked. Omit for a static cell. */
  href?: string;
  data?: T;
}

export interface WeightOption<T = unknown> {
  /** Stable id, used for the toggle state. */
  id: string;
  /** Label rendered on the toggle. */
  label: string;
  /**
   * Beginner-mode explanation of what makes a tile bigger under this
   * weighting. Shown in the "?" tooltip next to the "Weight by" label.
   * Optional — falls back to the label if omitted.
   */
  description?: string;
  /**
   * Compute the tile's weight. Return `0` or a non-finite value to
   * force the tile to a minimum-visibility size (we clamp internally
   * so nothing disappears entirely, but a `0` will still shrink to the
   * clamp floor).
   */
  compute: (item: HeatmapItem<T>) => number;
}

interface HeatmapProps<T> {
  items: HeatmapItem<T>[];
  /** Weight-metric choices; the first is selected by default. */
  weightOptions: WeightOption<T>[];
  /** Optional prefix — e.g. "Weight by:" — placed before the toggle. */
  weightLabel?: string;
  /** Container height in CSS units. Default `26rem`. */
  height?: string;
  className?: string;
  /**
   * Optional caller-provided render for the label inside each tile.
   * Handy when the caller wants a tick-mark next to the ticker etc.
   */
  renderTileBody?: (item: HeatmapItem<T>) => React.ReactNode;
}

// ---------------------------------------------------------------------------
// Squarified treemap layout
// ---------------------------------------------------------------------------

interface Rect { x: number; y: number; w: number; h: number }
interface LaidOutCell<T> extends Rect { item: HeatmapItem<T> }

/** Bruls et al. "worst" aspect ratio for a candidate row. */
function worstAspect(row: number[], shortSide: number): number {
  const sum = row.reduce((s, r) => s + r, 0);
  if (sum <= 0) return Number.POSITIVE_INFINITY;
  const rMax = Math.max(...row);
  const rMin = Math.min(...row);
  const w2 = shortSide * shortSide;
  const s2 = sum * sum;
  // Two aspect ratios per row (max side / min side and vice versa) —
  // return the worse of the two so we minimise the *worst* stretch.
  return Math.max((w2 * rMax) / s2, s2 / (w2 * rMin));
}

/**
 * Lay a set of weight-scaled items out inside a rectangle.
 * `items` MUST already be sorted by area descending.
 */
function squarify<T>(
  items: { area: number; item: HeatmapItem<T> }[],
  rect: Rect,
): LaidOutCell<T>[] {
  const out: LaidOutCell<T>[] = [];
  const queue = items.slice();
  let cursor: Rect = { ...rect };

  while (queue.length > 0 && cursor.w > 0 && cursor.h > 0) {
    // Try to grow a row one item at a time; commit as soon as
    // aspect-ratio stops improving.
    const row: { area: number; item: HeatmapItem<T> }[] = [queue[0]!];
    let best = worstAspect(row.map((r) => r.area), Math.min(cursor.w, cursor.h));
    let i = 1;
    while (i < queue.length) {
      const candidate = [...row, queue[i]!];
      const w = worstAspect(candidate.map((r) => r.area), Math.min(cursor.w, cursor.h));
      if (w <= best) {
        row.push(queue[i]!);
        best = w;
        i++;
      } else break;
    }

    const rowArea = row.reduce((s, r) => s + r.area, 0);
    if (rowArea <= 0) break; // defensive: skip zero-weight tail

    if (cursor.w >= cursor.h) {
      // Wide rectangle → pack the row as a vertical strip on the left.
      const stripW = rowArea / cursor.h;
      let y = cursor.y;
      for (const r of row) {
        const h = r.area / stripW;
        out.push({ x: cursor.x, y, w: stripW, h, item: r.item });
        y += h;
      }
      cursor = { x: cursor.x + stripW, y: cursor.y, w: cursor.w - stripW, h: cursor.h };
    } else {
      // Tall rectangle → pack the row as a horizontal strip on the top.
      const stripH = rowArea / cursor.w;
      let x = cursor.x;
      for (const r of row) {
        const w = r.area / stripH;
        out.push({ x, y: cursor.y, w, h: stripH, item: r.item });
        x += w;
      }
      cursor = { x: cursor.x, y: cursor.y + stripH, w: cursor.w, h: cursor.h - stripH };
    }

    queue.splice(0, row.length);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/**
 * Five-band ramp anchored on the app's success/danger tokens. Chosen
 * so that a +0.4% cell is visibly-but-mildly green, +3%+ is emphatic
 * green, and the mirror for red. Neutral / null is grey so it can't
 * be misread as a "small down day".
 */
function cellColorClass(changePct: number | null): string {
  if (changePct === null || !Number.isFinite(changePct)) {
    return "bg-muted/40 text-foreground/80";
  }
  const p = changePct * 100; // to percent
  if (p >= 3) return "bg-success/80 text-success-foreground";
  if (p >= 1) return "bg-success/60 text-success-foreground";
  if (p > 0) return "bg-success/30 text-foreground";
  if (p === 0) return "bg-muted/40 text-foreground/80";
  if (p > -1) return "bg-danger/30 text-foreground";
  if (p > -3) return "bg-danger/60 text-danger-foreground";
  return "bg-danger/80 text-danger-foreground";
}

function formatChange(changePct: number | null): string {
  if (changePct === null || !Number.isFinite(changePct)) return "—";
  const sign = changePct >= 0 ? "+" : "";
  return `${sign}${(changePct * 100).toFixed(2)}%`;
}

// ---------------------------------------------------------------------------
// Weight-metric toggle
// ---------------------------------------------------------------------------

function WeightToggle<T>({
  options,
  value,
  onChange,
  label,
}: {
  options: WeightOption<T>[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  const activeOpt = options.find((o) => o.id === value);
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {label && (
        <span className="inline-flex items-center gap-1 text-[0.7rem] uppercase tracking-wider text-muted-foreground">
          {label}
          <HeatmapLegendTooltip options={options} activeId={value} />
        </span>
      )}
      <div
        role="radiogroup"
        aria-label={label ?? "Weight metric"}
        className="inline-flex rounded-md border border-border bg-muted/30 p-0.5"
      >
        {options.map((opt) => {
          const active = opt.id === value;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.id)}
              title={opt.description}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {/* Below the toggle: one-line reminder of what the active option
          means, so users don't have to hover the "?" every time to
          remember. Kept low-key with muted styling. */}
      {activeOpt?.description && (
        <span className="text-[0.7rem] text-muted-foreground italic">
          {activeOpt.description}
        </span>
      )}
    </div>
  );
}

/**
 * Info popover explaining what makes a tile bigger/smaller and greener/redder.
 * Reads the current option list so the "Size" section stays in sync with
 * whatever weightings the caller supplied.
 */
function HeatmapLegendTooltip<T>({
  options,
  activeId,
}: {
  options: WeightOption<T>[];
  activeId: string;
}) {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={t("heatmap.legend.aria")}
          className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
        >
          <HelpCircle className="h-3.5 w-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs" side="bottom">
        <p className="font-semibold text-sm mb-1.5">
          {t("heatmap.legend.title")}
        </p>

        {/* -- Size section -- */}
        <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground mt-2">
          {t("heatmap.legend.sizeHeading")}
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
          {t("heatmap.legend.sizeIntro")}
        </p>
        <ul className="mt-1.5 space-y-1 text-xs">
          {options.map((opt) => {
            const active = opt.id === activeId;
            return (
              <li key={opt.id} className={cn("leading-snug", active && "text-foreground")}>
                <span
                  className={cn(
                    "inline-block font-medium",
                    active ? "text-primary" : "text-foreground/80",
                  )}
                >
                  {active ? `• ${opt.label}` : opt.label}
                </span>
                {opt.description && (
                  <span className="text-muted-foreground"> — {opt.description}</span>
                )}
              </li>
            );
          })}
        </ul>

        {/* -- Colour section -- */}
        <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground mt-3">
          {t("heatmap.legend.colourHeading")}
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
          {t("heatmap.legend.colourIntro")}
        </p>
        <div className="mt-1.5 flex items-center gap-0.5 text-[0.6rem] font-medium">
          <span className="flex-1 rounded-sm bg-danger/80 text-danger-foreground text-center px-1 py-0.5">
            ≤ −3%
          </span>
          <span className="flex-1 rounded-sm bg-danger/60 text-danger-foreground text-center px-1 py-0.5">
            −1
          </span>
          <span className="flex-1 rounded-sm bg-danger/30 text-foreground text-center px-1 py-0.5">
            −
          </span>
          <span className="flex-1 rounded-sm bg-muted/60 text-foreground/80 text-center px-1 py-0.5">
            0
          </span>
          <span className="flex-1 rounded-sm bg-success/30 text-foreground text-center px-1 py-0.5">
            +
          </span>
          <span className="flex-1 rounded-sm bg-success/60 text-success-foreground text-center px-1 py-0.5">
            +1
          </span>
          <span className="flex-1 rounded-sm bg-success/80 text-success-foreground text-center px-1 py-0.5">
            ≥ +3%
          </span>
        </div>
        <p className="text-[0.65rem] text-muted-foreground leading-relaxed mt-1.5">
          {t("heatmap.legend.colourNote")}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Container size observer — needed because the treemap needs concrete
// px dimensions to compute cell rects with, and we can't get them until
// after mount.
// ---------------------------------------------------------------------------

function useContainerSize<E extends HTMLElement>() {
  const ref = React.useRef<E | null>(null);
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Prime with the initial box so we don't need to wait for the
    // observer to fire before the first paint.
    const rect = el.getBoundingClientRect();
    setSize({ w: rect.width, h: rect.height });
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const box = entry.contentRect;
      setSize({ w: box.width, h: box.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, size] as const;
}

// ---------------------------------------------------------------------------
// Heatmap component
// ---------------------------------------------------------------------------

export function SegmentHeatmap<T>({
  items,
  weightOptions,
  weightLabel,
  height = "26rem",
  className,
  renderTileBody,
}: HeatmapProps<T>) {
  const firstOptId = weightOptions[0]?.id ?? "";
  const [weightId, setWeightId] = React.useState(firstOptId);
  // Fall back to the first option if the caller ever swaps out the
  // weightOptions and the current selection disappears.
  React.useEffect(() => {
    if (!weightOptions.find((o) => o.id === weightId)) {
      setWeightId(firstOptId);
    }
  }, [weightOptions, weightId, firstOptId]);

  const activeOption =
    weightOptions.find((o) => o.id === weightId) ?? weightOptions[0];

  const [containerRef, size] = useContainerSize<HTMLDivElement>();

  const cells = React.useMemo<LaidOutCell<T>[]>(() => {
    if (!size || !activeOption || items.length === 0) return [];
    const { w, h } = size;
    if (w <= 0 || h <= 0) return [];

    // 1. Compute raw weights via the caller's `compute` and floor them
    //    at a small share of the max so a zero-weight row is still
    //    visible (nothing worse than a heatmap where half the cells
    //    silently vanish because Yahoo returned `null marketCap`).
    const raws = items.map((it) => {
      const v = activeOption.compute(it);
      return Number.isFinite(v) && v > 0 ? v : 0;
    });
    const maxRaw = Math.max(...raws);
    const floor = maxRaw > 0 ? maxRaw * 0.008 : 1;
    const weights = raws.map((v) => (v > 0 ? Math.max(v, floor) : floor));
    const total = weights.reduce((s, v) => s + v, 0);
    if (total <= 0) return [];

    // 2. Scale weights to cover the container's area and sort.
    const containerArea = w * h;
    const scaled = items
      .map((it, i) => ({ area: (weights[i]! / total) * containerArea, item: it }))
      .sort((a, b) => b.area - a.area);

    // 3. Layout.
    return squarify<T>(scaled, { x: 0, y: 0, w, h });
  }, [items, size, activeOption]);

  // Tiles have a 2 px gutter — cheap way to get grid lines without a
  // dedicated stroke pass. Achieved by shrinking each rect inward.
  const GUTTER = 2;

  return (
    <div className={cn("space-y-3", className)}>
      {weightOptions.length > 1 && (
        <WeightToggle
          options={weightOptions}
          value={weightId}
          onChange={setWeightId}
          label={weightLabel}
        />
      )}

      <div
        ref={containerRef}
        className="relative w-full rounded-lg overflow-hidden border border-border bg-muted/10"
        style={{ height }}
      >
        {size === null && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            …
          </div>
        )}

        {cells.map(({ x, y, w, h, item }) => {
          const colorCls = cellColorClass(item.changePercent);
          const inner = (
            <>
              <div className="flex flex-col justify-between h-full min-w-0 p-1.5">
                {renderTileBody ? (
                  renderTileBody(item)
                ) : (
                  <>
                    <div className="min-w-0">
                      <p className="text-xs font-bold tabular-nums truncate leading-tight">
                        {item.label}
                      </p>
                      {item.sublabel && h > 44 && (
                        <p className="text-[0.6rem] opacity-80 truncate leading-tight mt-0.5">
                          {item.sublabel}
                        </p>
                      )}
                    </div>
                    {h > 36 && (
                      <p className="text-[0.7rem] font-semibold tabular-nums leading-tight">
                        {formatChange(item.changePercent)}
                      </p>
                    )}
                  </>
                )}
              </div>
            </>
          );

          const style: React.CSSProperties = {
            position: "absolute",
            left: x + GUTTER / 2,
            top: y + GUTTER / 2,
            width: Math.max(0, w - GUTTER),
            height: Math.max(0, h - GUTTER),
          };
          const cls = cn(
            "rounded-md flex overflow-hidden transition-transform",
            colorCls,
            item.href && "hover:scale-[1.02] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer",
          );
          const title = `${item.label}${item.sublabel ? ` — ${item.sublabel}` : ""} · ${formatChange(item.changePercent)}`;

          if (item.href) {
            return (
              <Link
                key={item.id}
                href={item.href}
                className={cls}
                style={style}
                title={title}
                aria-label={title}
              >
                {inner}
              </Link>
            );
          }
          return (
            <div key={item.id} className={cls} style={style} title={title} aria-label={title}>
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}
