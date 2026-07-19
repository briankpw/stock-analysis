import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output emits `.next/standalone/server.js` — a self-contained
  // Node entrypoint bundled with only the deps the app actually needs at
  // runtime. Combined with `.next/static` + `public/`, this is all the
  // Docker runner stage has to ship: no `node_modules`, no dev deps, no
  // TypeScript sources. Slashes final image size roughly 5x.
  output: "standalone",
  // Hide the small "N" dev-mode indicator that Next.js overlays in the
  // bottom-left of every page. We already show our own header/logo, so the
  // extra chrome is just visual noise.
  devIndicators: false,
  // Pin the workspace root so a stray parent lockfile (e.g. one in $HOME) doesn't
  // confuse Next.js's monorepo detection.
  outputFileTracingRoot: __dirname,
  // `better-sqlite3` and `yahoo-finance2` are native / server-only modules that
  // must not be bundled into the client build. Next.js already keeps API-route
  // and server-component imports server-side, but this belt-and-braces prevents
  // accidental client-side inclusion via shared utilities.
  serverExternalPackages: ["better-sqlite3", "yahoo-finance2"],
  experimental: {
    // Turbopack works fine for us; keep the default (webpack in prod build).
  },
  // Correct MIME types + long cache for PWA assets (the Streamlit rewrite was
  // partly triggered by our old MIME-type problems \u2014 Next.js handles this
  // natively, but we harden it here anyway).
  async headers() {
    // Content-Security-Policy is set **per-request** in `middleware.ts`
    // because it embeds a fresh nonce for each response
    // (`'nonce-<n>' 'strict-dynamic'`). Doing so here would give
    // every response the same static nonce, which is worse than no
    // nonce at all — an attacker could copy it into an injected
    // inline script.
    //
    // Strict-Transport-Security is likewise middleware-owned so it
    // ships alongside the CSP as a coherent security-headers layer.
    //
    // Everything below is safe to declare statically because it
    // doesn't depend on per-request state:
    //   * X-Content-Type-Options — MIME-sniff hardening.
    //   * Referrer-Policy — strip URL query on cross-origin nav.
    //   * X-Frame-Options — clickjacking defence (mirrors CSP
    //     frame-ancestors).
    //   * Permissions-Policy — turns off browser features we never
    //     use so third-party subresources can't opt themselves in.
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      // `SAMEORIGIN` (not `DENY`) matches the CSP `frame-ancestors
      // 'self'` set in middleware — same rationale. `DENY` would
      // forbid even the app iframing its own PDF proxy, which
      // breaks the politician filings preview. `SAMEORIGIN` still
      // hard-blocks cross-site clickjacking, which is the only real
      // threat here.
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
      },
    ];

    return [
      {
        source: "/service-worker.js",
        headers: [
          { key: "Content-Type", value: "text/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
        ],
      },
      {
        source: "/icons/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      // Apply the security-hardening headers to every page + API
      // route. `frame-ancestors 'self'` / `X-Frame-Options:
      // SAMEORIGIN` intentionally permit same-origin iframing so
      // the /portfolios PDF proxy can be embedded by the app's own
      // filings preview — see the comment on `securityHeaders`
      // above for the full rationale.
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
