"use client";

import * as React from "react";
import { HelpCircle } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageIntro } from "@/components/page-intro";
import { KeyTerms } from "@/components/key-terms";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ErrorBanner, LoadingPage, RateLimitBanner } from "@/components/loading";
import { useBundle } from "@/hooks/use-bundle";
import { useIsBeginner, useLocale } from "@/lib/state";
import { useT } from "@/lib/i18n";
import { metricHint, groupIntro, metricLabel, groupTitle } from "@/lib/knowledge";
import { LOSS_TOKEN, type MetricGroup, type Tone } from "@/lib/ratios";
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
  const t = useT();
  const items: Array<{ tone: Tone; labelKey: string }> = [
    { tone: "good", labelKey: "ratios.tone.good" },
    { tone: "warn", labelKey: "ratios.tone.warn" },
    { tone: "bad",  labelKey: "ratios.tone.bad"  },
  ];
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="uppercase tracking-wider">{t("ratios.legend")}</span>
      {items.map(({ tone, labelKey }) => (
        <span key={tone} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              "h-2 w-2 rounded-full",
              tone === "good" ? "bg-success" : tone === "warn" ? "bg-warning" : "bg-danger",
            )}
          />
          <span className={cn("font-medium", TONE_TEXT[tone])}>{t(labelKey)}</span>
        </span>
      ))}
      <span className="text-muted-foreground/70">{t("ratios.tone.contextNote")}</span>
    </div>
  );
}

function DirectionChip({ direction }: { direction: "higher_better" | "lower_better" | "context" }) {
  const t = useT();
  if (direction === "context") return null;
  return (
    <span
      className={cn(
        "chip",
        direction === "higher_better" ? "chip-bull" : "chip-bear",
      )}
    >
      {direction === "higher_better" ? t("ratios.direction.higher") : t("ratios.direction.lower")}
    </span>
  );
}

function MetricRow({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  const beginner = useIsBeginner();
  const locale = useLocale();
  const t = useT();
  const hint = metricHint(label, locale);
  const displayLabel = metricLabel(label, locale);
  const toneClass = TONE_TEXT[tone ?? "neutral"];

  // The `LOSS_TOKEN` sentinel is emitted by the server when a P/E-style
  // ratio is undefined *because earnings are negative* (i.e. the company
  // is losing money — same convention Moomoo uses). Swap it for a
  // localized "Loss" chip in beginner mode and a red word otherwise.
  const isLoss = value === LOSS_TOKEN;
  const displayValue = isLoss ? t("ratios.loss") : value;

  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-border last:border-0">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-sm text-muted-foreground truncate">{displayLabel}</span>
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
      {isLoss ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border border-danger/40 bg-danger/10 px-2 py-0.5",
                "text-xs font-semibold uppercase tracking-wide text-danger cursor-help",
              )}
            >
              {displayValue}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p className="font-medium">{t("ratios.loss.tooltipTitle")}</p>
            <p className="text-muted-foreground text-[0.7rem] leading-relaxed mt-1">
              {t("ratios.loss.tooltipBody")}
            </p>
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className={cn("text-sm font-semibold tabular-nums text-right", toneClass)}>
          {displayValue}
        </span>
      )}
    </div>
  );
}

function GroupCard({ group }: { group: MetricGroup }) {
  const beginner = useIsBeginner();
  const locale = useLocale();
  const intro = beginner ? groupIntro(group.title, locale) : "";
  const introHtml = intro.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const localizedTitle = groupTitle(group.title, locale);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{localizedTitle}</CardTitle>
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
  const t = useT();

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader pageTitleKey="nav.ratios" />
      <PageIntro pageKey="ratios" />
      <ToneLegend />

      {data?.rateLimited && <RateLimitBanner />}
      {error && <ErrorBanner message={error} retry={reload} />}
      {!data && !error && loading && <LoadingPage label={t("loading.fundamentals")} />}

      {data && (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 animate-fade-in">
            {data.groups.map((g) => (
              <GroupCard key={g.title} group={g} />
            ))}
          </div>

          <KeyTerms
            terms={[
              "Market Cap",
              "Enterprise Value",
              "P/E Ratio",
              "Forward P/E",
              "PEG Ratio",
              "P/B Ratio",
              "P/S Ratio",
              "EV/EBITDA",
              "Book Value",
              "Gross Margin",
              "Operating Margin",
              "Profit Margin",
              "EBITDA",
              "ROE",
              "ROA",
              "EPS",
              "TTM",
              "YoY",
              "Debt / Equity",
              "Current Ratio",
              "Quick Ratio",
              "Free Cash Flow",
              "Operating Cash Flow",
              "Dividend",
              "Dividend Yield",
              "Payout Ratio",
            ]}
          />
        </>
      )}
    </div>
  );
}
