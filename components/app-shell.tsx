"use client";

/**
 * AppShell — the root layout wrapper that owns the Sidebar / Main split.
 *
 * Extracted from `app/layout.tsx` (a Server Component) so we can drive the
 * layout grid from client state — specifically, `sidebarDesktopCollapsed`.
 * When the user collapses the sidebar on desktop, the two-column grid
 * degrades to a single full-width column and the sidebar itself
 * translates off-screen; a floating expand button (rendered inside
 * `<Sidebar />`) puts it back.
 *
 * Kept intentionally thin: no data fetching, no side effects. The only
 * client-side concern is reading the collapse flag from the persisted
 * UI store. On the initial SSR render `sidebarDesktopCollapsed` is
 * always `false` (zustand persist rehydrates on mount), which happens
 * to be the sensible default anyway — the sidebar stays visible until
 * the client explicitly opts out.
 */

import * as React from "react";
import { Sidebar } from "@/components/sidebar";
import { useUi } from "@/lib/state";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const collapsed = useUi((s) => s.sidebarDesktopCollapsed);
  return (
    <div
      className={cn(
        "min-h-screen w-full max-w-full",
        // On lg+ we always use a two-column grid — dropping to `block`
        // instead would force the sticky sidebar above the main content
        // in the flow. What we DO drop is the reserved column width:
        // when the user collapses, the first track becomes 0, the
        // sidebar (`w-72` + `lg:sticky`) slides off-screen via its own
        // `-translate-x-full`, and the second (1fr) column takes the
        // full viewport width instead of splitting it.
        "lg:grid",
        collapsed ? "lg:grid-cols-[0_1fr]" : "lg:grid-cols-[18rem_1fr]",
      )}
    >
      <Sidebar />
      <main className="app-main min-w-0 max-w-full py-6 lg:py-8">
        {children}
      </main>
    </div>
  );
}
