/**
 * Issuer-centric SEC Form 4 fetcher.
 *
 * Given an issuer's CIK (i.e. the company being invested in), pull the
 * most recent Form 4/4A/5 filings and parse each XML. This is the
 * mirror of `fetchPersonInsiderReport` in `lib/portfolios.ts` — same
 * endpoints, same XML parser — just indexed by issuer instead of by
 * reporting owner.
 *
 * SEC dual-indexes Form 4 filings: the same accession appears in BOTH
 * the issuer's submissions.json AND every reporting owner's. The XML
 * file itself is served from Archives under any filer's CIK path, so
 * we use the issuer's CIK for the Archive URL too.
 */

import {
  SEC_ARCHIVE,
  SEC_BASE,
  mapConcurrent,
  parseForm4Xml,
  secHeaders,
  type SubmissionsResponse,
} from "@/lib/portfolios";

const INSIDER_FORMS = new Set(["3", "4", "5", "3/A", "4/A", "5/A"]);

export interface IssuerInsiderTransaction {
  /**
   * Deterministic across re-fetches — used by the stock-watch engine
   * to dedup already-notified transactions. Encodes issuer, accession,
   * reporter and the pivotal transaction fields.
   */
  eventId: string;
  ticker: string;
  issuerName: string;
  issuerCik: string;
  reporterName: string;
  reporterCik: string | null;
  reporterRelation: string | null;
  action: "BUY" | "SELL" | "OTHER";
  actionLabel: string;
  transactionCode: string | null;
  shares: number;
  pricePerShare: number | null;
  transactionDate: string | null;
  filingDate: string | null;
  formType: string;
  accessionNumber: string;
  filingUrl: string;
  securityTitle: string;
}

export interface IssuerInsiderReport {
  ticker: string;
  issuerName: string;
  issuerCik: string;
  transactions: IssuerInsiderTransaction[];
  filingsParsed: number;
  filingsSkipped: number;
  fetchedAt: string;
  source: string;
}

/** Map a Form 4 A/D flag + transaction code to a BUY/SELL/OTHER bucket. */
function classifyAction(
  acqDisp: "A" | "D" | null,
  transactionCode: string | null,
): { action: "BUY" | "SELL" | "OTHER"; label: string } {
  const code = (transactionCode ?? "").toUpperCase();
  // P = open-market purchase, S = open-market sale, A = grant/award,
  // M = option exercise, F = payment of tax via shares withheld, etc.
  // We treat P as BUY and S as SELL directly; other codes fall back
  // to the acquired/disposed flag.
  if (code === "P") return { action: "BUY", label: "Open-market buy" };
  if (code === "S") return { action: "SELL", label: "Open-market sell" };
  if (acqDisp === "A") return { action: "BUY", label: labelFromCode(code, "acquired") };
  if (acqDisp === "D") return { action: "SELL", label: labelFromCode(code, "disposed") };
  return { action: "OTHER", label: labelFromCode(code, "other") };
}

function labelFromCode(code: string, fallback: string): string {
  switch (code) {
    case "P": return "Open-market buy";
    case "S": return "Open-market sell";
    case "A": return "Grant / award";
    case "M": return "Option exercise";
    case "F": return "Tax withholding";
    case "G": return "Gift";
    case "J": return "Other (Rule 16a)";
    case "V": return "Voluntary reported";
    case "X": return "Option exercise (in-the-money)";
    case "D": return "Disposition to issuer";
    default:  return fallback === "acquired" ? "Acquired"
            : fallback === "disposed" ? "Disposed"
            : "Other transaction";
  }
}

/** Build a stable event id: issuer + accession + reporter + transaction hash. */
function eventIdFor(
  issuerCik: string,
  accessionNumber: string,
  reporterCik: string | null,
  transactionCode: string | null,
  transactionDate: string | null,
  shares: number,
): string {
  const reporterKey = reporterCik ?? "unknown";
  const codeKey = transactionCode ?? "-";
  const dateKey = transactionDate ?? "-";
  const sharesKey = Number.isFinite(shares) ? shares.toString() : "-";
  return `stock:${issuerCik}:${accessionNumber}:${reporterKey}:${codeKey}:${dateKey}:${sharesKey}`;
}

/**
 * Fetch recent insider transactions for a company by CIK.
 *
 * `limit` caps how many filings we parse in one tick — SEC returns
 * ~1000 most-recent, but for polling we only care about the newest few.
 */
export async function fetchIssuerInsiderTransactions(
  cik: string,
  ticker: string,
  limit = 20,
): Promise<IssuerInsiderReport> {
  const submissionsUrl = `${SEC_BASE}/submissions/CIK${cik}.json`;
  const subRes = await fetch(submissionsUrl, {
    headers: secHeaders(),
    cache: "no-store",
  });
  if (!subRes.ok) {
    throw new Error(`SEC submissions GET (${cik}) → HTTP ${subRes.status}`);
  }
  const sub = (await subRes.json()) as SubmissionsResponse;
  const recent = sub?.filings?.recent;
  const issuerName = sub?.name ?? ticker;

  if (!recent) {
    return {
      ticker,
      issuerName,
      issuerCik: cik,
      transactions: [],
      filingsParsed: 0,
      filingsSkipped: 0,
      fetchedAt: new Date().toISOString(),
      source: submissionsUrl,
    };
  }

  interface FilingIdent {
    form: string;
    accessionNumber: string;
    primaryDocument: string;
    filingDate: string;
  }
  const filings: FilingIdent[] = [];
  for (
    let i = 0;
    i < recent.form.length && filings.length < Math.max(5, Math.min(100, limit));
    i++
  ) {
    const form = recent.form[i]!;
    if (!INSIDER_FORMS.has(form)) continue;
    filings.push({
      form,
      accessionNumber: recent.accessionNumber[i]!,
      primaryDocument: recent.primaryDocument[i]!,
      filingDate: recent.filingDate[i] ?? "",
    });
  }

  const cikNoZeros = String(Number(cik));

  interface ParseResult { txs: IssuerInsiderTransaction[]; ok: boolean }
  const results = await mapConcurrent<FilingIdent, ParseResult>(
    filings,
    4,
    async (f) => {
      const accessionDashless = f.accessionNumber.replace(/-/g, "");
      const xmlFilename = f.primaryDocument.split("/").pop() ?? f.primaryDocument;
      const xmlUrl = `${SEC_ARCHIVE}/${cikNoZeros}/${accessionDashless}/${xmlFilename}`;
      const filingUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=${f.form.replace("/A", "")}&dateb=&owner=include&count=40`;
      try {
        const res = await fetch(xmlUrl, {
          headers: secHeaders(),
          cache: "no-store",
        });
        if (!res.ok) return { txs: [], ok: false };
        const xml = await res.text();
        const parsed = parseForm4Xml(
          xml,
          f.form,
          f.filingDate,
          f.accessionNumber,
          filingUrl,
        );
        const txs: IssuerInsiderTransaction[] = [];
        for (const tx of parsed.transactions) {
          // Only surface real transactions — holdings rows have no
          // transactionCode and would spam the watcher.
          if (!tx.transactionCode) continue;
          const cls = classifyAction(tx.acquiredDisposed, tx.transactionCode);
          txs.push({
            eventId: eventIdFor(
              cik,
              f.accessionNumber,
              parsed.reporterCik,
              tx.transactionCode,
              tx.transactionDate,
              tx.shares,
            ),
            ticker,
            issuerName: parsed.issuerName || issuerName,
            issuerCik: cik,
            reporterName: parsed.reporterName || "Unknown reporter",
            reporterCik: parsed.reporterCik,
            reporterRelation: parsed.reporterRelation,
            action: cls.action,
            actionLabel: cls.label,
            transactionCode: tx.transactionCode,
            shares: tx.shares,
            pricePerShare: tx.pricePerShare,
            transactionDate: tx.transactionDate,
            filingDate: tx.filingDate || f.filingDate,
            formType: tx.formType,
            accessionNumber: f.accessionNumber,
            filingUrl,
            securityTitle: tx.securityTitle,
          });
        }
        return { txs, ok: true };
      } catch {
        return { txs: [], ok: false };
      }
    },
  );

  const transactions = results.flatMap((r) => r.txs);
  const filingsParsed = results.filter((r) => r.ok).length;
  const filingsSkipped = results.length - filingsParsed;

  transactions.sort((a, b) => {
    const fa = a.filingDate ?? "";
    const fb = b.filingDate ?? "";
    if (fb !== fa) return fb.localeCompare(fa);
    return (b.transactionDate ?? "").localeCompare(a.transactionDate ?? "");
  });

  return {
    ticker,
    issuerName,
    issuerCik: cik,
    transactions,
    filingsParsed,
    filingsSkipped,
    fetchedAt: new Date().toISOString(),
    source: submissionsUrl,
  };
}
