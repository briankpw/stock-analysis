"use client";

import * as React from "react";
import { HelpCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageIntro } from "@/components/page-intro";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ErrorBanner, LoadingPage, RateLimitBanner } from "@/components/loading";
import { useBundle } from "@/hooks/use-bundle";
import { useIsBeginner } from "@/lib/state";
import { metricHint, groupIntro } from "@/lib/knowledge";
import type { MetricGroup, Tone } from "@/lib/ratios";
import { cn } from "@/lib/utils";

/** Map a semantic tone to the Tailwind text colour we render it with. */
const TONE_TEXT: Record<Tone, string> = {
  good: "text-success",
  warn: "text-warning",
  bad: "text-danger",
  neutral: "", // keep the default foreground colour
};

/**
 * Small always-visible legend that explains what the value colours mean.
 * Rendered right below the page header so it works in both Beginner and
 * Advanced modes (the `PageIntro` block above is beginner-only).
 */
function ToneLegend() {
  const items: Array<{ tone: Tone; label: string }> = [
    { tone: "good", label: "healthy" },
    { tone: "warn", label: "watch" },
    { tone: "bad", label: "concern" },
  ];
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="uppercase tracking-wider">Value legend</span>
      {items.map(({ tone, label }) => (
        <span key={tone} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              "h-2 w-2 rounded-full",
              tone === "good" ? "bg-success" : tone === "warn" ? "bg-warning" : "bg-danger",
            )}
          />
          <span className={cn("font-medium", TONE_TEXT[tone])}>{label}</span>
        </span>
      ))}
      <span className="text-muted-foreground/70">· uncoloured = context only</span>
    </div>
  );
}

function DirectionChip({ direction }: { direction: "higher_better" | "lower_better" | "context" }) {
  if (direction === "context") return null;
  return (
    <span
      className={cn(
        "chip",
        direction === "higher_better" ? "chip-bull" : "chip-bear",
      )}
    >
      {direction === "higher_better" ? "↑ higher = better" : "↓ lower = better"}
    </span>
  );
}

function MetricRow({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  const beginner = useIsBeginner();
  const hint = metricHint(label);
  const toneClass = TONE_TEXT[tone ?? "neutral"];

  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-border last:border-0">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-sm text-muted-foreground truncate">{label}</span>
        {beginner && hint && (
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </TooltipTrigger>
            <TooltipContent>
              <p className="font-medium mb-1">{hint.what}</p>
              {hint.ruleOfThumb && (
                <p className="text-muted-foreground text-[0.7rem] leading-relaxed">
                  {hint.ruleOfThumb}
                </p>
              )}
              <div className="mt-1"><DirectionChip direction={hint.direction} /></div>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <span className={cn("text-sm font-semibold tabular-nums text-right", toneClass)}>{value}</span>
    </div>
  );
}

function GroupCard({ group }: { group: MetricGroup }) {
  const beginner = useIsBeginner();
  const intro = beginner ? groupIntro(group.title) : "";
  const introHtml = intro.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{group.title}</CardTitle>
        {intro && (
          <p
            className="text-xs text-muted-foreground leading-relaxed pt-1"
            dangerouslySetInnerHTML={{ __html: introHtml }}
          />
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {group.metrics.map(([label, value, tone]) => (
          <MetricRow key={label} label={label} value={value} tone={tone} />
        ))}
      </CardContent>
    </Card>
  );
}

export default function RatiosPage() {
  const { data, loading, error, reload } = useBundle();

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader pageTitle="Ratios" />
      <PageIntro pageKey="ratios" />
      <ToneLegend />

      {data?.rateLimited && <RateLimitBanner />}
      {error && <ErrorBanner message={error} retry={reload} />}
      {!data && !error && loading && <LoadingPage label="Crunching fundamentals…" />}

      {data && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 animate-fade-in">
          {data.groups.map((g) => (
            <GroupCard key={g.title} group={g} />
          ))}
        </div>
      )}
    </div>
  );
}
