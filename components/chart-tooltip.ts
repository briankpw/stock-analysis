import type { IChartApi, MouseEventParams, Time } from "lightweight-charts";

/** One line in the tooltip: label on the left, value on the right. */
export interface TooltipRow {
  label: string;
  value: string;
  /** Optional colour swatch shown next to the label. */
  color?: string;
  /** Render the value in bold (used for the primary field on each chart). */
  bold?: boolean;
}

/**
 * Attach a floating HTML tooltip to a lightweight-charts instance.
 *
 * Instead of using the library's built-in axis crosshair labels only, we
 * render a small glass panel near the cursor with every visible series
 * at that timestamp. `render` receives the crosshair event and returns
 * the rows to display, or `null` to hide the tooltip.
 *
 * Returned function detaches the listener and removes the DOM element.
 */
export function attachChartTooltip(
  chart: IChartApi,
  container: HTMLElement,
  render: (param: MouseEventParams) => TooltipRow[] | null,
): () => void {
  const el = document.createElement("div");
  el.setAttribute("role", "tooltip");
  el.style.cssText = `
    position: absolute;
    z-index: 20;
    pointer-events: none;
    display: none;
    background: hsl(var(--card));
    color: hsl(var(--foreground));
    border: 1px solid hsl(var(--border));
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 11px;
    line-height: 1.45;
    box-shadow: 0 4px 20px rgba(0,0,0,0.35);
    min-width: 160px;
    font-variant-numeric: tabular-nums;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  `;
  const prevPos = container.style.position;
  if (!prevPos) container.style.position = "relative";
  container.appendChild(el);

  const handler = (param: MouseEventParams) => {
    if (!param.point || param.time === undefined) {
      el.style.display = "none";
      return;
    }
    const rows = render(param);
    if (!rows || rows.length === 0) {
      el.style.display = "none";
      return;
    }
    el.innerHTML = rows
      .map((r) => {
        const swatch = r.color
          ? `<span style="display:inline-block;width:8px;height:8px;background:${r.color};border-radius:2px;margin-right:6px;vertical-align:middle;"></span>`
          : "";
        const valStyle = r.bold ? "font-weight:600;" : "";
        return `<div style="display:flex;justify-content:space-between;gap:14px;">
          <span style="opacity:0.75;white-space:nowrap;">${swatch}${escape(r.label)}</span>
          <span style="${valStyle}white-space:nowrap;">${escape(r.value)}</span>
        </div>`;
      })
      .join("");
    el.style.display = "block";

    // Clamp the tooltip inside the container.
    const w = container.clientWidth;
    const h = container.clientHeight;
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    const pad = 12;
    let x = param.point.x + pad;
    let y = param.point.y + pad;
    if (x + tw + pad > w) x = param.point.x - tw - pad;
    if (y + th + pad > h) y = param.point.y - th - pad;
    x = Math.max(4, x);
    y = Math.max(4, y);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };

  chart.subscribeCrosshairMove(handler);

  return () => {
    chart.unsubscribeCrosshairMove(handler);
    el.remove();
  };
}

/** Convert a lightweight-charts `Time` into a human-readable date. */
export function fmtChartDate(time: Time): string {
  const secs =
    typeof time === "number"
      ? time
      : typeof time === "string"
        ? Date.parse(time) / 1000
        : // BusinessDay
          Date.UTC(
            (time as { year: number }).year,
            (time as { month: number }).month - 1,
            (time as { day: number }).day,
          ) / 1000;
  const d = new Date(secs * 1000);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

/** Minimal HTML escaper — we control the values so this is defence in depth. */
function escape(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );
}
