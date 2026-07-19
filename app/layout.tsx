import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { headers } from "next/headers";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/app-shell";


export const metadata: Metadata = {
  title: "Stock Analysis",
  description:
    "Interactive stock analysis dashboard — ratios, charts, technicals, news sentiment, portfolios, paper trading, and alert bot.",
  applicationName: "Stock Analysis",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Stock Analysis" },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0f1220",
  width: "device-width",
  initialScale: 1,
  // Allow the user to pinch-zoom (up to 5x). WCAG 2.1 SC 1.4.4 requires
  // users to be able to resize text — disabling `userScalable` fails that.
  // The layout still feels app-like because the CSS handles safe-area
  // padding and no-horizontal-scroll; blocking scale isn't the win.
  maximumScale: 5,
  userScalable: true,
  // Extend the background into the iOS safe area (notch / home indicator).
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // `middleware.ts` sets a per-request CSP nonce and mirrors it onto
  // the `x-nonce` request header (see `passThrough` there). We read
  // it here so every inline script the app emits — currently just
  // `next-themes`' FOUC guard and Next.js's own hydration bootstrap —
  // can be nonced under `'strict-dynamic'`, keeping the CSP strict
  // in production without breaking themes or hydration.
  //
  // The header is absent for the tiny handful of static-asset
  // requests that bypass middleware (see IGNORED_PREFIXES). Those
  // don't render script, so an empty nonce is fine — the `nonce=""`
  // attribute just doesn't match anything and browsers ignore it.
  const nonce = (await headers()).get("x-nonce") ?? "";
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <Providers nonce={nonce}>
          {/* AppShell is a client wrapper so the grid template can react
              to the persisted `sidebarDesktopCollapsed` preference —
              layout.tsx itself stays a Server Component (required for
              metadata + <html lang>). */}
          <AppShell>{children}</AppShell>
        </Providers>
        {/*
          Service-worker registrar. Externalised to /public/sw-register.js
          (a static file) so we don't need `script-src 'unsafe-inline'`
          in the production CSP. `next/script` with a `src` still gives us
          the `afterInteractive` load strategy without inlining anything.
        */}
        <Script
          src="/sw-register.js"
          strategy="afterInteractive"
          nonce={nonce}
        />
      </body>
    </html>
  );
}
