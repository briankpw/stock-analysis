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
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <Providers>
          <div className="lg:grid lg:grid-cols-[18rem_1fr] min-h-screen">
            <Sidebar />
            <main className="min-w-0 px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
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
