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
  showSma: boolean;
  showBb: boolean;

  setTicker: (t: string) => void;
  setLevel: (l: ExperienceLevel) => void;
  setLocale: (l: Locale) => void;
  setPeriod: (p: string) => void;
  setInterval: (i: string) => void;
  toggleSma: () => void;
  toggleBb: () => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      ticker: "KEYS",
      level: "beginner",
      locale: "en",
      period: "1y",
      interval: "1d",
      showSma: true,
      showBb: false,

      setTicker: (ticker) => set({ ticker: ticker.toUpperCase() }),
      setLevel: (level) => set({ level }),
      setLocale: (locale) => set({ locale }),
      setPeriod: (period) => set({ period }),
      setInterval: (interval) => set({ interval }),
      toggleSma: () => set((s) => ({ showSma: !s.showSma })),
      toggleBb: () => set((s) => ({ showBb: !s.showBb })),
    }),
    { name: "key-stock-ui" },
  ),
);

export const useLevel = () => useUi((s) => s.level);
export const useIsBeginner = () => useUi((s) => s.level === "beginner");
export const useTicker = () => useUi((s) => s.ticker);
export const useLocale = () => useUi((s) => s.locale);
