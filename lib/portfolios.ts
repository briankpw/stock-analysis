/**
 * "Portfolios" — a lens on other people's trades:
 *   - Politicians: US Congress STOCK Act disclosures (House + Senate)
 *   - Fund managers: latest SEC 13F-HR institutional holdings
 *
 * Both feeds are public and free but have very different shapes, so this
 * module keeps them behind a common facade. Everything is fetched
 * server-side (SEC in particular blocks browser-origin CORS requests) and
 * cached aggressively — the underlying datasets update daily (politicians)
 * or quarterly (13F).
 */

import { unzipSync, strFromU8 } from "fflate";
import { settings } from "./config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Chamber = "House" | "Senate";
export type Party = "D" | "R" | "I";

export interface PoliticianPreset {
  id: string;
  name: string;
  chamber: Chamber;
  party: Party;
  role?: string;
}

export interface FundPreset {
  id: string;
  manager: string;   // Person (e.g. "Warren Buffett")
  firm: string;      // Firm (e.g. "Berkshire Hathaway")
  cik: string;       // 10-digit zero-padded CIK
  note?: string;
}

/**
 * A named individual who files insider disclosures with the SEC as a
 * "reporting owner" — CEOs, founders, board members, etc. Their filings
 * (Forms 3/4/5) show holdings + transactions at every company where they
 * hold an insider role, and are the only public source for
 * "how many shares does <famous person> own of <ticker>".
 */
export interface PersonPreset {
  id: string;
  name: string;
  role: string;      // e.g. "Tesla CEO & Director"
  cik: string;       // 10-digit zero-padded SEC reporting-owner CIK
  note?: string;
}

/**
 * A single PTR filing announcement from the House Clerk. Each filing is a
 * separate PDF that itself lists 1+ underlying trades — we can't extract
 * those trade rows without parsing the PDF (out of scope for the MVP), so
 * we surface the filing metadata and link users straight to the PDF.
 */
export interface PoliticianFiling {
  docId: string;
  filingType: string;         // "P" for Periodic Transaction Report
  filingDate: string | null;  // ISO date
  year: number;
  stateDst: string | null;
  pdfUrl: string;
}

export interface PoliticianReport {
  preset: PoliticianPreset;
  filings: PoliticianFiling[];
  totalCount: number;
  fetchedAt: string;
  source: string;
  /**
   * Set true when we're pointing at a chamber this feed doesn't cover
   * (Senate uses a separate, gated site — we don't scrape it).
   */
  chamberUnsupported?: boolean;
}

export interface FundHolding {
  issuer: string;
  cusip: string;
  titleOfClass: string;
  value: number;                        // Reported dollar value (post-2022 = whole USD)
  shares: number;
  shareType: string;                    // "SH" or "PRN"
  putCall: string | null;
  pctOfPortfolio: number | null;
  investmentDiscretion: string | null;
}

export interface FundReport {
  preset: FundPreset;
  reportPeriod: string | null;          // "YYYY-MM-DD"
  filedAt: string | null;               // ISO
  accessionNumber: string | null;
  totalValue: number;
  positionCount: number;
  holdings: FundHolding[];
  filingUrl: string | null;
  fetchedAt: string;
}

/**
 * One line-item parsed from a Form 3/4/5. We only surface non-derivative
 * securities (common / preferred stock) — options, warrants, and RSUs
 * from `<derivativeTable>` are intentionally omitted to keep the "how
 * many shares?" view straightforward.
 */
export interface InsiderTransaction {
  filingDate: string | null;
  transactionDate: string | null;
  formType: string;                 // "3", "4", "5" (or "/A" amendments)
  issuerName: string;
  issuerTicker: string | null;
  issuerCik: string | null;
  securityTitle: string;            // e.g. "Common Stock", "Class A Common Stock"
  /**
   * SEC transaction code:
   *   P = open-market buy         S = open-market sell
   *   A = grant / stock award     M = option exercise
   *   F = tax withholding         G = gift        (empty for holdings-only rows)
   * @see https://www.sec.gov/about/forms/form4data.pdf
   */
  transactionCode: string | null;
  acquiredDisposed: "A" | "D" | null;
  shares: number;
  pricePerShare: number | null;
  sharesOwnedFollowing: number | null;
  directOrIndirect: "D" | "I" | null;
  accessionNumber: string;
  filingUrl: string;
}

/**
 * Aggregated current position at one issuer, derived from the most
 * recent Form 3/4/5 that gave us a `sharesOwnedFollowingTransaction`
 * for common stock. Note: this only captures direct + indirect holdings
 * disclosed under Section 16. Trusts and non-insider positions are not
 * shown.
 */
export interface InsiderHolding {
  issuerName: string;
  issuerTicker: string | null;
  issuerCik: string | null;
  sharesHeld: number;
  lastFilingDate: string | null;
  lastTransactionDate: string | null;
  totalFilingsSeen: number;
}

export interface PersonReport {
  preset: PersonPreset;
  holdings: InsiderHolding[];
  recentTransactions: InsiderTransaction[];
  /** How many Form 3/4/5 XMLs we successfully parsed for this report. */
  filingsParsed: number;
  /** How many were skipped (fetch error, unparseable, no common-stock rows). */
  filingsSkipped: number;
  fetchedAt: string;
  source: string;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * Members of Congress that get the most press for their trading activity.
 * `id` matches the value we filter house-stock-watcher / senate-stock-watcher
 * data with (case-insensitive substring match on `representative`/`senator`).
 */
export const POLITICIAN_PRESETS: readonly PoliticianPreset[] = [
  { id: "pelosi", name: "Nancy Pelosi", chamber: "House", party: "D", role: "Former Speaker" },
  { id: "gottheimer", name: "Josh Gottheimer", chamber: "House", party: "D" },
  { id: "mccaul", name: "Michael McCaul", chamber: "House", party: "R" },
  { id: "khanna", name: "Ro Khanna", chamber: "House", party: "D" },
  { id: "greene", name: "Marjorie Taylor Greene", chamber: "House", party: "R" },
  { id: "crenshaw", name: "Dan Crenshaw", chamber: "House", party: "R" },
  { id: "tuberville", name: "Tommy Tuberville", chamber: "Senate", party: "R" },
  { id: "cruz", name: "Ted Cruz", chamber: "Senate", party: "R" },
  { id: "hawley", name: "Josh Hawley", chamber: "Senate", party: "R" },
  { id: "capito", name: "Shelley Moore Capito", chamber: "Senate", party: "R" },
  { id: "whitehouse", name: "Sheldon Whitehouse", chamber: "Senate", party: "D" },
  { id: "warren", name: "Elizabeth Warren", chamber: "Senate", party: "D" },
] as const;

/**
 * Institutional filers with a "watched by retail" reputation. Each `cik`
 * MUST be zero-padded to 10 digits — that's the format the SEC submissions
 * API expects in the URL path.
 */
export const FUND_PRESETS: readonly FundPreset[] = [
  {
    id: "berkshire",
    manager: "Warren Buffett",
    firm: "Berkshire Hathaway",
    cik: "0001067983",
    note: "Filed via Berkshire Hathaway Inc.",
  },
  {
    id: "pershing",
    manager: "Bill Ackman",
    firm: "Pershing Square Capital",
    cik: "0001336528",
  },
  {
    id: "scion",
    manager: "Michael Burry",
    firm: "Scion Asset Management",
    cik: "0001649339",
    note: "Small, concentrated portfolio; often uses put/call options.",
  },
  {
    id: "ark",
    manager: "Cathie Wood",
    firm: "Ark Investment Management",
    cik: "0001697748",
  },
  {
    id: "bridgewater",
    manager: "Ray Dalio (founder)",
    firm: "Bridgewater Associates",
    cik: "0001350694",
  },
  {
    id: "tiger",
    manager: "Chase Coleman",
    firm: "Tiger Global Management",
    cik: "0001167483",
  },
  {
    id: "thirdpoint",
    manager: "Dan Loeb",
    firm: "Third Point",
    cik: "0001040273",
  },
  {
    id: "appaloosa",
    manager: "David Tepper",
    firm: "Appaloosa Management",
    cik: "0001656456",
  },
] as const;

/**
 * Individuals with heavily-watched insider filings. Each `cik` is a
 * verified 10-digit reporting-owner CIK — obtain new ones from
 *   https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&owner=include&type=4
 * or by searching a person's name on data.sec.gov and grabbing the
 * `cik` field from the submissions JSON.
 */
export const PERSON_PRESETS: readonly PersonPreset[] = [
  { id: "musk",    name: "Elon Musk",       role: "Tesla CEO & Director",     cik: "0001494730" },
  { id: "zuck",    name: "Mark Zuckerberg", role: "Meta CEO & Chairman",      cik: "0001548760" },
  { id: "bezos",   name: "Jeff Bezos",      role: "Amazon Founder",           cik: "0001043298" },
  { id: "cook",    name: "Tim Cook",        role: "Apple CEO",                cik: "0001214156" },
  { id: "nadella", name: "Satya Nadella",   role: "Microsoft CEO & Chairman", cik: "0001513142" },
] as const;

export function findPoliticianPreset(id: string): PoliticianPreset | undefined {
  return POLITICIAN_PRESETS.find((p) => p.id === id);
}
export function findFundPreset(id: string): FundPreset | undefined {
  return FUND_PRESETS.find((f) => f.id === id);
}
export function findPersonPreset(id: string): PersonPreset | undefined {
  return PERSON_PRESETS.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

type CacheEntry<T> = { value: T; expiresAt: number };
const cache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}
function cacheSet<T>(key: string, value: T, ttlSeconds = settings.portfolios.cacheTtlSeconds): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

// ---------------------------------------------------------------------------
// Politician trades — STOCK Act (House + Senate stock-watcher datasets)
// ---------------------------------------------------------------------------

/**
 * Distinct from a generic HTTP error: signals "this data source is
 * externally unreachable" so the UI can render a friendly explanation
 * instead of a generic red banner.
 */
export class DataSourceUnavailableError extends Error {
  constructor(readonly source: string, readonly lastStatus: number, message?: string) {
    super(message ?? `Data source ${source} is currently unreachable (last status ${lastStatus}).`);
    this.name = "DataSourceUnavailableError";
  }
}

/**
 * The House Clerk publishes an annual ZIP of all financial disclosures at
 * a very stable URL. Each ZIP contains `{YYYY}FD.xml` — a flat list of
 * `<Member>` blocks. `FilingType=P` marks a Periodic Transaction Report
 * (i.e. a STOCK Act filing). The Senate uses a separate portal
 * (efdsearch.senate.gov) that requires an interactive session cookie and
 * is not scraped here.
 */
const HOUSE_CLERK_BASE = "https://disclosures-clerk.house.gov";
const HOUSE_CLERK_ZIP = (year: number) =>
  `${HOUSE_CLERK_BASE}/public_disc/financial-pdfs/${year}FD.ZIP`;
const HOUSE_CLERK_PTR_PDF = (year: number, docId: string) =>
  `${HOUSE_CLERK_BASE}/public_disc/ptr-pdfs/${year}/${docId}.pdf`;

/** ISO-date normalizer — accepts "M/D/YYYY", "MM/DD/YYYY", "YYYY-MM-DD". */
function toIsoDate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const mmdd = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (mmdd) {
    const [, m, d, y] = mmdd;
    return `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  }
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (iso) return iso[1]!;
  return null;
}

/** Cheap XML tag reader — the House feed is a flat list of <Member> blocks. */
function readTag(source: string, tag: string): string {
  const re = new RegExp(`<${tag}[^/>]*/>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`);
  const m = re.exec(source);
  if (!m) return "";
  return (m[1] ?? "").trim();
}

interface HouseFilingRaw {
  first: string;
  last: string;
  suffix: string;
  filingType: string;
  stateDst: string;
  year: number;
  filingDate: string | null;
  docId: string;
}

/**
 * Download and unzip a year's disclosure bundle from the House Clerk,
 * returning every `<Member>` block parsed as a plain object. Cached
 * aggressively — this is a ~700KB XML file per year that we don't want
 * to redownload on every request.
 */
async function fetchHouseFilingsForYear(year: number): Promise<HouseFilingRaw[]> {
  const key = `portfolios:houseclerk:${year}`;
  const cached = cacheGet<HouseFilingRaw[]>(key);
  if (cached) return cached;

  const url = HOUSE_CLERK_ZIP(year);
  const res = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": settings.portfolios.secUserAgent },
  });
  if (!res.ok) {
    throw new DataSourceUnavailableError("house-clerk", res.status);
  }
  const zipBytes = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(zipBytes);
  const xmlName = Object.keys(files).find((n) => n.toLowerCase().endsWith(".xml"));
  if (!xmlName) {
    throw new Error(`House Clerk ZIP for ${year} contained no XML file`);
  }
  const xml = strFromU8(files[xmlName]!);

  const blocks = xml.match(/<Member\b[\s\S]*?<\/Member>/g) ?? [];
  const rows: HouseFilingRaw[] = blocks.map((block) => ({
    first: readTag(block, "First"),
    last: readTag(block, "Last"),
    suffix: readTag(block, "Suffix"),
    filingType: readTag(block, "FilingType"),
    stateDst: readTag(block, "StateDst"),
    year,
    filingDate: toIsoDate(readTag(block, "FilingDate")),
    docId: readTag(block, "DocID"),
  }));

  cacheSet(key, rows);
  return rows;
}

/** House Clerk ZIPs are published annually. Pull the current + prior year. */
async function fetchRecentHouseFilings(): Promise<HouseFilingRaw[]> {
  const currentYear = new Date().getUTCFullYear();
  const years = [currentYear, currentYear - 1];
  const results: HouseFilingRaw[] = [];
  let firstError: unknown = null;
  for (const y of years) {
    try {
      const rows = await fetchHouseFilingsForYear(y);
      results.push(...rows);
    } catch (e) {
      firstError = firstError ?? e;
    }
  }
  if (results.length === 0) {
    // Both years failed — propagate the first error so the UI can react.
    throw firstError ?? new Error("no House Clerk filings loaded");
  }
  return results;
}

/**
 * Filter the House Clerk feed to just the PTR filings for one preset
 * politician. Matches on last name + first-name-prefix so we don't confuse
 * Nancy Pelosi with e.g. Christine Pelosi.
 */
export async function fetchPoliticianTrades(
  id: string,
  limit = 200,
): Promise<PoliticianReport> {
  const preset = findPoliticianPreset(id);
  if (!preset) throw new Error(`Unknown politician preset: ${id}`);

  const key = `portfolios:politician:${preset.id}:${limit}`;
  const cached = cacheGet<PoliticianReport>(key);
  if (cached) return cached;

  // The House Clerk source is House-of-Representatives only. Senate PTR
  // filings live on efdsearch.senate.gov and require an interactive
  // session-cookie handshake — surface an explanatory report instead of
  // throwing so the UI shows a "not supported yet" panel per-senator.
  if (preset.chamber === "Senate") {
    const stub: PoliticianReport = {
      preset,
      filings: [],
      totalCount: 0,
      fetchedAt: new Date().toISOString(),
      source: "https://efdsearch.senate.gov/search/",
      chamberUnsupported: true,
    };
    cacheSet(key, stub);
    return stub;
  }

  const rows = await fetchRecentHouseFilings();

  const [firstNeedle, ...restNeedle] = preset.name.toLowerCase().split(/\s+/);
  const lastNeedle = restNeedle[restNeedle.length - 1] ?? "";

  const matched = rows.filter((r) => {
    if (r.filingType !== "P") return false;
    const first = r.first.toLowerCase();
    const last = r.last.toLowerCase();
    if (!last.includes(lastNeedle)) return false;
    // Guard against same-surname collisions (Pelosi vs Christine Pelosi).
    if (firstNeedle && !first.startsWith(firstNeedle)) return false;
    return true;
  });

  const filings: PoliticianFiling[] = matched
    .map((r) => ({
      docId: r.docId,
      filingType: r.filingType,
      filingDate: r.filingDate,
      year: r.year,
      stateDst: r.stateDst || null,
      pdfUrl: HOUSE_CLERK_PTR_PDF(r.year, r.docId),
    }))
    .sort((a, b) => (b.filingDate ?? "").localeCompare(a.filingDate ?? ""));

  const report: PoliticianReport = {
    preset,
    filings: filings.slice(0, limit),
    totalCount: filings.length,
    fetchedAt: new Date().toISOString(),
    source: `${HOUSE_CLERK_BASE}/FinancialDisclosure`,
  };
  cacheSet(key, report);
  return report;
}

// ---------------------------------------------------------------------------
// SEC 13F — fund holdings
// ---------------------------------------------------------------------------

const SEC_BASE = "https://data.sec.gov";
const SEC_ARCHIVE = "https://www.sec.gov/Archives/edgar/data";

function secHeaders(): HeadersInit {
  return {
    // SEC's usage policy: identify yourself with a plain-text User-Agent
    // that includes contact info. Rate-limited to 10 requests per second.
    "User-Agent": settings.portfolios.secUserAgent,
    "Accept": "application/json,text/xml,application/xml,*/*;q=0.5",
  };
}

interface SubmissionsRecent {
  accessionNumber: string[];
  form: string[];
  filingDate: string[];
  reportDate: string[];
  primaryDocument: string[];
}

interface SubmissionsResponse {
  cik: string;
  name: string;
  filings: { recent: SubmissionsRecent };
}

/** Locate the accession number of the latest 13F-HR (or 13F-HR/A) filing. */
async function findLatest13F(cik: string): Promise<{
  accessionNumber: string;
  primaryDocument: string;
  reportDate: string;
  filingDate: string;
} | null> {
  const url = `${SEC_BASE}/submissions/CIK${cik}.json`;
  const res = await fetch(url, { headers: secHeaders(), cache: "no-store" });
  if (!res.ok) {
    throw new Error(`SEC submissions GET → HTTP ${res.status}`);
  }
  const body = (await res.json()) as SubmissionsResponse;
  const recent = body?.filings?.recent;
  if (!recent) return null;

  for (let i = 0; i < recent.form.length; i++) {
    const form = recent.form[i]!;
    if (form === "13F-HR" || form === "13F-HR/A") {
      return {
        accessionNumber: recent.accessionNumber[i]!,
        primaryDocument: recent.primaryDocument[i]!,
        reportDate: recent.reportDate[i] ?? "",
        filingDate: recent.filingDate[i] ?? "",
      };
    }
  }
  return null;
}

interface SecIndexEntry {
  name: string;
  type?: string;
  size: number;
}

/** Locate the info-table XML inside a filing accession bundle. */
async function findInfoTableXml(
  cikNoZeros: string,
  accessionDashless: string,
): Promise<string | null> {
  const indexUrl = `${SEC_ARCHIVE}/${cikNoZeros}/${accessionDashless}/index.json`;
  const res = await fetch(indexUrl, { headers: secHeaders(), cache: "no-store" });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    directory?: { item?: SecIndexEntry[] };
  };
  const items = body?.directory?.item ?? [];

  // Prefer files literally named informationtable*.xml; fall back to any
  // .xml that isn't `primary_doc.xml` (which is just the filing metadata).
  const info = items.find((it) => /informationtable/i.test(it.name) && it.name.endsWith(".xml"));
  if (info) return info.name;
  const other = items.find(
    (it) => it.name.endsWith(".xml") && it.name.toLowerCase() !== "primary_doc.xml",
  );
  return other?.name ?? null;
}

/**
 * Minimal SEC 13F-HR `informationTable` XML parser. The schema is very
 * rigid — a flat list of `<infoTable>` blocks — so a regex scan is
 * sufficient (and avoids adding an xml dep). Handles both namespaced
 * (`<ns1:infoTable>`) and un-namespaced variants.
 */
function parse13FXml(xml: string): FundHolding[] {
  const holdings: FundHolding[] = [];
  const blockRe = /<(?:[a-zA-Z]+:)?infoTable\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z]+:)?infoTable>/g;
  const tag = (name: string, source: string): string | null => {
    const re = new RegExp(`<(?:[a-zA-Z]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[a-zA-Z]+:)?${name}>`);
    const m = re.exec(source);
    return m ? m[1]!.trim() : null;
  };

  let m: RegExpExecArray | null;
  let total = 0;
  while ((m = blockRe.exec(xml)) !== null) {
    const block = m[1]!;
    const issuer = tag("nameOfIssuer", block) ?? "";
    const titleOfClass = tag("titleOfClass", block) ?? "";
    const cusip = tag("cusip", block) ?? "";
    const rawValue = tag("value", block);
    const value = rawValue ? Number(rawValue.replace(/[^0-9.-]/g, "")) : 0;
    const shrsBlock = tag("shrsOrPrnAmt", block) ?? "";
    const shares = Number((tag("sshPrnamt", shrsBlock) ?? "0").replace(/[^0-9.-]/g, ""));
    const shareType = tag("sshPrnamtType", shrsBlock) ?? "SH";
    const putCall = tag("putCall", block);
    const investmentDiscretion = tag("investmentDiscretion", block);
    total += Number.isFinite(value) ? value : 0;
    holdings.push({
      issuer,
      titleOfClass,
      cusip,
      value: Number.isFinite(value) ? value : 0,
      shares: Number.isFinite(shares) ? shares : 0,
      shareType,
      putCall: putCall ?? null,
      pctOfPortfolio: null, // filled below once total is known
      investmentDiscretion,
    });
  }
  if (total > 0) {
    for (const h of holdings) {
      h.pctOfPortfolio = h.value / total;
    }
  }
  return holdings;
}

/**
 * Pull the most recent 13F-HR filing for a fund preset and return the
 * decomposed holdings. `holdings` sorted by value descending.
 */
export async function fetchFund13F(id: string): Promise<FundReport> {
  const preset = findFundPreset(id);
  if (!preset) throw new Error(`Unknown fund preset: ${id}`);

  const key = `portfolios:fund:${preset.id}`;
  const cached = cacheGet<FundReport>(key);
  if (cached) return cached;

  const latest = await findLatest13F(preset.cik);
  if (!latest) {
    const empty: FundReport = {
      preset,
      reportPeriod: null,
      filedAt: null,
      accessionNumber: null,
      totalValue: 0,
      positionCount: 0,
      holdings: [],
      filingUrl: null,
      fetchedAt: new Date().toISOString(),
    };
    cacheSet(key, empty);
    return empty;
  }

  const cikNoZeros = String(Number(preset.cik));
  const accessionDashless = latest.accessionNumber.replace(/-/g, "");
  const infoTableName = await findInfoTableXml(cikNoZeros, accessionDashless);
  const filingUrl = `${SEC_ARCHIVE}/${cikNoZeros}/${accessionDashless}/${latest.primaryDocument}`;

  let holdings: FundHolding[] = [];
  if (infoTableName) {
    const xmlUrl = `${SEC_ARCHIVE}/${cikNoZeros}/${accessionDashless}/${infoTableName}`;
    const xmlRes = await fetch(xmlUrl, { headers: secHeaders(), cache: "no-store" });
    if (xmlRes.ok) {
      const xml = await xmlRes.text();
      holdings = parse13FXml(xml);
    }
  }

  holdings.sort((a, b) => b.value - a.value);
  const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);

  const report: FundReport = {
    preset,
    reportPeriod: latest.reportDate || null,
    filedAt: latest.filingDate ? new Date(latest.filingDate).toISOString() : null,
    accessionNumber: latest.accessionNumber,
    totalValue,
    positionCount: holdings.length,
    holdings,
    filingUrl,
    fetchedAt: new Date().toISOString(),
  };
  cacheSet(key, report);
  return report;
}

// ---------------------------------------------------------------------------
// SEC Forms 3/4/5 — individual insider holdings & transactions
// ---------------------------------------------------------------------------

/**
 * Pull a leaf value out of a Form 4 XML node, handling both wrapped and
 * un-wrapped forms:
 *
 *   <transactionShares><value>500</value></transactionShares>  → "500"
 *   <transactionCode>M</transactionCode>                        → "M"
 *
 * Returns `null` when the tag isn't found. `<footnoteId>` and other
 * sibling elements inside the outer tag are ignored.
 */
function form4Extract(name: string, source: string): string | null {
  const blockRe = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`);
  const bm = blockRe.exec(source);
  if (!bm) return null;
  const inner = bm[1]!;
  const vm = /<value\b[^>]*>([\s\S]*?)<\/value>/.exec(inner);
  if (vm) return vm[1]!.trim();
  return inner.trim();
}

/**
 * Parse a single Form 3/4/5 XML document into zero-or-more line items.
 * We surface all `<nonDerivativeTransaction>` and `<nonDerivativeHolding>`
 * blocks (i.e. common / preferred stock rows), and skip everything under
 * `<derivativeTable>` (options / warrants / RSUs).
 */
function parseForm4Xml(
  xml: string,
  formType: string,
  filingDate: string,
  accessionNumber: string,
  filingUrl: string,
): {
  transactions: InsiderTransaction[];
  issuerName: string;
  issuerTicker: string | null;
  issuerCik: string | null;
} {
  const issuerBlockRe = /<issuer\b[^>]*>([\s\S]*?)<\/issuer>/;
  const issuerBlock = issuerBlockRe.exec(xml)?.[1] ?? "";
  const issuerName = form4Extract("issuerName", issuerBlock) ?? "";
  const rawTicker = form4Extract("issuerTradingSymbol", issuerBlock) ?? "";
  const issuerTicker = rawTicker ? rawTicker.toUpperCase() : null;
  const issuerCik = form4Extract("issuerCik", issuerBlock) ?? null;

  const transactions: InsiderTransaction[] = [];

  const pushTx = (block: string, kind: "transaction" | "holding") => {
    const securityTitle = form4Extract("securityTitle", block) ?? "";
    const transactionDate = form4Extract("transactionDate", block);
    const transactionCode = form4Extract("transactionCode", block);
    const acqDisp = form4Extract("transactionAcquiredDisposedCode", block);
    const sharesStr = form4Extract("transactionShares", block);
    const priceStr = form4Extract("transactionPricePerShare", block);
    const postShares = form4Extract("sharesOwnedFollowingTransaction", block);
    const directOrIndirect = form4Extract("directOrIndirectOwnership", block);

    const parseFinite = (s: string | null): number | null => {
      if (!s) return null;
      const n = Number(s.replace(/,/g, ""));
      return Number.isFinite(n) ? n : null;
    };

    const shares = parseFinite(sharesStr) ?? 0;
    const post = parseFinite(postShares);
    const price = parseFinite(priceStr);

    // For pure holdings rows we don't emit unless we have a post amount —
    // otherwise the row is uninformative.
    if (kind === "holding" && post === null) return;

    transactions.push({
      filingDate,
      transactionDate,
      formType,
      issuerName,
      issuerTicker,
      issuerCik,
      securityTitle,
      transactionCode: transactionCode || null,
      acquiredDisposed: acqDisp === "A" || acqDisp === "D" ? acqDisp : null,
      shares,
      pricePerShare: price,
      sharesOwnedFollowing: post,
      directOrIndirect: directOrIndirect === "D" || directOrIndirect === "I" ? directOrIndirect : null,
      accessionNumber,
      filingUrl,
    });
  };

  const txRe = /<nonDerivativeTransaction\b[^>]*>([\s\S]*?)<\/nonDerivativeTransaction>/g;
  let m: RegExpExecArray | null;
  while ((m = txRe.exec(xml)) !== null) pushTx(m[1]!, "transaction");

  const holdRe = /<nonDerivativeHolding\b[^>]*>([\s\S]*?)<\/nonDerivativeHolding>/g;
  while ((m = holdRe.exec(xml)) !== null) pushTx(m[1]!, "holding");

  return { transactions, issuerName, issuerTicker, issuerCik };
}

/**
 * Roll up a stream of Form 3/4/5 transactions into a current-position
 * summary per issuer.
 *
 * Strategy: for each issuer, walk the transactions in most-recent-first
 * order and pick the FIRST one that has a non-null `sharesOwnedFollowing`
 * — that's the most recent authoritative "here's what I own" datapoint.
 * Rows that only report a delta (no post-amount) advance our count of
 * observed filings but don't determine the balance.
 */
function summariseHoldings(transactions: InsiderTransaction[]): InsiderHolding[] {
  const byKey = new Map<string, InsiderTransaction[]>();
  for (const tx of transactions) {
    // Group by ticker when we have one, otherwise fall back to CIK, otherwise name.
    const key = tx.issuerTicker || tx.issuerCik || tx.issuerName;
    if (!key) continue;
    const arr = byKey.get(key) ?? [];
    arr.push(tx);
    byKey.set(key, arr);
  }

  const holdings: InsiderHolding[] = [];
  for (const [, group] of byKey) {
    // Newest first — filingDate is the SEC canonical ordering.
    const sorted = [...group].sort((a, b) =>
      (b.filingDate ?? "").localeCompare(a.filingDate ?? ""),
    );
    const withPost = sorted.find((t) => t.sharesOwnedFollowing !== null);
    if (!withPost || !withPost.sharesOwnedFollowing) continue;
    holdings.push({
      issuerName: withPost.issuerName,
      issuerTicker: withPost.issuerTicker,
      issuerCik: withPost.issuerCik,
      sharesHeld: withPost.sharesOwnedFollowing,
      lastFilingDate: withPost.filingDate,
      lastTransactionDate: withPost.transactionDate,
      totalFilingsSeen: sorted.length,
    });
  }

  return holdings.sort((a, b) => b.sharesHeld - a.sharesHeld);
}

/** Small semaphore so we don't blow past SEC's 10 req/sec rate limit. */
async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

interface InsiderFilingIdent {
  form: string;
  accessionNumber: string;
  primaryDocument: string;
  filingDate: string;
}

/**
 * Fetch + parse the last `limit` Form 3/4/5 filings for a preset person
 * from SEC EDGAR, returning:
 *   - `holdings`  — current beneficial ownership per issuer
 *   - `recentTransactions` — the flat, chronological transaction log
 *
 * Cached server-side for `settings.portfolios.cacheTtlSeconds`. First
 * call for a fresh person is slow (~30 SEC roundtrips at 4-way
 * concurrency); subsequent calls are instant.
 */
export async function fetchPersonInsiderReport(
  id: string,
  limit = 30,
): Promise<PersonReport> {
  const preset = findPersonPreset(id);
  if (!preset) throw new Error(`Unknown person preset: ${id}`);

  const clampedLimit = Math.max(5, Math.min(120, limit));
  const key = `portfolios:person:${preset.id}:${clampedLimit}`;
  const cached = cacheGet<PersonReport>(key);
  if (cached) return cached;

  // Step 1 — pull the submissions index and pluck all insider filings.
  const submissionsUrl = `${SEC_BASE}/submissions/CIK${preset.cik}.json`;
  const subRes = await fetch(submissionsUrl, { headers: secHeaders(), cache: "no-store" });
  if (!subRes.ok) {
    throw new DataSourceUnavailableError("sec-edgar-submissions", subRes.status);
  }
  const subBody = (await subRes.json()) as SubmissionsResponse;
  const recent = subBody?.filings?.recent;
  if (!recent) {
    const empty: PersonReport = {
      preset,
      holdings: [],
      recentTransactions: [],
      filingsParsed: 0,
      filingsSkipped: 0,
      fetchedAt: new Date().toISOString(),
      source: submissionsUrl,
    };
    cacheSet(key, empty);
    return empty;
  }

  const filings: InsiderFilingIdent[] = [];
  const INSIDER_FORMS = new Set(["3", "4", "5", "3/A", "4/A", "5/A"]);
  for (let i = 0; i < recent.form.length && filings.length < clampedLimit; i++) {
    const form = recent.form[i]!;
    if (!INSIDER_FORMS.has(form)) continue;
    filings.push({
      form,
      accessionNumber: recent.accessionNumber[i]!,
      primaryDocument: recent.primaryDocument[i]!,
      filingDate: recent.filingDate[i] ?? "",
    });
  }

  const cikNoZeros = String(Number(preset.cik));

  // Step 2 — fetch and parse each filing. XMLs live at the accession
  // folder under the plain filename (stripping any `xslF345X..*/`
  // stylesheet prefix in `primaryDocument`).
  interface ParseResult { txs: InsiderTransaction[]; ok: boolean }
  const results = await mapConcurrent<InsiderFilingIdent, ParseResult>(filings, 4, async (f) => {
    const accessionDashless = f.accessionNumber.replace(/-/g, "");
    const xmlFilename = f.primaryDocument.split("/").pop() ?? f.primaryDocument;
    const xmlUrl = `${SEC_ARCHIVE}/${cikNoZeros}/${accessionDashless}/${xmlFilename}`;
    const filingUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${preset.cik}&type=${f.form.replace("/A", "")}&dateb=&owner=include&count=40`;
    try {
      const res = await fetch(xmlUrl, { headers: secHeaders(), cache: "no-store" });
      if (!res.ok) return { txs: [], ok: false };
      const xml = await res.text();
      const { transactions } = parseForm4Xml(xml, f.form, f.filingDate, f.accessionNumber, filingUrl);
      return { txs: transactions, ok: transactions.length > 0 };
    } catch {
      return { txs: [], ok: false };
    }
  });

  const allTx = results.flatMap((r) => r.txs);
  const filingsParsed = results.filter((r) => r.ok).length;
  const filingsSkipped = results.length - filingsParsed;

  // Newest first for the "recent transactions" list.
  const recentTransactions = [...allTx].sort((a, b) => {
    const ba = a.filingDate ?? "";
    const bb = b.filingDate ?? "";
    if (bb !== ba) return bb.localeCompare(ba);
    return (b.transactionDate ?? "").localeCompare(a.transactionDate ?? "");
  });

  const holdings = summariseHoldings(allTx);

  const report: PersonReport = {
    preset,
    holdings,
    recentTransactions,
    filingsParsed,
    filingsSkipped,
    fetchedAt: new Date().toISOString(),
    source: submissionsUrl,
  };
  cacheSet(key, report);
  return report;
}

// ---------------------------------------------------------------------------
// List helper (used by the /portfolios page to render the preset chooser)
// ---------------------------------------------------------------------------

export interface PortfolioIndex {
  politicians: PoliticianPreset[];
  funds: FundPreset[];
  people: PersonPreset[];
}

export function listPresets(): PortfolioIndex {
  return {
    politicians: [...POLITICIAN_PRESETS],
    funds: [...FUND_PRESETS],
    people: [...PERSON_PRESETS],
  };
}
