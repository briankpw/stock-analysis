"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import {
  createChart,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type CandlestickData,
  type HistogramData,
  type LineData,
} from "lightweight-charts";
import type { Bar, BollingerBands, NullableSeries } from "@/lib/indicators";
import { useUi } from "@/lib/state";
import { fmtNumber, fmtVolume } from "@/lib/format";
import { attachChartTooltip, fmtChartDate, type TooltipRow } from "./chart-tooltip";

/**
 * Candlestick + volume + optional overlays. Uses TradingView's
 * lightweight-charts (~230kB minified) instead of Plotly to keep the
 * mobile bundle lean and rendering fast on modest hardware.
 */
export function PriceChart({
  bars,
  sma20,
  sma50,
  sma200,
  ema24,
  ema52,
  ema200,
  bb20,
  height = 480,
}: {
  bars: Bar[];
  sma20: NullableSeries;
  sma50: NullableSeries;
  sma200: NullableSeries;
  ema24: NullableSeries;
  ema52: NullableSeries;
  ema200: NullableSeries;
  bb20: BollingerBands;
  height?: number;
}) {
  const { theme } = useTheme();
  const dark = (theme ?? "dark") === "dark";
  const showSma = useUi((s) => s.showSma);
  const showEma = useUi((s) => s.showEma);
  const showBb = useUi((s) => s.showBb);

  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // ---- Theme-aware colors (matches CSS tokens) --------------------------
    const paperBg = "rgba(0,0,0,0)";
    const gridColor = dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
    const textColor = dark ? "#c8cde0" : "#233047";
    const upColor = dark ? "#22c896" : "#0f9d58";
    const downColor = dark ? "#e05263" : "#c33245";

    const chart: IChartApi = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: paperBg },
        textColor,
      },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      rightPriceScale: { borderColor: gridColor },
      timeScale: { borderColor: gridColor, timeVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
      autoSize: true,
      height,
    });

    // ---- Series ----------------------------------------------------------
    const candles: ISeriesApi<"Candlestick"> = chart.addCandlestickSeries({
      upColor,
      downColor,
      borderVisible: false,
      wickUpColor: upColor,
      wickDownColor: downColor,
    });
    candles.setData(bars.map((b) => ({
      time: b.time as Time,
      open: b.open, high: b.high, low: b.low, close: b.close,
    })));

    const volume: ISeriesApi<"Histogram"> = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "",
      color: dark ? "rgba(255,255,255,0.20)" : "rgba(0,0,0,0.15)",
    });
    // Move volume to a bottom overlay (20% of chart height).
    volume.priceScale().applyOptions({
      scaleMargins: { top: 0.75, bottom: 0 },
    });
    candles.priceScale().applyOptions({
      scaleMargins: { top: 0.05, bottom: 0.30 },
    });
    volume.setData(bars.map((b) => ({
      time: b.time as Time,
      value: b.volume,
      color: b.close >= b.open ? `${upColor}66` : `${downColor}66`,
    })));

    // ---- Overlays --------------------------------------------------------
    const lineData = (series: NullableSeries) =>
      bars.map((b, i) => ({ time: b.time as Time, value: series[i] ?? undefined }))
        .filter((p): p is { time: Time; value: number } => p.value !== undefined);

    const overlays: Array<{ label: string; color: string; series: ISeriesApi<"Line"> }> = [];
    if (showEma) {
      // Slightly thicker (lineWidth 2) because EMA is the primary overlay now.
      const e24 = chart.addLineSeries({ color: "#5b8def", lineWidth: 2, title: "EMA 24", lastValueVisible: false, priceLineVisible: false });
      e24.setData(lineData(ema24));
      overlays.push({ label: "EMA 24", color: "#5b8def", series: e24 });
      const e52 = chart.addLineSeries({ color: "#e0b552", lineWidth: 2, title: "EMA 52", lastValueVisible: false, priceLineVisible: false });
      e52.setData(lineData(ema52));
      overlays.push({ label: "EMA 52", color: "#e0b552", series: e52 });
      const e200 = chart.addLineSeries({ color: "#a45cd2", lineWidth: 2, title: "EMA 200", lastValueVisible: false, priceLineVisible: false });
      e200.setData(lineData(ema200));
      overlays.push({ label: "EMA 200", color: "#a45cd2", series: e200 });
    }

    if (showSma) {
      // When both families are on, the SMA lines render as dashed variants of
      // the same colour scale so they read as "the slower cousin" of the EMA.
      const s20 = chart.addLineSeries({ color: "#5b8def", lineWidth: 1, lineStyle: 2, title: "SMA 20", lastValueVisible: false, priceLineVisible: false });
      s20.setData(lineData(sma20));
      overlays.push({ label: "SMA 20", color: "#5b8def", series: s20 });
      const s50 = chart.addLineSeries({ color: "#e0b552", lineWidth: 1, lineStyle: 2, title: "SMA 50", lastValueVisible: false, priceLineVisible: false });
      s50.setData(lineData(sma50));
      overlays.push({ label: "SMA 50", color: "#e0b552", series: s50 });
      const s200 = chart.addLineSeries({ color: "#a45cd2", lineWidth: 1, lineStyle: 2, title: "SMA 200", lastValueVisible: false, priceLineVisible: false });
      s200.setData(lineData(sma200));
      overlays.push({ label: "SMA 200", color: "#a45cd2", series: s200 });
    }

    if (showBb) {
      const up = chart.addLineSeries({ color: "#7bd88f", lineWidth: 1, title: "BB upper", lastValueVisible: false, priceLineVisible: false });
      up.setData(lineData(bb20.upper));
      overlays.push({ label: "BB upper", color: "#7bd88f", series: up });
      const mid = chart.addLineSeries({ color: "#6ea8fe", lineWidth: 1, title: "BB middle", lastValueVisible: false, priceLineVisible: false });
      mid.setData(lineData(bb20.middle));
      overlays.push({ label: "BB middle", color: "#6ea8fe", series: mid });
      const lo = chart.addLineSeries({ color: "#f0787a", lineWidth: 1, title: "BB lower", lastValueVisible: false, priceLineVisible: false });
      lo.setData(lineData(bb20.lower));
      overlays.push({ label: "BB lower", color: "#f0787a", series: lo });
    }

    chart.timeScale().fitContent();

    // ---- Floating tooltip ------------------------------------------------
    const detachTooltip = attachChartTooltip(chart, el, (param) => {
      const c = param.seriesData.get(candles) as CandlestickData | undefined;
      if (!c) return null;
      const v = param.seriesData.get(volume) as HistogramData | undefined;
      const change = c.close - c.open;
      const changePct = c.open ? (change / c.open) * 100 : 0;
      const changeStr = `${change >= 0 ? "+" : ""}${fmtNumber(change)} (${change >= 0 ? "+" : ""}${changePct.toFixed(2)}%)`;
      const rows: TooltipRow[] = [
        { label: "Date", value: fmtChartDate(param.time!), bold: true },
        { label: "Open", value: fmtNumber(c.open) },
        { label: "High", value: fmtNumber(c.high) },
        { label: "Low", value: fmtNumber(c.low) },
        { label: "Close", value: fmtNumber(c.close), bold: true },
        { label: "Change", value: changeStr, color: change >= 0 ? upColor : downColor },
      ];
      if (v) rows.push({ label: "Volume", value: fmtVolume(v.value) });
      for (const o of overlays) {
        const p = param.seriesData.get(o.series) as LineData | undefined;
        if (p && Number.isFinite(p.value)) {
          rows.push({ label: o.label, value: fmtNumber(p.value), color: o.color });
        }
      }
      return rows;
    });

    return () => {
      detachTooltip();
      chart.remove();
    };
  }, [bars, sma20, sma50, sma200, ema24, ema52, ema200, bb20, height, dark, showSma, showEma, showBb]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}
