/**
 * Client-side UI state (zustand). Persisted to localStorage under
 * `key-stock-ui` so page reloads keep the user's selections.
 *
 * We deliberately don't persist to a server session — this app runs
 * single-user by default, and cross-device sync isn't a goal.
 */

"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ExperienceLevel = "beginner" | "advanced";
export type Locale = "en" | "zh-CN";

interface UiState {
  ticker: string;
  level: ExperienceLevel;
  locale: Locale;
  period: string;
  interval: string;
  /** SMA 20/50/200 chart overlay. Off by default; users can turn it on. */
  showSma: boolean;
  /** EMA 24/52/200 chart overlay. On by default — this is now the primary MA family. */
  showEma: boolean;
  /** Bollinger Bands (20, 2σ) chart overlay. Off by default. */
  showBb: boolean;
  /**
   * Desktop-only "hide the sidebar" preference. When true, the persistent
   * sidebar column collapses off-screen at the `lg:` breakpoint and a
   * floating expand button takes its place — mirroring the mobile
   * drawer/hamburger interaction so wide-screen users can also reclaim
   * the horizontal space. Persisted so the choice survives reloads.
   * Ignored below `lg:` (mobile always uses the drawer + hamburger).
   */
  sidebarDesktopCollapsed: boolean;

  setTicker: (t: string) => void;
  setLevel: (l: ExperienceLevel) => void;
  setLocale: (l: Locale) => void;
  setPeriod: (p: string) => void;
  setInterval: (i: string) => void;
  toggleSma: () => void;
  toggleEma: () => void;
  toggleBb: () => void;
  toggleSidebarDesktopCollapsed: () => void;
  setSidebarDesktopCollapsed: (v: boolean) => void;
}

// Persistence schema version. Bump whenever the *default* value of a
// persisted field changes and existing users should be migrated to the new
// default. Handled below in `persist({ version, migrate })`.
const PERSIST_VERSION = 1;

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      ticker: "KEYS",
      level: "beginner",
      locale: "en",
      period: "1y",
      interval: "1d",
      showSma: false,
      showEma: true,
      showBb: false,
      sidebarDesktopCollapsed: false,

      setTicker: (ticker) => set({ ticker: ticker.toUpperCase() }),
      setLevel: (level) => set({ level }),
      setLocale: (locale) => set({ locale }),
      setPeriod: (period) => set({ period }),
      setInterval: (interval) => set({ interval }),
      toggleSma: () => set((s) => ({ showSma: !s.showSma })),
      toggleEma: () => set((s) => ({ showEma: !s.showEma })),
      toggleBb: () => set((s) => ({ showBb: !s.showBb })),
      toggleSidebarDesktopCollapsed: () =>
        set((s) => ({ sidebarDesktopCollapsed: !s.sidebarDesktopCollapsed })),
      setSidebarDesktopCollapsed: (v) => set({ sidebarDesktopCollapsed: v }),
    }),
    {
      name: "key-stock-ui",
      version: PERSIST_VERSION,
      // v0 -> v1: EMA 24/52/200 became the primary moving-average overlay and
      // SMA switched to opt-in. Force these two defaults for users upgrading
      // from a pre-v1 persisted store so they see the new chart out of the
      // box; every other field (ticker, period, level, locale, showBb) is
      // preserved as-is.
      migrate: (persistedState, version) => {
        const s = (persistedState ?? {}) as Partial<UiState>;
        if (version < 1) {
          return { ...s, showSma: false, showEma: true } as UiState;
        }
        return s as UiState;
      },
    },
  ),
);

export const useLevel = () => useUi((s) => s.level);
export const useIsBeginner = () => useUi((s) => s.level === "beginner");
export const useTicker = () => useUi((s) => s.ticker);
export const useLocale = () => useUi((s) => s.locale);
