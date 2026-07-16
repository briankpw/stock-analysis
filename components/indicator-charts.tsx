"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import {
  createChart, ColorType, CrosshairMode, LineStyle, type Time,
} from "lightweight-charts";
import type { Bar, MacdResult, NullableSeries } from "@/lib/indicators";

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
    return () => chart.remove();
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
    return () => chart.remove();
  }, [bars, macd, height]);
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
        return <rect key={i} x={x} y={y} width={w} height={h} fill={fill} opacity={0.75} />;
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
