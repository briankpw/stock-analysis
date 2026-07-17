"use client";

import * as React from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import { useIsBeginner, useLocale } from "@/lib/state";
import { termDef } from "@/lib/knowledge";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Props {
  /** Glossary keys to render, in order. Unknown keys are silently skipped. */
  terms: string[];
  /** Optional title (defaults to the localized "Key terms on this page"). */
  title?: string;
  /** Start expanded (default false — folded to save vertical space). */
  defaultOpen?: boolean;
}

/**
 * Beginner-mode-only glossary strip that sits at the bottom of a page.
 * Renders as a fold-out card so it never dominates the page but is
 * always one click away when a new user hits jargon.
 *
 * Advanced users don't see it at all — the page ends where the data ends.
 * All copy (title, subtitle, term labels, definitions) follows the
 * current UI locale.
 */
export function KeyTerms({ terms, title, defaultOpen = false }: Props) {
  const beginner = useIsBeginner();
  const locale = useLocale();
  const t = useT();
  const [open, setOpen] = React.useState(defaultOpen);

  const defs = React.useMemo(
    () =>
      terms
        .map((key) => {
          const def = termDef(key, locale);
          return def ? { key, def } : null;
        })
        .filter((r): r is { key: string; def: NonNullable<ReturnType<typeof termDef>> } => r !== null),
    [terms, locale],
  );

  if (!beginner || defs.length === 0) return null;

  const heading = title ?? t("keyTerms.title");
  const subtitleKey = defs.length === 1 ? "keyTerms.count" : "keyTerms.countPlural";

  return (
    <section
      className="mt-8 mb-4 rounded-xl border border-border bg-card/40 overflow-hidden animate-fade-in"
      aria-label="Key terms glossary"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center gap-2.5 px-4 py-3 text-left",
          "hover:bg-muted/30 transition-colors",
        )}
        aria-expanded={open}
      >
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-primary">
          <BookOpen className="h-3.5 w-3.5" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight">{heading}</p>
          <p className="text-[0.7rem] text-muted-foreground">
            {t(subtitleKey, { n: defs.length })}
          </p>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <dl className="divide-y divide-border/50 border-t border-border">
          {defs.map(({ key, def }) => (
            <div
              key={key}
              className="px-4 py-3 grid gap-1 md:gap-3 md:grid-cols-[minmax(0,10rem)_1fr]"
            >
              <dt className="text-sm font-semibold text-foreground">{def.label ?? key}</dt>
              <dd className="text-sm text-muted-foreground leading-relaxed">
                {def.what}
                {def.deeper && (
                  <span className="block text-xs text-muted-foreground/80 mt-1">
                    {def.deeper}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
