/**
 * Dynamic PWA icon endpoint.
 *
 * Why this exists: the app's manifest points at `/icons/icon-192.png`
 * and `/icons/icon-512.png` (plus maskable variants) but the repo
 * doesn't commit any binary PNG files. That's what was breaking
 * Chrome's "Install app" prompt — its installability check requires
 * BOTH the 192 and 512 icons declared in the manifest to fetch
 * successfully with the declared MIME type. A 404 on either silently
 * fails the check with no error to the user, which is exactly the
 * symptom we saw ("PWA install doesn't show").
 *
 * Rather than commit binary assets to the repo, we generate the
 * icons on demand via `next/og` (Satori under the hood). Advantages:
 *
 *   • No PNG files to check in — the design is code, so branding
 *     updates are a one-line change and diffs stay reviewable.
 *   • No new npm dep — `next/og` ships with Next.js 15.
 *   • The service worker's `/icons/*` cache-first branch (see
 *     `public/service-worker.js`) already treats these URLs as
 *     immutable, so we pay the render cost only on the very first
 *     fetch per installed PWA. All subsequent fetches (which the
 *     OS makes routinely for home-screen thumbnails, splash
 *     screens, notification badges, etc.) come out of the SW cache.
 *   • CDN caching via `Cache-Control` gives us an even earlier
 *     cache hit for users who share a CDN edge.
 *
 * URL scheme:
 *
 *   /icons/icon-192.png          →  192×192, purpose "any"
 *   /icons/icon-512.png          →  512×512, purpose "any"
 *   /icons/icon-maskable-192.png →  192×192, purpose "maskable"
 *   /icons/icon-maskable-512.png →  512×512, purpose "maskable"
 *
 * The `[icon]` dynamic segment captures the whole filename so we
 * can parse size + variant from one regex — a single route handler
 * covers all four endpoints without duplication.
 *
 * Maskable vs. any:
 *
 *   Maskable icons must keep their meaningful content inside the
 *   inner ~80% "safe zone" (the outer 10% on each side may be
 *   cropped by Android's mask). We honour this by widening the
 *   background padding to 20% for maskable variants — the "SA"
 *   monogram and the trend-line motif shrink accordingly so they
 *   survive any circular / squircle / rounded-rect mask a launcher
 *   might apply. See https://web.dev/articles/maskable-icon.
 */

import { ImageResponse } from "next/og";

export const runtime = "edge";
// Freshness: aggressive since the icon is content-addressable by
// its URL — a design change means a new commit, which means a new
// deploy, which means the CDN's cache entry is naturally busted.
//
// NB: this MUST be a numeric literal, not a binary expression.
// Next.js's segment-config extractor uses static analysis and
// rejects any computed value here with `Unsupported node type
// "BinaryExpression"`, which fails the production build.
// 2592000 = 30 days in seconds (60 * 60 * 24 * 30).
export const revalidate = 2592000;

// Filename pattern: icon-<size>.png OR icon-maskable-<size>.png.
// The `192|512` alternation gates us to the two sizes Chrome requires
// for install, so anyone poking around at `icon-64.png` gets an
// honest 404 rather than a phantom PNG.
const FILENAME_RE = /^icon(-maskable)?-(192|512)\.png$/;

// Brand palette — pulled from `public/manifest.webmanifest`. Kept
// in-sync manually because Next.js edge runtime can't read the
// filesystem at request time. If the manifest colours change,
// update these too.
const BG = "#0f1220";
const BG_ACCENT_1 = "#1e293b"; // subtle radial glow, top-left
const BG_ACCENT_2 = "#0ea5e9"; // brand cyan for the trend line
const FG = "#e2e8f0";          // soft-white text
const TREND_UP = "#22c55e";    // green candle

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ icon: string }> },
) {
  const { icon } = await params;
  const match = FILENAME_RE.exec(icon);
  if (!match) {
    return new Response("Not found", { status: 404 });
  }
  const isMaskable = !!match[1];
  const size = Number.parseInt(match[2]!, 10);

  // Maskable icons need a 20% inner safe zone. For "any" purpose
  // we can use the full canvas since we control the surrounding
  // chrome (the shortcut / dock badge doesn't crop us).
  const padPct = isMaskable ? 20 : 8;
  const inner = size - (size * padPct * 2) / 100;
  const fontSizeMono = inner * 0.42;
  const strokeThickness = Math.max(3, inner * 0.045);

  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
          background: BG,
          backgroundImage: `radial-gradient(circle at 30% 20%, ${BG_ACCENT_1} 0%, transparent 60%)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
        }}
      >
        {/* Inner "safe zone" content container — never renders
            anything outside this box so maskable crops don't lop
            off the branding. */}
        <div
          style={{
            width: inner,
            height: inner,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: inner * 0.05,
          }}
        >
          {/* "SA" monogram — the app's short_name is "Stock
              Analysis" so the two-letter mark reads clearly at
              favicon size too. */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              color: FG,
              fontSize: fontSizeMono,
              fontWeight: 800,
              letterSpacing: -fontSizeMono * 0.05,
              lineHeight: 1,
            }}
          >
            SA
          </div>
          {/* Small ascending "trend line" underneath — instantly
              telegraphs "this is a stock / markets app" without
              needing a full chart. Rendered as a row of coloured
              divs (satori's SVG support is limited enough that
              a div-based motif is more robust). */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: inner * 0.04,
              height: inner * 0.18,
              marginTop: inner * 0.02,
            }}
          >
            <div
              style={{
                width: strokeThickness,
                height: inner * 0.06,
                background: TREND_UP,
                opacity: 0.55,
                borderRadius: strokeThickness / 2,
              }}
            />
            <div
              style={{
                width: strokeThickness,
                height: inner * 0.10,
                background: TREND_UP,
                opacity: 0.75,
                borderRadius: strokeThickness / 2,
              }}
            />
            <div
              style={{
                width: strokeThickness,
                height: inner * 0.14,
                background: BG_ACCENT_2,
                borderRadius: strokeThickness / 2,
              }}
            />
            <div
              style={{
                width: strokeThickness,
                height: inner * 0.18,
                background: BG_ACCENT_2,
                borderRadius: strokeThickness / 2,
              }}
            />
          </div>
        </div>
      </div>
    ),
    {
      width: size,
      height: size,
      // Aggressive cache — the URL is fully-versioned by the
      // filename convention (any design change = new manifest URL
      // OR a service-worker cache bust via bump-service-worker.mjs),
      // so browsers and CDNs can hold on to these for a very long
      // time. `immutable` tells modern browsers not to fire a
      // conditional revalidation on subsequent renders.
      headers: {
        "Cache-Control": "public, max-age=2592000, s-maxage=2592000, immutable",
        // Redundant with `ImageResponse`'s own header, but explicit
        // is nice to grep for.
        "Content-Type": "image/png",
      },
    },
  );
}
