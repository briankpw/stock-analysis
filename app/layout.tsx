import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Sidebar } from "@/components/sidebar";

export const metadata: Metadata = {
  title: "Key Stock — Keysight Analysis",
  description:
    "Interactive stock analysis dashboard for Keysight Technologies (KEYS) — ratios, charts, technicals, news sentiment, paper trading, and alert bot.",
  applicationName: "Key Stock",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Key Stock" },
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
  // Lock the layout on mobile: no pinch-zoom, no user-driven scale so
  // the app feels like a native shell instead of a scaled webpage.
  maximumScale: 1,
  userScalable: false,
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
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/service-worker.js').catch(() => {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
