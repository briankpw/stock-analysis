import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
    ];
  },
};

export default nextConfig;
