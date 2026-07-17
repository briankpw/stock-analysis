"use client";

import * as React from "react";
import { useLocale, type Locale } from "@/lib/state";
import { translate } from "./dict";

export type { Locale } from "@/lib/state";
export { DICT, translate } from "./dict";
export { translateSignalValue } from "./signals";
export type { SignalKind } from "./signals";

/**
 * The core i18n hook. Returns a `t()` function bound to the current
 * locale in the zustand store, so components re-render automatically
 * when the user switches languages.
 *
 * Usage:
 *   const t = useT();
 *   t("nav.overview")                  // "Overview" or "概览"
 *   t("news.countBullish", { n: 4 })   // "4 bullish" or "4 条多头"
 */
export function useT(): (
  key: string,
  params?: Record<string, string | number>,
) => string {
  const locale = useLocale();
  return React.useCallback(
    (key, params) => translate(key, locale, params),
    [locale],
  );
}

/**
 * Non-hook helper for callers already holding a locale (e.g. bulk-rendered
 * lists that receive the locale via prop drilling in the same render).
 */
export function tFor(locale: Locale) {
  return (key: string, params?: Record<string, string | number>) =>
    translate(key, locale, params);
}
