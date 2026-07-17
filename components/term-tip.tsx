"use client";

import * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { useIsBeginner, useLocale } from "@/lib/state";
import { termDef } from "@/lib/knowledge";
import { cn } from "@/lib/utils";

interface Props {
  /** Glossary key (canonical or any alias — see `TERM_ALIASES`). */
  term: string;
  /** Display text. Defaults to `term`. */
  children?: React.ReactNode;
  /** Force-render decoration even in advanced mode (rare — for the KeyTerms panel). */
  alwaysDecorate?: boolean;
  /** Extra classes for the trigger span. */
  className?: string;
}

/**
 * Inline glossary lookup for a technical term.
 *
 * In Beginner mode the child text gets a subtle dotted underline and shows
 * a definition tooltip on hover/focus. In Advanced mode we render the
 * children plainly with no decoration.
 *
 * If the term isn't in the glossary we render children as-is (safe fallback,
 * so pages don't blow up if a term is renamed).
 *
 * The tooltip content is locale-aware: it looks up the definition in the
 * current UI locale (falling back to English when a translation is
 * missing) and renders the locale's `label` in the tooltip header when
 * one is provided.
 */
export function TermTip({ term, children, alwaysDecorate, className }: Props) {
  const beginner = useIsBeginner();
  const locale = useLocale();
  const def = termDef(term, locale);
  const content = children ?? def?.label ?? term;

  if (!def || (!beginner && !alwaysDecorate)) {
    return <>{content}</>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "underline decoration-dotted decoration-primary/60 underline-offset-2 cursor-help",
            "focus:outline-none focus:ring-1 focus:ring-primary/40 rounded-sm",
            className,
          )}
          aria-label={`What is ${def.label ?? term}?`}
        >
          {content}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <p className="font-semibold mb-1">{def.label ?? term}</p>
        <p className="text-muted-foreground leading-relaxed">{def.what}</p>
        {def.deeper && (
          <p className="text-muted-foreground/80 leading-relaxed mt-1.5 pt-1.5 border-t border-border/50">
            {def.deeper}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
