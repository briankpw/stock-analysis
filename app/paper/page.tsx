"use client";

import * as React from "react";
import { PageHeader } from "@/components/page-header";
import { PageIntro } from "@/components/page-intro";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ErrorBanner, LoadingPage } from "@/components/loading";
import { AddToWatchlistButton } from "@/components/add-to-watchlist-button";
import { useBundle } from "@/hooks/use-bundle";
import { useUi } from "@/lib/state";
import { fmtCurrency, fmtNumber, fmtSigned, fmtSignedPercent, relativeTime } from "@/lib/format";
import type { Valuation, Trade, Side } from "@/lib/paper-trading";
import { cn } from "@/lib/utils";

type PaperResponse = { valuation: Valuation; trades: Trade[] };

function usePaper() {
  const [data, setData] = React.useState<PaperResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const reload = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/paper${nonce > 0 ? `?_=${nonce}` : ""}`, { cache: "no-store" });
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(body?.error ?? `HTTP ${res.status}`);
        else setData(body as PaperResponse);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [nonce]);

  return { data, loading, error, reload };
}

function OrderForm({ onSubmitted }: { onSubmitted: () => void }) {
  const ticker = useUi((s) => s.ticker);
  const { data: bundle } = useBundle();
  const [side, setSide] = React.useState<Side>("buy");
  const [shares, setShares] = React.useState("10");
  const [price, setPrice] = React.useState("");
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const suggestedPrice = bundle?.quote.price ?? null;
  React.useEffect(() => {
    if (suggestedPrice !== null && !price) setPrice(String(suggestedPrice));
  }, [suggestedPrice, price]);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/paper", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: ticker,
          side,
          shares: Number(shares),
          price: Number(price),
          note: note || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      setNote("");
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Place an order</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Button variant={side === "buy" ? "success" : "outline"} onClick={() => setSide("buy")}>Buy</Button>
          <Button variant={side === "sell" ? "danger" : "outline"} onClick={() => setSide("sell")}>Sell</Button>
        </div>
        <div>
          <label className="metric-label">Symbol</label>
          <input value={ticker} readOnly
            className="mt-1 w-full h-9 rounded-md border border-border bg-muted/40 px-3 text-sm cursor-not-allowed" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="metric-label">Shares</label>
            <input type="number" min="0" step="1" value={shares}
              onChange={(e) => setShares(e.target.value)}
              className="mt-1 w-full h-9 rounded-md border border-border bg-card px-3 text-sm tabular-nums" />
          </div>
          <div>
            <label className="metric-label">Price</label>
            <input type="number" min="0" step="0.01" value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="mt-1 w-full h-9 rounded-md border border-border bg-card px-3 text-sm tabular-nums" />
          </div>
        </div>
        <div>
          <label className="metric-label">Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Why?"
            className="mt-1 w-full h-9 rounded-md border border-border bg-card px-3 text-sm" />
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        <Button
          onClick={submit}
          disabled={submitting || !shares || !price}
          variant={side === "buy" ? "success" : "danger"}
          className="w-full"
        >
          {submitting ? "Submitting…" : `${side === "buy" ? "Buy" : "Sell"} ${shares || 0} ${ticker}`}
        </Button>
        <p className="text-[0.7rem] text-muted-foreground text-center">
          Simulated brokerage. No real money moves.
        </p>
      </CardContent>
    </Card>
  );
}

function PortfolioCard({ valuation, onReset }: { valuation: Valuation; onReset: () => void }) {
  const pnlPos = valuation.totalPnl >= 0;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <CardTitle>Portfolio</CardTitle>
        <Button variant="outline" size="sm" onClick={onReset}>Reset</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="metric-label">Total value</p>
            <p className="metric-value">{fmtCurrency(valuation.totalValue)}</p>
          </div>
          <div>
            <p className="metric-label">Cash</p>
            <p className="metric-value">{fmtCurrency(valuation.cash)}</p>
          </div>
          <div>
            <p className="metric-label">Positions value</p>
            <p className="text-lg font-semibold tabular-nums">{fmtCurrency(valuation.marketValue)}</p>
          </div>
          <div>
            <p className="metric-label">Total P&amp;L</p>
            <p className={cn("text-lg font-semibold tabular-nums", pnlPos ? "text-success" : "text-danger")}>
              {fmtSigned(valuation.totalPnl)}{" "}
              <span className="text-xs">({fmtSignedPercent(valuation.totalPnlPct)})</span>
            </p>
          </div>
        </div>

        {valuation.positions.length > 0 && (
          <div>
            <p className="metric-label mb-2 mt-4">Open positions</p>
            <ul className="space-y-2">
              {valuation.positions.map((p) => {
                const pnlPos = (p.unrealised ?? 0) >= 0;
                return (
                  <li key={p.symbol} className="glass rounded-lg p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold">{p.symbol}</span>
                      <AddToWatchlistButton symbol={p.symbol} />
                      <span className="text-sm text-muted-foreground">
                        {fmtNumber(p.shares, 0)} @ avg {fmtCurrency(p.avgCost)}
                      </span>
                    </div>
                    <div className="text-right text-sm tabular-nums">
                      <div>Last {p.last === null ? "—" : fmtCurrency(p.last)}</div>
                      <div className={cn("font-semibold", pnlPos ? "text-success" : "text-danger")}>
                        {p.unrealised === null ? "—" : fmtSigned(p.unrealised)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TradesLog({ trades }: { trades: Trade[] }) {
  if (trades.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Recent trades</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">No trades yet.</p></CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader><CardTitle>Recent trades</CardTitle></CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border">
          {trades.map((t) => (
            <li key={t.id} className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={cn("chip", t.side === "buy" ? "chip-bull" : "chip-bear")}>
                    {t.side.toUpperCase()}
                  </span>
                  <span className="font-semibold">{t.symbol}</span>
                  <AddToWatchlistButton symbol={t.symbol} />
                  <span className="text-xs text-muted-foreground">{relativeTime(t.createdAt)}</span>
                </div>
                {t.note && <p className="text-xs text-muted-foreground mt-1 truncate">{t.note}</p>}
              </div>
              <div className="text-right text-sm tabular-nums">
                <div>{fmtNumber(t.shares, 0)} @ {fmtCurrency(t.price)}</div>
                <div className="text-xs text-muted-foreground">Cash → {fmtCurrency(t.cashAfter)}</div>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export default function PaperTradingPage() {
  const { data, loading, error, reload } = usePaper();

  const doReset = async () => {
    if (!confirm("Reset the portfolio? All positions and trades will be cleared.")) return;
    await fetch("/api/paper", { method: "DELETE" });
    reload();
  };

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader pageTitle="Paper Trading" />
      <PageIntro pageKey="paper" />

      {error && <ErrorBanner message={error} retry={reload} />}
      {!data && !error && loading && <LoadingPage label="Loading portfolio…" />}

      {data && (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr] animate-fade-in">
          <OrderForm onSubmitted={reload} />
          <div className="space-y-4">
            <PortfolioCard valuation={data.valuation} onReset={doReset} />
            <TradesLog trades={data.trades} />
          </div>
        </div>
      )}
    </div>
  );
}
