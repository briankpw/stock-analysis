/**
 * Client-side state for the Portfolios module — shared between the
 * sidebar (which hosts the preset rail) and the /portfolios page (which
 * hosts the detail view). Kept separate from `lib/state.ts` because
 * these fields are only meaningful inside Portfolio mode.
 *
 * Only user preferences (`prefs`) persist to localStorage. `selection`
 * and `addDialogCategory` are ephemeral session state.
 */

"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type Category = "people" | "politicians" | "funds";
export interface Selection {
  category: Category;
  id: string;
}

export type SortMode = "default" | "alpha";

export interface RailPrefs {
  order: Category[];
  collapsed: Partial<Record<Category, boolean>>;
  sort: Partial<Record<Category, SortMode>>;
  /** Newest first. Bounded to `RECENT_LIMIT` entries. */
  recent: Selection[];
}

export const RECENT_LIMIT = 5;

const DEFAULT_PREFS: RailPrefs = {
  order: ["people", "politicians", "funds"],
  collapsed: {},
  sort: {},
  recent: [],
};

interface PortfoliosState {
  selection: Selection | null;
  addDialogCategory: Category | null;
  prefs: RailPrefs;

  setSelection: (sel: Selection | null) => void;
  /** Set selection AND push into the recent-viewed history (dedup + trim). */
  recordViewed: (sel: Selection) => void;
  updatePrefs: (updater: (prev: RailPrefs) => RailPrefs) => void;
  setAddDialogCategory: (c: Category | null) => void;
  /** Drop `id` from recents (used after a delete). */
  forgetRecent: (category: Category, id: string) => void;
}

export const usePortfolios = create<PortfoliosState>()(
  persist(
    (set, get) => ({
      selection: null,
      addDialogCategory: null,
      prefs: DEFAULT_PREFS,

      setSelection: (selection) => set({ selection }),

      recordViewed: (sel) => {
        const { prefs } = get();
        const filtered = prefs.recent.filter(
          (s) => !(s.category === sel.category && s.id === sel.id),
        );
        set({
          selection: sel,
          prefs: {
            ...prefs,
            recent: [sel, ...filtered].slice(0, RECENT_LIMIT),
          },
        });
      },

      updatePrefs: (updater) =>
        set((state) => ({ prefs: updater(state.prefs) })),

      setAddDialogCategory: (addDialogCategory) => set({ addDialogCategory }),

      forgetRecent: (category, id) =>
        set((state) => ({
          prefs: {
            ...state.prefs,
            recent: state.prefs.recent.filter(
              (s) => !(s.category === category && s.id === id),
            ),
          },
        })),
    }),
    {
      name: "portfolios:v1",
      storage: createJSONStorage(() => localStorage),
      // Only persist user prefs — selection + dialog state are ephemeral.
      partialize: (state) => ({ prefs: state.prefs }),
      // Backfill any missing order categories after schema evolution.
      merge: (persistedState, currentState) => {
        const p = (persistedState ?? {}) as Partial<PortfoliosState>;
        const validCats = new Set<Category>(["people", "politicians", "funds"]);
        const persistedPrefs = p.prefs ?? DEFAULT_PREFS;
        const order: Category[] = Array.isArray(persistedPrefs.order)
          ? persistedPrefs.order.filter((c): c is Category => validCats.has(c as Category))
          : [];
        for (const c of DEFAULT_PREFS.order) if (!order.includes(c)) order.push(c);
        return {
          ...currentState,
          prefs: {
            order,
            collapsed: persistedPrefs.collapsed ?? {},
            sort: persistedPrefs.sort ?? {},
            recent: Array.isArray(persistedPrefs.recent)
              ? persistedPrefs.recent.filter(
                  (s): s is Selection =>
                    !!s && typeof s === "object" &&
                    validCats.has((s as Selection).category) &&
                    typeof (s as Selection).id === "string",
                )
              : [],
          },
        };
      },
    },
  ),
);
