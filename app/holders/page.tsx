"use client";

import * as React from "react";
import { ExternalLink, Users, Building2, ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageIntro } from "@/components/page-intro";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBanner, LoadingPage, RateLimitBanner } from "@/components/loading";
import { useHolders } from "@/hooks/use-holders";
import {
  fmtCompactCurrency,
  fmtInteger,
  fmtPercent,
  fmtSignedPercent,
  fmtVolume,
  relativeTime,
  DASH,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  InsiderHolder,
  InsiderTransaction,
  InstitutionalHolder,
  MajorHoldersSummary,
  NetInsiderActivity,
} from "@/lib/data";

// --------------------------------------------------------------------------

function KpiTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone?: "bull" | "bear" | "neu";
}) {
  const border =
    tone === "bull" ? "border-l-success" :
    tone === "bear" ? "border-l-danger" :
    "border-l-border";
  return (
    <div className={cn("kpi-card border-l-4", border)}>
      <p className="metric-label">{label}</p>
      <p className="metric-value mt-1">{value}</p>
      {sub && <p className="text-xs mt-1 text-muted-foreground">{sub}</p>}
    </div>
  );
}

// --------------------------------------------------------------------------

function SummaryStrip({
  summary,
  netActivity,
}: {
  summary: MajorHoldersSummary;
  netActivity: NetInsiderActivity | null;
}) {
  const netShares = netActivity?.netInfoShares ?? null;
  const netTone: "bull" | "bear" | "neu" =
    netShares === null || netShares === 0 ? "neu" :
    netShares > 0 ? "bull" : "bear";
  const netInstShares = netActivity?.netInstSharesBuying ?? null;
  const netInstTone: "bull" | "bear" | "neu" =
    netInstShares === null || netInstShares === 0 ? "neu" :
    netInstShares > 0 ? "bull" : "bear";

  return (
    <section>
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Ownership breakdown
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Held by insiders (internal)"
          value={fmtPercent(summary.insidersPercentHeld)}
          sub={<span>CEOs, directors, officers &amp; other reporting insiders</span>}
          tone="neu"
        />
        <KpiTile
          label="Held by institutions (external)"
          value={fmtPercent(summary.institutionsPercentHeld)}
          sub={
            <span>
              {summary.institutionsFloatPercentHeld !== null &&
                summary.institutionsFloatPercentHeld !== undefined
                ? `${fmtPercent(summary.institutionsFloatPercentHeld)} of float`
                : "Mutual funds, hedge funds, pensions"}
            </span>
          }
          tone="neu"
        />
        <KpiTile
          label="# of institutions"
          value={fmtInteger(summary.institutionsCount)}
          sub={<span>Distinct 13F filers</span>}
          tone="neu"
        />
        <KpiTile
          label="Net insider activity"
          value={
            netShares === null
              ? DASH
              : `${netShares >= 0 ? "+" : ""}${fmtVolume(netShares)} sh`
          }
          sub={
            netActivity ? (
              <span>
                Last {netActivity.period || "6mo"} · {fmtInteger(netActivity.buyInfoCount)} buys /{" "}
                {fmtInteger(netActivity.sellInfoCount)} sells
                {netInstShares !== null && (
                  <>
                    <br />
                    Institutions net{" "}
                    <span className={netInstTone === "bull" ? "text-success" : netInstTone === "bear" ? "text-danger" : ""}>
                      {netInstShares >= 0 ? "+" : ""}
                      {fmtVolume(netInstShares)} sh
                    </span>
                  </>
                )}
              </span>
            ) : (
              <span>No filings in window</span>
            )
          }
          tone={netTone}
        />
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------

function totalInsiderPosition(h: InsiderHolder): number {
  return (h.positionDirect ?? 0) + (h.positionIndirect ?? 0);
}

function InsiderTable({ rows }: { rows: InsiderHolder[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Yahoo Finance didn't return an insider roster for this ticker.
      </p>
    );
  }

  const sorted = [...rows].sort(
    (a, b) => totalInsiderPosition(b) - totalInsiderPosition(a),
  );

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[0.7rem] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              <th className="px-4 py-3 font-semibold text-right">Direct</th>
              <th className="px-4 py-3 font-semibold text-right">Indirect</th>
              <th className="px-4 py-3 font-semibold text-right">Total shares</th>
              <th className="px-4 py-3 font-semibold">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((h, i) => (
              <tr
                key={`${h.name}-${i}`}
                className="border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors"
              >
                <td className="px-4 py-3 font-medium">
                  {h.url ? (
                    <a
                      href={h.url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-primary inline-flex items-center gap-1"
                    >
                      {h.name}
                      <ExternalLink className="h-3 w-3 opacity-60" />
                    </a>
                  ) : (
                    h.name
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{h.relation || DASH}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {fmtVolume(h.positionDirect)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {fmtVolume(h.positionIndirect)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">
                  {fmtVolume(totalInsiderPosition(h) || null)}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  <div>{h.transactionDescription || DASH}</div>
                  {h.latestTransDate && (
                    <div className="opacity-70">{relativeTime(h.latestTransDate)}</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// --------------------------------------------------------------------------

function txnDirection(t: InsiderTransaction): "buy" | "sell" | "neutral" {
  const text = `${t.transactionText} ${t.moneyText}`.toLowerCase();
  if (text.includes("purchase") || text.includes("buy") || text.includes("acquisition")) {
    return "buy";
  }
  if (text.includes("sale") || text.includes("sold") || text.includes("sell") || text.includes("disposition")) {
    return "sell";
  }
  return "neutral";
}

function InsiderTxnTable({ rows }: { rows: InsiderTransaction[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No insider transactions reported in the recent Yahoo window.
      </p>
    );
  }

  const sorted = [...rows].sort((a, b) => {
    const ta = a.startDate ? new Date(a.startDate).getTime() : 0;
    const tb = b.startDate ? new Date(b.startDate).getTime() : 0;
    return tb - ta;
  });

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[0.7rem] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="px-4 py-3 font-semibold">Filer</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              <th className="px-4 py-3 font-semibold">Action</th>
              <th className="px-4 py-3 font-semibold text-right">Shares</th>
              <th className="px-4 py-3 font-semibold text-right">Value</th>
              <th className="px-4 py-3 font-semibold">Date</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t, i) => {
              const dir = txnDirection(t);
              const chip =
                dir === "buy" ? "chip-bull" :
                dir === "sell" ? "chip-bear" :
                "chip-neu";
              const icon =
                dir === "buy" ? <ArrowUpRight className="h-3 w-3" /> :
                dir === "sell" ? <ArrowDownRight className="h-3 w-3" /> :
                <Minus className="h-3 w-3" />;
              return (
                <tr
                  key={`${t.filerName}-${t.startDate}-${i}`}
                  className="border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 font-medium">
                    {t.filerUrl ? (
                      <a
                        href={t.filerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-primary inline-flex items-center gap-1"
                      >
                        {t.filerName}
                        <ExternalLink className="h-3 w-3 opacity-60" />
                      </a>
                    ) : (
                      t.filerName
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{t.filerRelation || DASH}</td>
                  <td className="px-4 py-3">
                    <span className={cn("chip", chip)}>
                      {icon}
                      {t.transactionText || (dir === "buy" ? "Buy" : dir === "sell" ? "Sell" : "Other")}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t.ownership === "D" ? "Direct" : t.ownership === "I" ? "Indirect" : ""}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtVolume(t.shares)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {t.moneyText || fmtCompactCurrency(t.value)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {t.startDate ? relativeTime(t.startDate) : DASH}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// --------------------------------------------------------------------------

function InstitutionTable({
  rows,
  kind,
}: {
  rows: InstitutionalHolder[];
  kind: "institution" | "fund";
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Yahoo Finance didn't return a {kind === "fund" ? "mutual-fund" : "institutional"} holder list for this ticker.
      </p>
    );
  }

  const sorted = [...rows].sort((a, b) => (b.position ?? 0) - (a.position ?? 0));

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[0.7rem] uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="px-4 py-3 font-semibold">
                {kind === "fund" ? "Fund" : "Institution"}
              </th>
              <th className="px-4 py-3 font-semibold text-right">Shares held</th>
              <th className="px-4 py-3 font-semibold text-right">Market value</th>
              <th className="px-4 py-3 font-semibold text-right">% of shares out</th>
              <th className="px-4 py-3 font-semibold text-right">Δ vs prior</th>
              <th className="px-4 py-3 font-semibold">Report date</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((o, i) => {
              const change = o.pctChange;
              const changeTone =
                change === null || change === 0 ? "text-muted-foreground" :
                change > 0 ? "text-success" : "text-danger";
              return (
                <tr
                  key={`${o.organization}-${i}`}
                  className="border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 font-medium">{o.organization || DASH}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtVolume(o.position)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {fmtCompactCurrency(o.value)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {fmtPercent(o.pctHeld)}
                  </td>
                  <td className={cn("px-4 py-3 text-right tabular-nums", changeTone)}>
                    {change === null ? DASH : fmtSignedPercent(change)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {o.reportDate ? new Date(o.reportDate).toLocaleDateString() : DASH}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// --------------------------------------------------------------------------

export default function HoldersPage() {
  const { data, loading, error, rateLimited, reload } = useHolders();

  const totalHolders = data
    ? data.insiders.length +
      data.institutions.length +
      data.funds.length +
      data.insiderTransactions.length
    : 0;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader pageTitle="Holders" />
      <PageIntro pageKey="holders" />

      {rateLimited && <RateLimitBanner />}
      {error && <ErrorBanner message={error} retry={reload} />}
      {!data && !error && !rateLimited && loading && <LoadingPage label="Loading ownership data…" />}

      {data && (
        <div className="space-y-6 animate-fade-in">
          <SummaryStrip summary={data.summary} netActivity={data.netActivity} />

          {totalHolders === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No holder data</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Yahoo Finance didn't return ownership details for{" "}
                  <strong>{data.ticker}</strong>. This is common for very small caps,
                  ADRs, or newly listed tickers.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Tabs defaultValue="insiders">
              <TabsList>
                <TabsTrigger value="insiders">
                  <Users className="h-3.5 w-3.5 mr-1.5" />
                  Insiders ({data.insiders.length})
                </TabsTrigger>
                <TabsTrigger value="transactions">
                  Insider transactions ({data.insiderTransactions.length})
                </TabsTrigger>
                <TabsTrigger value="institutions">
                  <Building2 className="h-3.5 w-3.5 mr-1.5" />
                  Institutions ({data.institutions.length})
                </TabsTrigger>
                <TabsTrigger value="funds">
                  Mutual funds ({data.funds.length})
                </TabsTrigger>
              </TabsList>
              <TabsContent value="insiders">
                <div className="mb-2 text-xs text-muted-foreground">
                  <strong>Internal.</strong> Executives &amp; directors that must report their
                  personal holdings on SEC Form 4. &ldquo;Direct&rdquo; = personally titled,
                  &ldquo;Indirect&rdquo; = through trusts, family members, or entities they control.
                </div>
                <InsiderTable rows={data.insiders} />
              </TabsContent>
              <TabsContent value="transactions">
                <div className="mb-2 text-xs text-muted-foreground">
                  Recent buys, sells, option exercises and gifts reported by insiders.
                  Sustained insider selling is often neutral (diversification, tax); clustered
                  buying by multiple insiders is a stronger positive signal.
                </div>
                <InsiderTxnTable rows={data.insiderTransactions} />
              </TabsContent>
              <TabsContent value="institutions">
                <div className="mb-2 text-xs text-muted-foreground">
                  <strong>External.</strong> Big-money holders required to disclose positions
                  quarterly on Form 13F: hedge funds, pension plans, asset managers, sovereign
                  wealth. Sorted by size of position.
                </div>
                <InstitutionTable rows={data.institutions} kind="institution" />
              </TabsContent>
              <TabsContent value="funds">
                <div className="mb-2 text-xs text-muted-foreground">
                  Top mutual funds &amp; ETFs holding this stock. Reported at fund-level
                  (rather than firm-level) — one asset manager can appear multiple times
                  through different funds.
                </div>
                <InstitutionTable rows={data.funds} kind="fund" />
              </TabsContent>
            </Tabs>
          )}

          <p className="text-xs text-muted-foreground text-center pt-4 pb-8">
            Source: Yahoo Finance quoteSummary (13F, Form 4, Form 144 filings via SEC EDGAR).
            Position sizes and %held are as-of each holder's most recent filing —
            institutions file quarterly, insiders file within 2 business days of a trade.
            Fetched {new Date(data.fetchedAt).toLocaleString()}.
          </p>
        </div>
      )}
    </div>
  );
}
