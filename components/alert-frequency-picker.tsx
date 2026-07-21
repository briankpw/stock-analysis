"use client";

/**
 * Shared 3-way "how often can I notify you?" toggle used by every
 * alert configurator popover in the app.
 *
 * Renders as three compact pills — one per {@link NotifyFrequency} —
 * plus a one-line hint under the active choice so users can pick with
 * confidence without hunting for docs. Kept in its own module (rather
 * than inlined into each of the five verdict-alert popovers) because:
 *
 *   1. The five popovers are already ~500 lines each; another
 *      duplicated block would balloon that further.
 *   2. Any future tweak to the copy or layout has to happen in ONE
 *      place, which reduces the "changed it in one, forgot the other
 *      four" bug surface.
 *   3. New alert types added later (e.g. a portfolio-risk configurator)
 *      can adopt the same primitive with a single import.
 *
 * The component is fully controlled — the parent owns the current
 * value and receives the new one on click. Disabling the whole picker
 * (e.g. when the parent's "on-change" checkbox is unchecked) is
 * exposed via the optional `disabled` prop so the picker visually
 * dims + becomes non-interactive to match the sibling controls.
 *
 * The "fired once — re-save to re-arm" chip on the right hand side is
 * an accessibility affordance for `once` mode: when the user's rule
 * has already fired, they need a hint that saving again resets the
 * gate. The chip is a rendered-only indicator; clearing it happens
 * via the normal Save path (which sends a fresh `frequency` value and
 * the store's upsert clears `last_change_notified_at`).
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import {
  ALL_NOTIFY_FREQUENCIES,
  type NotifyFrequency,
} from "@/lib/alert-frequency";

export function FrequencyPicker({
  value,
  onChange,
  disabled,
  firedOnce,
  className,
}: {
  value: NotifyFrequency;
  onChange: (next: NotifyFrequency) => void;
  disabled?: boolean;
  /**
   * When true (and `value === "once"`), render a small chip explaining
   * that the alert has already fired once and won't fire again until
   * the user re-saves. Purely informational.
   */
  firedOnce?: boolean;
  className?: string;
}) {
  const t = useT();
  const hintKey = `alert.frequency.${value}.hint` as const;

  return (
    <div className={cn("space-y-1", disabled && "opacity-50 pointer-events-none", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[0.65rem] text-muted-foreground">
          {t("alert.frequency.title")}
        </p>
        {firedOnce && value === "once" && (
          <span
            className="text-[0.55rem] rounded-full border border-warning/40 bg-warning/10 text-warning px-1.5 py-[1px]"
            title={t("alert.frequency.once.hint")}
          >
            {t("alert.frequency.armedChip")}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {ALL_NOTIFY_FREQUENCIES.map((f) => {
          const active = value === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => onChange(f)}
              aria-pressed={active}
              className={cn(
                "text-[0.65rem] px-2 py-1 rounded-md border transition-colors",
                active
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground",
              )}
            >
              {t(`alert.frequency.${f}`)}
            </button>
          );
        })}
      </div>
      <p className="text-[0.6rem] text-muted-foreground/80 leading-snug">
        {t(hintKey)}
      </p>
    </div>
  );
}
