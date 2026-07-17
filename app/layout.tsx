import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Sidebar } from "@/components/sidebar";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <Providers>
          <div className="lg:grid lg:grid-cols-[18rem_1fr] min-h-screen w-full max-w-full">
            <Sidebar />
            <main className="app-main min-w-0 max-w-full py-6 lg:py-8">
              {children}
            </main>
          </div>
        </Providers>
        {/*
          Service-worker registrar. Using next/script keeps the app CSP-clean
          because Next.js emits it as a hashed inline script during build,
          rather than the raw `dangerouslySetInnerHTML` bag of characters.
        */}
        <Script id="sw-register" strategy="afterInteractive">
          {`if ('serviceWorker' in navigator) {
              window.addEventListener('load', function () {
                navigator.serviceWorker.register('/service-worker.js').catch(function () {});
              });
            }`}
        </Script>
      </body>
    </html>
  );
}
