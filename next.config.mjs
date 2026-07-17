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
    // A pragmatic CSP for a same-origin Next.js dashboard:
    //  * default-src 'self'   — nothing loads from third parties by default
    //  * script-src 'self' 'unsafe-inline'  — Next.js emits some inline
    //    scripts for hydration/routing; keep 'unsafe-inline' unless we
    //    later add nonces (blocked on Next 15.2+ headers().nonce)
    //  * connect-src 'self'   — the only network egress from the browser
    //    is /api/*. External data sources go through server routes.
    //  * img-src 'self' data: blob:   — allow inline SVG data URIs and
    //    canvas exports used by lightweight-charts
    //  * frame-ancestors 'none'  — this app is never meant to be iframed
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");

    const securityHeaders = [
      { key: "Content-Security-Policy", value: csp },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
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
      // Apply the security-hardening headers to every page + API route.
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
