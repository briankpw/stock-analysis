"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Loading({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{label}</span>
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
  return (
    <div className="glass rounded-xl border-l-4 border-l-danger p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
      <div>
        <p className="text-sm font-semibold text-danger">Something went wrong</p>
        <p className="text-xs text-muted-foreground break-all">{message}</p>
      </div>
      {retry && (
        <button
          onClick={retry}
          className="text-xs font-semibold text-primary hover:underline"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function RateLimitBanner() {
  return (
    <div className="glass rounded-xl border-l-4 border-l-warning p-4 mb-4">
      <p className="text-sm font-semibold text-warning">Yahoo Finance is rate-limiting us</p>
      <p className="text-xs text-muted-foreground mt-1">
        We've cached the last successful pull. Try again in a minute or two — Yahoo occasionally
        throttles high-frequency callers.
      </p>
    </div>
  );
}
