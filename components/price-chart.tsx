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
} from "lightweight-charts";
import type { Bar, BollingerBands, NullableSeries } from "@/lib/indicators";
import { useUi } from "@/lib/state";

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
  bb20,
  height = 480,
}: {
  bars: Bar[];
  sma20: NullableSeries;
  sma50: NullableSeries;
  sma200: NullableSeries;
  bb20: BollingerBands;
  height?: number;
}) {
  const { theme } = useTheme();
  const dark = (theme ?? "dark") === "dark";
  const showSma = useUi((s) => s.showSma);
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

    if (showSma) {
      const s20 = chart.addLineSeries({ color: "#5b8def", lineWidth: 1, title: "SMA 20", lastValueVisible: false, priceLineVisible: false });
      s20.setData(lineData(sma20));
      const s50 = chart.addLineSeries({ color: "#e0b552", lineWidth: 1, title: "SMA 50", lastValueVisible: false, priceLineVisible: false });
      s50.setData(lineData(sma50));
      const s200 = chart.addLineSeries({ color: "#a45cd2", lineWidth: 1, title: "SMA 200", lastValueVisible: false, priceLineVisible: false });
      s200.setData(lineData(sma200));
    }

    if (showBb) {
      const up = chart.addLineSeries({ color: "#7bd88f", lineWidth: 1, title: "BB upper", lastValueVisible: false, priceLineVisible: false });
      up.setData(lineData(bb20.upper));
      const mid = chart.addLineSeries({ color: "#6ea8fe", lineWidth: 1, title: "BB middle", lastValueVisible: false, priceLineVisible: false });
      mid.setData(lineData(bb20.middle));
      const lo = chart.addLineSeries({ color: "#f0787a", lineWidth: 1, title: "BB lower", lastValueVisible: false, priceLineVisible: false });
      lo.setData(lineData(bb20.lower));
    }

    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [bars, sma20, sma50, sma200, bb20, height, dark, showSma, showBb]);

  return <div ref={containerRef} style={{ width: "100%", height }} />;
}
