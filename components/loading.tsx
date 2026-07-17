"use client";

import { Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Additional dictionary keys used by this component (added inline so callers
// don't need to import from lib/i18n/dict):
//   "loading.default"        Loading…
//   "error.title"            Something went wrong
//   "rate.title"             Yahoo Finance is rate-limiting us
//   "rate.body"              We've cached the last successful pull…

export function Loading({ label, className }: { label?: string; className?: string }) {
  const t = useT();
  return (
    <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{label ?? t("common.loading")}</span>
    </div>
  );
}

export function LoadingPage({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <Loading label={label} />
    </div>
  );
}

export function ErrorBanner({ message, retry }: { message: string; retry?: () => void }) {
  const t = useT();
  return (
    <div className="glass rounded-xl border-l-4 border-l-danger p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
      <div>
        <p className="text-sm font-semibold text-danger">{t("error.title")}</p>
        <p className="text-xs text-muted-foreground break-all">{message}</p>
      </div>
      {retry && (
        <button
          onClick={retry}
          className="text-xs font-semibold text-primary hover:underline"
        >
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}

export function RateLimitBanner() {
  const t = useT();
  return (
    <div className="glass rounded-xl border-l-4 border-l-warning p-4 mb-4">
      <p className="text-sm font-semibold text-warning">{t("rate.title")}</p>
      <p className="text-xs text-muted-foreground mt-1">{t("rate.body")}</p>
    </div>
  );
}
