/**
 * Dynamic PWA screenshot endpoint.
 *
 * Why this exists: Chrome 108+ requires the `screenshots` array on
 * the web manifest to have at least one entry with
 * `form_factor: "wide"` (desktop) AND one without (mobile) before
 * it will show the "rich" install dialog — the one with a big
 * app-store-style preview that users actually notice. Without
 * screenshots you only get a tiny install icon buried in the URL
 * bar, which most users never spot. That's exactly the "why doesn't
 * install PWA show" symptom users report.
 *
 * We generate these on demand for the same reason `app/icons/[icon]`
 * does: keeps binary assets out of the repo, uses only built-in
 * Next.js primitives (`next/og`), and lives behind the service
 * worker's `/screenshots/*`-agnostic passthrough (screenshots
 * intentionally are NOT precached — they're only ever fetched
 * when a browser is deciding whether to show the install prompt,
 * so a fresh render every ~30 days via the CDN is fine).
 *
 * The generated images are DESIGN PLACEHOLDERS — brand-consistent
 * cards that show the app name and a short tagline on the same
 * dark palette as the icon. Replace them with real UI screenshots
 * later by (a) dropping a PNG at `public/screenshots/desktop.png`
 * / `public/screenshots/mobile.png` and (b) editing the manifest
 * to point at those static paths instead — the manifest's icons/
 * URL scheme is fully compatible with either dynamic or static
 * origins.
 *
 * URL scheme:
 *
 *   /screenshots/desktop.png  →  1920×1080, form_factor "wide"
 *   /screenshots/mobile.png   →   720×1280, form_factor "narrow"
 *
 * Anything else 404s. The regex gate is deliberately tight so the
 * route can't be abused to render arbitrary Satori content at
 * arbitrary resolutions.
 */

import { ImageResponse } from "next/og";

export const runtime = "edge";
// 30 days. Same rationale as `app/icons/[icon]` — see comment
// there for why this MUST be a numeric literal (segment-config
// static analysis rejects `60 * 60 * 24 * 30`).
export const revalidate = 2592000;

// Only these two filenames are served. Restricting up front means
// probes at `/screenshots/../secrets` land on 404 rather than the
// image renderer.
const KNOWN_SHOTS: Record<
  string,
  { width: number; height: number; orientation: "landscape" | "portrait" }
> = {
  "desktop.png": { width: 1920, height: 1080, orientation: "landscape" },
  "mobile.png":  { width:  720, height: 1280, orientation: "portrait"  },
};

// Brand palette — mirrored from `app/icons/[icon]/route.tsx` so
// the icon and screenshots feel like they came from the same
// design system. Keep these two files in sync if the brand shifts.
const BG = "#0f1220";
const BG_ACCENT_1 = "#1e293b";
const BG_ACCENT_2 = "#0ea5e9";
const FG = "#e2e8f0";
const FG_MUTED = "#94a3b8";
const CARD_BG = "#111827";
const CARD_BORDER = "#1e293b";
const TREND_UP = "#22c55e";
const TREND_DOWN = "#ef4444";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ shot: string }> },
) {
  const { shot } = await params;
  const meta = KNOWN_SHOTS[shot];
  if (!meta) {
    return new Response("Not found", { status: 404 });
  }

  const { width, height, orientation } = meta;
  const isPortrait = orientation === "portrait";
  // Scale a few key sizes with the smaller edge so mobile and
  // desktop layouts read at the same visual density.
  const unit = Math.min(width, height);
  const padding = unit * 0.06;
  const cardRadius = unit * 0.025;

  return new ImageResponse(
    (
      <div
        style={{
          width,
          height,
          background: BG,
          backgroundImage: `radial-gradient(circle at 20% 15%, ${BG_ACCENT_1} 0%, transparent 55%), radial-gradient(circle at 85% 90%, ${BG_ACCENT_2}22 0%, transparent 45%)`,
          display: "flex",
          flexDirection: "column",
          padding,
          gap: padding * 0.6,
          color: FG,
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Header — brand mark + app name. Same "SA" motif as
            the app icon, big enough to read on a Play-Store
            preview thumbnail. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: unit * 0.03,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: unit * 0.11,
              height: unit * 0.11,
              borderRadius: unit * 0.02,
              background: BG_ACCENT_1,
              border: `1px solid ${CARD_BORDER}`,
              color: FG,
              fontSize: unit * 0.055,
              fontWeight: 800,
              letterSpacing: -unit * 0.002,
            }}
          >
            SA
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                fontSize: unit * 0.045,
                fontWeight: 700,
                letterSpacing: -unit * 0.001,
              }}
            >
              Stock Analysis
            </div>
            <div
              style={{
                fontSize: unit * 0.022,
                color: FG_MUTED,
                marginTop: unit * 0.004,
              }}
            >
              Real-time signals · Paper trading · Alert bot
            </div>
          </div>
        </div>

        {/* Body — a row of mock "stat" cards on desktop, a stack
            on mobile. Each card shows a made-up ticker, price,
            and change, so the preview instantly reads as "a
            markets dashboard" rather than a generic screenshot.
            No real data is fetched — these are DESIGN
            placeholders. */}
        <div
          style={{
            display: "flex",
            flexDirection: isPortrait ? "column" : "row",
            gap: padding * 0.4,
            flex: 1,
          }}
        >
          {[
            { ticker: "AAPL", price: "$242.18", chg: "+1.24%", up: true },
            { ticker: "NVDA", price: "$168.44", chg: "+3.85%", up: true },
            { ticker: "TSLA", price: "$318.60", chg: "-2.11%", up: false },
          ].map((c) => (
            <div
              key={c.ticker}
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                flex: 1,
                background: CARD_BG,
                border: `1px solid ${CARD_BORDER}`,
                borderRadius: cardRadius,
                padding: unit * 0.03,
                gap: unit * 0.02,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <div
                  style={{
                    fontSize: unit * 0.032,
                    fontWeight: 700,
                    letterSpacing: 0.5,
                  }}
                >
                  {c.ticker}
                </div>
                <div
                  style={{
                    fontSize: unit * 0.02,
                    color: c.up ? TREND_UP : TREND_DOWN,
                    fontWeight: 600,
                  }}
                >
                  {c.chg}
                </div>
              </div>
              <div
                style={{
                  fontSize: unit * 0.045,
                  fontWeight: 700,
                  color: FG,
                }}
              >
                {c.price}
              </div>
              {/* Tiny mock sparkline — ascending bars on "up"
                  tickers, descending on "down". Communicates
                  "this app has charts" without needing satori
                  to render a real chart. */}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: unit * 0.004,
                  height: unit * 0.05,
                }}
              >
                {(c.up
                  ? [0.3, 0.4, 0.35, 0.55, 0.6, 0.75, 0.85, 1.0]
                  : [1.0, 0.9, 0.95, 0.8, 0.7, 0.6, 0.45, 0.4]
                ).map((h, i) => (
                  <div
                    key={i}
                    style={{
                      width: unit * 0.008,
                      height: unit * 0.05 * h,
                      background: c.up ? TREND_UP : TREND_DOWN,
                      opacity: 0.75,
                      borderRadius: unit * 0.002,
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer — quick feature callout so the screenshot
            preview doubles as a mini-billboard. */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            paddingTop: unit * 0.015,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: unit * 0.025,
              fontSize: unit * 0.018,
              color: FG_MUTED,
            }}
          >
            <span>Master Verdict</span>
            <span>·</span>
            <span>6-Signal Resonance</span>
            <span>·</span>
            <span>Telegram + Web Push</span>
          </div>
        </div>
      </div>
    ),
    {
      width,
      height,
      headers: {
        // 30-day cache: URL is content-addressable by filename,
        // and the placeholder design only changes when we deploy.
        "Cache-Control": "public, max-age=2592000, s-maxage=2592000, immutable",
        "Content-Type": "image/png",
      },
    },
  );
}
