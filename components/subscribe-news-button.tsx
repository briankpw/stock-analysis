"use client";

/**
 * "Subscribe to news" toggle for a specific ticker.
 *
 * Sits at the top of the News page. Turning it on:
 *   1. Persists a `news_subscriptions` row.
 *   2. Silent-seeds the current headlines into `news_items` so the
 *      first background tick doesn't Telegram-blast the initial batch.
 *   3. From then on, every new headline that shows up in Yahoo's feed
 *      for this ticker triggers a Telegram push.
 */

import * as React from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { useNewsSubscriptions } from "@/hooks/use-news-subscriptions";
import { cn } from "@/lib/utils";

interface Props {
  ticker: string;
  variant?: "icon" | "label";
  className?: string;
}

export function SubscribeNewsButton({
  ticker,
  variant = "label",
  className,
}: Props) {
  const { isSubscribed, subscribe, unsubscribe } = useNewsSubscriptions();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const symbol = ticker.trim().toUpperCase();
  const subscribed = isSubscribed(symbol);

  const label = subscribed
    ? `Stop news alerts for ${symbol}`
    : `Get Telegram alerts for new ${symbol} headlines`;

  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy || !symbol) return;
    setError(null);
    setBusy(true);
    try {
      if (subscribed) await unsubscribe(symbol);
      else await subscribe(symbol);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const Icon = busy ? Loader2 : subscribed ? Bell : BellOff;
  const tooltip = error ?? label;

  const toneClasses = subscribed
    ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
    : error
      ? "border-danger/40 bg-danger/10 text-danger hover:bg-danger/15"
      : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary";

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={busy || !symbol}
        aria-label={label}
        aria-pressed={subscribed}
        title={tooltip}
        className={cn(
          "inline-flex items-center justify-center h-9 w-9 rounded-md border transition-colors shrink-0",
          toneClasses,
          className,
        )}
      >
        <Icon className={cn("h-4 w-4", busy && "animate-spin")} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || !symbol}
      aria-pressed={subscribed}
      title={tooltip}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium rounded-md border px-2.5 py-1.5 transition-colors",
        toneClasses,
        className,
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
      <span>
        {subscribed ? "News alerts on" : "Subscribe to news alerts"}
      </span>
    </button>
  );
}
