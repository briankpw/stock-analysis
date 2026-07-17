"use client";

import * as React from "react";
import { ExternalLink, Users, Building2, ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PageIntro } from "@/components/page-intro";
import { KeyTerms } from "@/components/key-terms";
import { TermTip } from "@/components/term-tip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBanner, LoadingPage, RateLimitBanner } from "@/components/loading";
import { useHolders } from "@/hooks/use-holders";
import { useT } from "@/lib/i18n";
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
  const t = useT();
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
        {t("holders.breakdown")}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label={t("holders.kpi.insidersHeld")}
          value={fmtPercent(summary.insidersPercentHeld)}
          sub={<span>{t("holders.kpi.insidersHeldSub")}</span>}
          tone="neu"
        />
        <KpiTile
          label={t("holders.kpi.institutionsHeld")}
          value={fmtPercent(summary.institutionsPercentHeld)}
          sub={
            <span>
              {summary.institutionsFloatPercentHeld !== null &&
                summary.institutionsFloatPercentHeld !== undefined
                ? t("holders.kpi.institutionsHeldSubOfFloat", { pct: fmtPercent(summary.institutionsFloatPercentHeld) })
                : t("holders.kpi.institutionsHeldSubGeneric")}
            </span>
          }
          tone="neu"
        />
        <KpiTile
          label={t("holders.kpi.institutionsCount")}
          value={fmtInteger(summary.institutionsCount)}
          sub={<span>{t("holders.kpi.institutionsCountSub")}</span>}
          tone="neu"
        />
        <KpiTile
          label={t("holders.kpi.netInsider")}
          value={
            netShares === null
              ? DASH
              : `${netShares >= 0 ? "+" : ""}${fmtVolume(netShares)} sh`
          }
          sub={
            netActivity ? (
              <span>
                {t("holders.kpi.netInsiderSub", {
                  period: netActivity.period || "6mo",
                  buys: fmtInteger(netActivity.buyInfoCount),
                  sells: fmtInteger(netActivity.sellInfoCount),
                })}
                {netInstShares !== null && (
                  <>
                    <br />
                    {t("holders.kpi.institutionsNet")}{" "}
                    <span className={netInstTone === "bull" ? "text-success" : netInstTone === "bear" ? "text-danger" : ""}>
                      {netInstShares >= 0 ? "+" : ""}
                      {fmtVolume(netInstShares)} sh
                    </span>
                  </>
                )}
              </span>
            ) : (
              <span>{t("holders.kpi.noWindow")}</span>
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
  const t = useT();
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        {t("holders.empty.insiders")}
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
              <th className="px-4 py-3 font-semibold">{t("holders.col.name")}</th>
              <th className="px-4 py-3 font-semibold">{t("holders.col.role")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("holders.col.direct")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("holders.col.indirect")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("holders.col.totalShares")}</th>
              <th className="px-4 py-3 font-semibold">{t("holders.col.lastActivity")}</th>
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

function txnDirection(tx: InsiderTransaction): "buy" | "sell" | "neutral" {
  const text = `${tx.transactionText} ${tx.moneyText}`.toLowerCase();
  if (text.includes("purchase") || text.includes("buy") || text.includes("acquisition")) {
    return "buy";
  }
  if (text.includes("sale") || text.includes("sold") || text.includes("sell") || text.includes("disposition")) {
    return "sell";
  }
  return "neutral";
}

function InsiderTxnTable({ rows }: { rows: InsiderTransaction[] }) {
  const t = useT();
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        {t("holders.empty.transactions")}
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
              <th className="px-4 py-3 font-semibold">{t("holders.col.filer")}</th>
              <th className="px-4 py-3 font-semibold">{t("holders.col.role")}</th>
              <th className="px-4 py-3 font-semibold">{t("holders.col.action")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("holders.col.shares")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("holders.col.value")}</th>
              <th className="px-4 py-3 font-semibold">{t("holders.col.date")}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((tx, i) => {
              const dir = txnDirection(tx);
              const chip =
                dir === "buy" ? "chip-bull" :
                dir === "sell" ? "chip-bear" :
                "chip-neu";
              const icon =
                dir === "buy" ? <ArrowUpRight className="h-3 w-3" /> :
                dir === "sell" ? <ArrowDownRight className="h-3 w-3" /> :
                <Minus className="h-3 w-3" />;
              const fallbackAction =
                dir === "buy" ? t("holders.action.buy") :
                dir === "sell" ? t("holders.action.sell") :
                t("holders.action.other");
              return (
                <tr
                  key={`${tx.filerName}-${tx.startDate}-${i}`}
                  className="border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3 font-medium">
                    {tx.filerUrl ? (
                      <a
                        href={tx.filerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-primary inline-flex items-center gap-1"
                      >
                        {tx.filerName}
                        <ExternalLink className="h-3 w-3 opacity-60" />
                      </a>
                    ) : (
                      tx.filerName
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{tx.filerRelation || DASH}</td>
                  <td className="px-4 py-3">
                    <span className={cn("chip", chip)}>
                      {icon}
                      {tx.transactionText || fallbackAction}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {tx.ownership === "D" ? t("holders.col.direct") : tx.ownership === "I" ? t("holders.col.indirect") : ""}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtVolume(tx.shares)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {tx.moneyText || fmtCompactCurrency(tx.value)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {tx.startDate ? relativeTime(tx.startDate) : DASH}
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
  const t = useT();
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        {kind === "fund" ? t("holders.empty.fund") : t("holders.empty.institution")}
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
                {kind === "fund" ? t("holders.col.fund") : t("holders.col.institution")}
              </th>
              <th className="px-4 py-3 font-semibold text-right">{t("holders.col.sharesHeld")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("holders.col.marketValue")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("holders.col.pctSharesOut")}</th>
              <th className="px-4 py-3 font-semibold text-right">{t("holders.col.deltaPrior")}</th>
              <th className="px-4 py-3 font-semibold">{t("holders.col.reportDate")}</th>
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
  const t = useT();

  const totalHolders = data
    ? data.insiders.length +
      data.institutions.length +
      data.funds.length +
      data.insiderTransactions.length
    : 0;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader pageTitleKey="nav.holders" />
      <PageIntro pageKey="holders" />

      {rateLimited && <RateLimitBanner />}
      {error && <ErrorBanner message={error} retry={reload} />}
      {!data && !error && !rateLimited && loading && <LoadingPage label={t("loading.ownership")} />}

      {data && (
        <div className="space-y-6 animate-fade-in">
          <SummaryStrip summary={data.summary} netActivity={data.netActivity} />

          {totalHolders === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("holders.empty.noHolders.title")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {t("holders.empty.noHolders.body", { ticker: data.ticker })}
                </p>
              </CardContent>
            </Card>
          ) : (
            <Tabs defaultValue="insiders">
              <TabsList>
                <TabsTrigger value="insiders">
                  <Users className="h-3.5 w-3.5 mr-1.5" />
                  {t("holders.tab.insiders", { n: data.insiders.length })}
                </TabsTrigger>
                <TabsTrigger value="transactions">
                  {t("holders.tab.transactions", { n: data.insiderTransactions.length })}
                </TabsTrigger>
                <TabsTrigger value="institutions">
                  <Building2 className="h-3.5 w-3.5 mr-1.5" />
                  {t("holders.tab.institutions", { n: data.institutions.length })}
                </TabsTrigger>
                <TabsTrigger value="funds">
                  {t("holders.tab.funds", { n: data.funds.length })}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="insiders">
                <div className="mb-2 text-xs text-muted-foreground">
                  {t("holders.insiders.intro")}
                </div>
                <InsiderTable rows={data.insiders} />
              </TabsContent>
              <TabsContent value="transactions">
                <div className="mb-2 text-xs text-muted-foreground">
                  {t("holders.transactions.intro")}
                </div>
                <InsiderTxnTable rows={data.insiderTransactions} />
              </TabsContent>
              <TabsContent value="institutions">
                <div className="mb-2 text-xs text-muted-foreground">
                  {t("holders.institutions.intro")}
                </div>
                <InstitutionTable rows={data.institutions} kind="institution" />
              </TabsContent>
              <TabsContent value="funds">
                <div className="mb-2 text-xs text-muted-foreground">
                  {t("holders.funds.intro")}
                </div>
                <InstitutionTable rows={data.funds} kind="fund" />
              </TabsContent>
            </Tabs>
          )}

          <p className="text-xs text-muted-foreground text-center pt-4">
            {t("holders.footer", { time: new Date(data.fetchedAt).toLocaleString() })}
          </p>

          <KeyTerms
            terms={[
              "Insider",
              "Institutional Holder",
              "Mutual Fund",
              "ETF",
              "Direct",
              "Indirect",
              "% Held",
              "% of Float",
              "Float",
              "Form 3",
              "Form 4",
              "Form 5",
              "Form 13F",
              "Section 16",
              "Non-Derivative",
              "Reporting Owner",
            ]}
          />
        </div>
      )}
    </div>
  );
}
