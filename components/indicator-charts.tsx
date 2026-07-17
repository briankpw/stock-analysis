"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import {
  createChart, ColorType, CrosshairMode, LineStyle,
  type Time, type LineData, type HistogramData,
} from "lightweight-charts";
import type { Bar, KdjResult, MacdResult, NullableSeries, SupportResistance } from "@/lib/indicators";
import { attachChartTooltip, fmtChartDate, type TooltipRow } from "./chart-tooltip";
import { fmtNumber } from "@/lib/format";
import { useIsBeginner } from "@/lib/state";

function useChart<T>(
  build: (container: HTMLDivElement, dark: boolean) => T | (() => void),
  deps: React.DependencyList,
) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const { theme } = useTheme();
  const dark = (theme ?? "dark") === "dark";
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cleanup = build(el, dark) as any;
    return () => { if (typeof cleanup === "function") cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark, ...deps]);
  return ref;
}

const baseOpts = (dark: boolean, height: number) => ({
  layout: { background: { type: ColorType.Solid, color: "rgba(0,0,0,0)" }, textColor: dark ? "#c8cde0" : "#233047" },
  grid: {
    vertLines: { color: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" },
    horzLines: { color: dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)" },
  },
  rightPriceScale: { borderColor: dark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)" },
  timeScale:      { borderColor: dark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)", timeVisible: false },
  crosshair:      { mode: CrosshairMode.Normal },
  autoSize: true,
  height,
});

export function RsiChart({ bars, rsi14, height = 220 }: { bars: Bar[]; rsi14: NullableSeries; height?: number }) {
  const ref = useChart((el, dark) => {
    const chart = createChart(el, baseOpts(dark, height));
    const line = chart.addLineSeries({ color: "#8a5cff", lineWidth: 2, priceLineVisible: false });
    line.setData(
      bars.map((b, i) => ({ time: b.time as Time, value: rsi14[i] ?? undefined }))
        .filter((p): p is { time: Time; value: number } => p.value !== undefined),
    );
    // 30 / 70 horizontal reference lines.
    line.createPriceLine({ price: 30, color: "#7bd88f", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "OS" });
    line.createPriceLine({ price: 70, color: "#f0787a", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "OB" });
    chart.timeScale().fitContent();

    const detach = attachChartTooltip(chart, el, (param) => {
      const p = param.seriesData.get(line) as LineData | undefined;
      if (!p || !Number.isFinite(p.value)) return null;
      const zone =
        p.value >= 70 ? "Overbought" :
        p.value <= 30 ? "Oversold" :
                        "Neutral";
      const zoneColor =
        p.value >= 70 ? "#f0787a" :
        p.value <= 30 ? "#7bd88f" :
                        undefined;
      return [
        { label: "Date", value: fmtChartDate(param.time!), bold: true },
        { label: "RSI(14)", value: p.value.toFixed(2), color: "#8a5cff", bold: true },
        { label: "Zone", value: zone, color: zoneColor },
      ] satisfies TooltipRow[];
    });

    return () => { detach(); chart.remove(); };
  }, [bars, rsi14, height]);
  return <div ref={ref} style={{ width: "100%", height }} />;
}

export function MacdChart({ bars, macd, height = 220 }: { bars: Bar[]; macd: MacdResult; height?: number }) {
  const ref = useChart((el, dark) => {
    const chart = createChart(el, baseOpts(dark, height));
    const macdLine = chart.addLineSeries({ color: "#5b8def", lineWidth: 2, title: "MACD", priceLineVisible: false });
    const signal   = chart.addLineSeries({ color: "#e0b552", lineWidth: 2, title: "Signal", priceLineVisible: false });
    const hist     = chart.addHistogramSeries({ priceScaleId: "" });
    hist.priceScale().applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });

    const filter = (s: NullableSeries) => bars.map((b, i) => ({ time: b.time as Time, value: s[i] ?? undefined }))
      .filter((p): p is { time: Time; value: number } => p.value !== undefined);

    macdLine.setData(filter(macd.macd));
    signal.setData(filter(macd.signal));
    hist.setData(bars.map((b, i) => {
      const v = macd.histogram[i];
      return v === null || v === undefined
        ? { time: b.time as Time, value: 0, color: "rgba(0,0,0,0)" }
        : { time: b.time as Time, value: v, color: v >= 0 ? "#22c89666" : "#e0526366" };
    }));
    chart.timeScale().fitContent();

    const detach = attachChartTooltip(chart, el, (param) => {
      const m = param.seriesData.get(macdLine) as LineData | undefined;
      const s = param.seriesData.get(signal) as LineData | undefined;
      const h = param.seriesData.get(hist) as HistogramData | undefined;
      if (!m && !s && !h) return null;
      const rows: TooltipRow[] = [
        { label: "Date", value: fmtChartDate(param.time!), bold: true },
      ];
      if (m && Number.isFinite(m.value)) rows.push({ label: "MACD", value: fmtNumber(m.value, 3), color: "#5b8def" });
      if (s && Number.isFinite(s.value)) rows.push({ label: "Signal", value: fmtNumber(s.value, 3), color: "#e0b552" });
      if (h && Number.isFinite(h.value)) {
        rows.push({
          label: "Histogram",
          value: `${h.value >= 0 ? "+" : ""}${fmtNumber(h.value, 3)}`,
          color: h.value >= 0 ? "#22c896" : "#e05263",
        });
      }
      return rows;
    });

    return () => { detach(); chart.remove(); };
  }, [bars, macd, height]);
  return <div ref={ref} style={{ width: "100%", height }} />;
}

/**
 * KDJ oscillator (stochastic variant popular on Chinese platforms).
 *
 * - K (fast) and D (slow) always oscillate in [0, 100].
 * - J = 3K − 2D and can shoot beyond [0, 100]; it's a *leading* signal
 *   but also the twitchiest — hidden by default in Beginner mode so
 *   newcomers aren't fooled by whipsaws. Reference bands at 20/80.
 */
export function KdjChart({
  bars,
  kdj: kdjData,
  height = 220,
  showJ,
}: {
  bars: Bar[];
  kdj: KdjResult;
  height?: number;
  /** Override auto-detection — falsy hides J even for advanced users. */
  showJ?: boolean;
}) {
  const beginner = useIsBeginner();
  const includeJ = showJ !== undefined ? showJ : !beginner;

  const ref = useChart((el, dark) => {
    const chart = createChart(el, baseOpts(dark, height));
    const kLine = chart.addLineSeries({ color: "#5b8def", lineWidth: 2, title: "K", priceLineVisible: false });
    const dLine = chart.addLineSeries({ color: "#e0b552", lineWidth: 2, title: "D", priceLineVisible: false });
    const jLine = includeJ
      ? chart.addLineSeries({ color: "#c266d9", lineWidth: 1, title: "J", priceLineVisible: false })
      : null;

    const filter = (s: NullableSeries) =>
      bars.map((b, i) => ({ time: b.time as Time, value: s[i] ?? undefined }))
        .filter((p): p is { time: Time; value: number } => p.value !== undefined);

    kLine.setData(filter(kdjData.k));
    dLine.setData(filter(kdjData.d));
    if (jLine) jLine.setData(filter(kdjData.j));

    // Overbought / oversold reference lines at 80 / 20 — the KDJ
    // convention (RSI uses 70/30; the ranges differ because KDJ is
    // more range-normalised).
    kLine.createPriceLine({
      price: 20, color: "#7bd88f", lineStyle: LineStyle.Dashed, lineWidth: 1,
      axisLabelVisible: true, title: "OS",
    });
    kLine.createPriceLine({
      price: 80, color: "#f0787a", lineStyle: LineStyle.Dashed, lineWidth: 1,
      axisLabelVisible: true, title: "OB",
    });

    chart.timeScale().fitContent();

    const detach = attachChartTooltip(chart, el, (param) => {
      const kp = param.seriesData.get(kLine) as LineData | undefined;
      const dp = param.seriesData.get(dLine) as LineData | undefined;
      const jp = jLine ? (param.seriesData.get(jLine) as LineData | undefined) : undefined;
      if (!kp && !dp && !jp) return null;

      const rows: TooltipRow[] = [
        { label: "Date", value: fmtChartDate(param.time!), bold: true },
      ];
      if (kp && Number.isFinite(kp.value)) {
        const zone =
          kp.value >= 80 ? "Overbought" :
          kp.value <= 20 ? "Oversold" :
                           "Neutral";
        const zoneColor =
          kp.value >= 80 ? "#f0787a" :
          kp.value <= 20 ? "#7bd88f" :
                           undefined;
        rows.push({ label: "K", value: kp.value.toFixed(2), color: "#5b8def", bold: true });
        rows.push({ label: "Zone", value: zone, color: zoneColor });
      }
      if (dp && Number.isFinite(dp.value)) {
        rows.push({ label: "D", value: dp.value.toFixed(2), color: "#e0b552" });
      }
      if (jp && Number.isFinite(jp.value)) {
        rows.push({ label: "J", value: jp.value.toFixed(2), color: "#c266d9" });
      }
      return rows;
    });

    return () => { detach(); chart.remove(); };
  }, [bars, kdjData, height, includeJ]);
  return <div ref={ref} style={{ width: "100%", height }} />;
}

/** Simple histogram of daily returns — built with SVG (no lib dep). */
export function ReturnsHistogram({
  returns,
  bins = 30,
  height = 220,
}: {
  returns: NullableSeries;
  bins?: number;
  height?: number;
}) {
  const values = returns.filter((v): v is number => v !== null && Number.isFinite(v));
  if (values.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No returns to plot.</p>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 800;
  const padding = 32;
  const chartW = width - padding * 2;
  const chartH = height - padding;
  const step = span / bins;

  const counts = new Array(bins).fill(0) as number[];
  for (const v of values) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - min) / step)));
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  const maxCount = Math.max(...counts);
  const zeroX = padding + ((0 - min) / span) * chartW;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Daily returns histogram" className="w-full h-full">
      <line x1={padding} y1={height - padding / 2} x2={width - padding} y2={height - padding / 2} stroke="hsl(var(--border))" />
      {min < 0 && max > 0 && (
        <line x1={zeroX} y1={padding / 2} x2={zeroX} y2={height - padding / 2} stroke="hsl(var(--border))" strokeDasharray="3 3" />
      )}
      {counts.map((c, i) => {
        const x = padding + (i / bins) * chartW;
        const w = chartW / bins - 1;
        const h = (c / maxCount) * chartH;
        const y = height - padding / 2 - h;
        const binMid = min + step * (i + 0.5);
        const fill = binMid >= 0 ? "hsl(var(--success))" : "hsl(var(--danger))";
        return (
          <g key={i}>
            <title>{`${(binMid * 100).toFixed(2)}%\n${c} day${c === 1 ? "" : "s"}`}</title>
            <rect x={x} y={y} width={w} height={h} fill={fill} opacity={0.75} />
          </g>
        );
      })}
      <text x={padding} y={padding - 6} fontSize="10" fill="currentColor" opacity="0.6">
        min: {(min * 100).toFixed(2)}%
      </text>
      <text x={width - padding} y={padding - 6} fontSize="10" fill="currentColor" opacity="0.6" textAnchor="end">
        max: {(max * 100).toFixed(2)}%
      </text>
    </svg>
  );
}

/**
 * Support / Resistance chart: a compact close-price line with the
 * detected support and resistance levels overlaid as horizontal price
 * lines. Levels are labelled S1/S2/... (nearest support first) and
 * R1/R2/... (nearest resistance first) so the legend below can key off
 * the same labels.
 */
const SUPPORT_COLOR = "#22c896";
const RESISTANCE_COLOR = "#e05263";

export function SupportResistanceChart({
  bars,
  levels,
  height = 300,
}: {
  bars: Bar[];
  levels: SupportResistance;
  height?: number;
}) {
  const ref = useChart((el, dark) => {
    const chart = createChart(el, baseOpts(dark, height));
    const price = chart.addLineSeries({
      color: dark ? "#c8cde0" : "#233047",
      lineWidth: 2,
      priceLineVisible: true,
      title: "Close",
    });
    price.setData(bars.map((b) => ({ time: b.time as Time, value: b.close })));

    // Support: closest to current price first (S1, S2, …).
    levels.support.forEach((lvl, i) => {
      price.createPriceLine({
        price: lvl.price,
        color: SUPPORT_COLOR,
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        title: `S${i + 1}`,
      });
    });
    // Resistance: closest to current price first (R1, R2, …).
    levels.resistance.forEach((lvl, i) => {
      price.createPriceLine({
        price: lvl.price,
        color: RESISTANCE_COLOR,
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
        title: `R${i + 1}`,
      });
    });

    chart.timeScale().fitContent();

    const detach = attachChartTooltip(chart, el, (param) => {
      const p = param.seriesData.get(price) as LineData | undefined;
      if (!p || !Number.isFinite(p.value)) return null;
      const rows: TooltipRow[] = [
        { label: "Date", value: fmtChartDate(param.time!), bold: true },
        { label: "Close", value: fmtNumber(p.value), bold: true },
      ];
      // Show the nearest support / resistance relative to this bar's close.
      const nextRes = [...levels.resistance].sort((a, b) => a.price - b.price).find((l) => l.price > p.value);
      const nextSup = [...levels.support].sort((a, b) => b.price - a.price).find((l) => l.price < p.value);
      if (nextRes) {
        const dist = ((nextRes.price - p.value) / p.value) * 100;
        rows.push({
          label: "Next resistance",
          value: `${fmtNumber(nextRes.price)}  (+${dist.toFixed(2)}%)`,
          color: RESISTANCE_COLOR,
        });
      }
      if (nextSup) {
        const dist = ((p.value - nextSup.price) / p.value) * 100;
        rows.push({
          label: "Next support",
          value: `${fmtNumber(nextSup.price)}  (−${dist.toFixed(2)}%)`,
          color: SUPPORT_COLOR,
        });
      }
      return rows;
    });

    return () => { detach(); chart.remove(); };
  }, [bars, levels, height]);
  return <div ref={ref} style={{ width: "100%", height }} />;
}

/**
 * Compact table showing each detected level, its distance from the
 * current close, and how many pivots contributed to it. Complements
 * `SupportResistanceChart` — the chart shows *where*, the table shows
 * *how strong* and *how far*.
 */
export function SupportResistanceTable({
  bars,
  levels,
}: {
  bars: Bar[];
  levels: SupportResistance;
}) {
  if (bars.length === 0) return null;
  const lastClose = bars[bars.length - 1]!.close;

  const rows: Array<{
    label: string;
    color: string;
    price: number;
    distPct: number;
    touches: number;
    lastTouch: number;
  }> = [];
  levels.resistance.forEach((lvl, i) =>
    rows.push({
      label: `R${i + 1}`,
      color: RESISTANCE_COLOR,
      price: lvl.price,
      distPct: ((lvl.price - lastClose) / lastClose) * 100,
      touches: lvl.touches,
      lastTouch: lvl.lastTouch,
    }),
  );
  levels.support.forEach((lvl, i) =>
    rows.push({
      label: `S${i + 1}`,
      color: SUPPORT_COLOR,
      price: lvl.price,
      distPct: ((lvl.price - lastClose) / lastClose) * 100,
      touches: lvl.touches,
      lastTouch: lvl.lastTouch,
    }),
  );

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground p-2">
        Not enough price history to detect swing pivots yet.
      </p>
    );
  }

  return (
    <div className="w-full">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr className="border-b border-border/60">
            <th className="text-left font-medium py-1.5 pr-2">Level</th>
            <th className="text-right font-medium py-1.5 px-2">Price</th>
            <th className="text-right font-medium py-1.5 px-2">Distance</th>
            {/* Hide less-critical columns on the narrowest screens so the
                table never needs a horizontal scrollbar. */}
            <th className="text-right font-medium py-1.5 px-2 hidden sm:table-cell">Touches</th>
            <th className="text-right font-medium py-1.5 pl-2 hidden md:table-cell">Last touch</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-border/30 last:border-0">
              <td className="py-1.5 pr-2">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    style={{ background: r.color }}
                    className="inline-block h-2 w-2 rounded-sm"
                  />
                  {r.label}
                </span>
              </td>
              <td className="text-right py-1.5 px-2">{fmtNumber(r.price)}</td>
              <td
                className="text-right py-1.5 px-2"
                style={{ color: r.distPct >= 0 ? RESISTANCE_COLOR : SUPPORT_COLOR }}
              >
                {r.distPct >= 0 ? "+" : ""}
                {r.distPct.toFixed(2)}%
              </td>
              <td className="text-right py-1.5 px-2 hidden sm:table-cell">{r.touches}</td>
              <td className="text-right py-1.5 pl-2 text-muted-foreground hidden md:table-cell">
                {fmtChartDate(r.lastTouch as Time)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
