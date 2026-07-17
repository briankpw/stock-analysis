/**
 * Locale-aware translation of the runtime signal strings produced by
 * `lib/indicators.ts::latestSignals`. Those strings live on the wire as
 * English (e.g. "Bullish uptrend", "Overbought (72.3)") — the mood classifier
 * in the Overview page still keys off the English text, so we intentionally
 * do NOT change the raw values; instead the client passes them through this
 * function whenever they need to be *displayed*.
 */

import type { Locale } from "@/lib/state";

export type SignalKind = "trend" | "rsi" | "macd" | "bollinger";

/**
 * Return a localized version of a raw signal string, or the original if we
 * don't have a translation for the exact form (unknown values fall through
 * so nothing ever renders as an empty tile).
 */
export function translateSignalValue(
  kind: SignalKind,
  raw: string,
  locale: Locale,
): string {
  if (locale === "en" || !raw) return raw;

  switch (kind) {
    case "trend":
      return TREND_MAP[locale]?.[raw] ?? raw;

    case "macd":
      return MACD_MAP[locale]?.[raw] ?? raw;

    case "bollinger":
      return BB_MAP[locale]?.[raw] ?? raw;

    case "rsi": {
      // Values look like "Overbought (72.3)" / "Oversold (25.1)" /
      // "Neutral (54.0)" / "n/a".
      if (raw === "n/a") return RSI_LEXICON[locale]?.["n/a"] ?? raw;
      const m = raw.match(/^([A-Za-z]+)\s*\(([^)]+)\)\s*$/);
      if (!m) return raw;
      const [, word, number] = m;
      const localizedWord = RSI_LEXICON[locale]?.[word!] ?? word!;
      return `${localizedWord} (${number})`;
    }

    default:
      return raw;
  }
}

// ---- Static maps ---------------------------------------------------------

type LocaleMap = Partial<Record<Locale, Record<string, string>>>;

const TREND_MAP: LocaleMap = {
  "zh-CN": {
    "Bullish uptrend":   "多头上升趋势",
    "Bearish downtrend": "空头下降趋势",
    Sideways:            "横盘整理",
  },
};

const MACD_MAP: LocaleMap = {
  "zh-CN": {
    Bullish: "多头",
    Bearish: "空头",
    Flat:    "持平",
  },
};

const BB_MAP: LocaleMap = {
  "zh-CN": {
    "Price above upper band": "价格突破上轨",
    "Price below lower band": "价格跌破下轨",
    "Inside bands":           "位于通道内",
    "—":                       "—",
  },
};

const RSI_LEXICON: LocaleMap = {
  "zh-CN": {
    Overbought: "超买",
    Oversold:   "超卖",
    Neutral:    "中性",
    "n/a":      "无数据",
  },
};
