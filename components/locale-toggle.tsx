"use client";

import { Languages } from "lucide-react";
import { Button } from "./ui/button";
import { useUi, type Locale } from "@/lib/state";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const OPTIONS: ReadonlyArray<{ id: Locale; labelKey: string; native: string }> = [
  { id: "en",    labelKey: "locale.en",    native: "EN" },
  { id: "zh-CN", labelKey: "locale.zh-CN", native: "中" },
];

/**
 * Language pill. English ↔ Simplified Chinese today; the store type is
 * open so more locales can be plugged in later without touching the
 * component surface.
 *
 * On narrow renders (the sidebar squeezes the full pill on mobile) we
 * fall back to a one-character glyph so both buttons still fit side by
 * side without wrapping.
 */
export function LocaleToggle({ className }: { className?: string }) {
  const locale = useUi((s) => s.locale);
  const setLocale = useUi((s) => s.setLocale);
  const t = useT();

  return (
    <div
      className={cn("inline-flex rounded-lg glass p-1 gap-1", className)}
      role="group"
      aria-label={t("locale.ariaLabel")}
    >
      {OPTIONS.map((opt) => {
        const active = locale === opt.id;
        return (
          <Button
            key={opt.id}
            variant={active ? "default" : "ghost"}
            size="sm"
            onClick={() => setLocale(opt.id)}
            className="gap-1.5 flex-1"
            aria-pressed={active}
            title={t(opt.labelKey)}
          >
            <Languages className="h-3.5 w-3.5" />
            <span>{t(opt.labelKey)}</span>
            <span aria-hidden className="sr-only">
              {opt.native}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
