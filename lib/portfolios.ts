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
import { extractText as _pdfExtractText } from "unpdf";
import { settings } from "./config";
import {
  listCustomFunds,
  listCustomPeople,
  listCustomPoliticians,
} from "./portfolio-presets";
import { timedFetch } from "./http";
import { createTtlCache } from "./utils";

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
 * separate PDF that itself lists 1+ underlying trades — we parse the PDFs
 * to surface those rows (see `PoliticianTrade`), but keep the filing-level
 * metadata here so the UI can group / link back to the source.
 */
export interface PoliticianFiling {
  docId: string;
  filingType: string;         // "P" for Periodic Transaction Report
  filingDate: string | null;  // ISO date
  year: number;
  stateDst: string | null;
  pdfUrl: string;
}

/**
 * A single trade row parsed out of a PTR PDF. House Clerk PTRs use a
 * standardised layout (see https://ethics.house.gov/financial-disclosure
 * for the form itself); the parser in `parsePtrText` is a best-effort
 * regex extractor that handles the common typed-form layout. Handwritten
 * or image-scanned PDFs will fail to parse and be silently skipped.
 */
export interface PoliticianTrade {
  /** Owner code: `SP` (spouse), `JT` (joint), `DC` (dependent child), `null` = filer themselves. */
  ownerCode: "SP" | "JT" | "DC" | null;
  assetName: string;
  ticker: string | null;
  /** SEC/House asset class code, e.g. `ST` (stock), `GS` (govt security), `OP` (option). */
  assetClass: string | null;
  /** `P` (Purchase), `S` (Sale), `S_PARTIAL` (partial sale), `E` (Exchange). */
  action: "P" | "S" | "S_PARTIAL" | "E" | null;
  transactionDate: string | null;   // ISO
  notificationDate: string | null;  // ISO
  amountLow: number;                // low end of the range in USD
  amountHigh: number;               // high end of the range in USD
  amountLabel: string;              // "$1,001 - $15,000"
  filingDocId: string;
  filingDate: string | null;
  filingYear: number;
  pdfUrl: string;
}

/**
 * Aggregate view of one ticker across every PTR trade we've parsed. The
 * `netEstimateLow` / `netEstimateHigh` bracket a very-conservative net
 * position — the House PTR form only reports dollar ranges, so we can
 * only bound the true P&L, never pin it down.
 */
export interface PoliticianHolding {
  ticker: string;
  assetName: string;
  buyCount: number;
  sellCount: number;
  totalBuyLow: number;    // sum of amountLow across P transactions
  totalBuyHigh: number;   // sum of amountHigh across P transactions
  totalSellLow: number;
  totalSellHigh: number;
  netEstimateLow: number;   // totalBuyLow - totalSellHigh (worst-case for the buyer)
  netEstimateHigh: number;  // totalBuyHigh - totalSellLow (best-case)
  lastTradeDate: string | null;
  trades: PoliticianTrade[];
}

export interface PoliticianReport {
  preset: PoliticianPreset;
  filings: PoliticianFiling[];
  totalCount: number;
  parsedTrades: PoliticianTrade[];    // flat, most recent first
  holdings: PoliticianHolding[];      // aggregated per ticker, largest activity first
  filingsParsed: number;              // number of PDFs successfully parsed
  filingsSkipped: number;             // fetch error, empty text, or no rows found
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
  {
    id:   "trump",
    name: "Donald J. Trump",
    role: "Chairman & founder, Trump Media (DJT) — reporting owner",
    cik:  "0000947033",
    note: "SEC insider filings for DJT holdings. Not the White House OGE 278 disclosure.",
  },
] as const;

export function findPoliticianPreset(id: string): PoliticianPreset | undefined {
  return (
    POLITICIAN_PRESETS.find((p) => p.id === id) ??
    listCustomPoliticians().find((p) => p.id === id)
  );
}
export function findFundPreset(id: string): FundPreset | undefined {
  return (
    FUND_PRESETS.find((f) => f.id === id) ??
    listCustomFunds().find((f) => f.id === id)
  );
}
export function findPersonPreset(id: string): PersonPreset | undefined {
  return (
    PERSON_PRESETS.find((p) => p.id === id) ??
    listCustomPeople().find((p) => p.id === id)
  );
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
//
// Bounded TTL cache — same shape as `lib/data.ts`. Uses `createTtlCache` so
// we get built-in expiration + LRU eviction rather than three ad-hoc copies
// of the same pattern.

const cache = createTtlCache<unknown>({
  defaultTtlMs: settings.portfolios.cacheTtlSeconds * 1000,
  maxSize: 300,
});

function cacheGet<T>(key: string): T | undefined {
  return cache.get(key) as T | undefined;
}
function cacheSet<T>(key: string, value: T, ttlSeconds = settings.portfolios.cacheTtlSeconds): void {
  cache.set(key, value, ttlSeconds * 1000);
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
  const res = await timedFetch(url, {
    cache: "no-store",
    headers: { "User-Agent": settings.portfolios.secUserAgent },
    timeoutMs: 45_000, // ZIP is ~700 KB; give downloads time on slow links
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
  /**
   * How many of the most-recent filings to actually download + parse for
   * per-trade rows. Each parse is one PDF fetch + one pdfjs text
   * extraction, so this is the primary cost knob. `0` disables parsing.
   */
  parseLimit = 20,
): Promise<PoliticianReport> {
  const preset = findPoliticianPreset(id);
  if (!preset) throw new Error(`Unknown politician preset: ${id}`);

  // Cache key is anchored on `parseLimit` (the primary cost knob).
  // Different `limit` values just re-slice the same underlying report
  // on read, so we don't want them to invalidate the cache.
  const key = `portfolios:politician:${preset.id}:${parseLimit}`;
  const cached = cacheGet<PoliticianReport>(key);
  if (cached) {
    // Reapply the caller's `limit` to the cached filings list so a
    // narrower request doesn't accidentally return an over-wide payload.
    return { ...cached, filings: cached.filings.slice(0, limit) };
  }

  // The House Clerk source is House-of-Representatives only. Senate PTR
  // filings live on efdsearch.senate.gov and require an interactive
  // session-cookie handshake — surface an explanatory report instead of
  // throwing so the UI shows a "not supported yet" panel per-senator.
  if (preset.chamber === "Senate") {
    const stub: PoliticianReport = {
      preset,
      filings: [],
      totalCount: 0,
      parsedTrades: [],
      holdings: [],
      filingsParsed: 0,
      filingsSkipped: 0,
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

  // Parse the top-N PDFs into per-trade rows. Concurrency capped so we
  // don't hammer the House Clerk site.
  const toParse = filings.slice(0, Math.max(0, parseLimit));
  const parseResults = await mapConcurrent(toParse, 4, async (f) => {
    try {
      const trades = await parsePoliticianPtr(f);
      return { trades, ok: trades.length > 0 };
    } catch {
      return { trades: [] as PoliticianTrade[], ok: false };
    }
  });

  const parsedTrades = parseResults
    .flatMap((r) => r.trades)
    .sort((a, b) => {
      const bd = b.transactionDate ?? b.filingDate ?? "";
      const ad = a.transactionDate ?? a.filingDate ?? "";
      return bd.localeCompare(ad);
    });

  const filingsParsed = parseResults.filter((r) => r.ok).length;
  const filingsSkipped = parseResults.length - filingsParsed;
  const holdings = summarisePoliticianTrades(parsedTrades);

  const report: PoliticianReport = {
    preset,
    filings: filings.slice(0, limit),
    totalCount: filings.length,
    parsedTrades,
    holdings,
    filingsParsed,
    filingsSkipped,
    fetchedAt: new Date().toISOString(),
    source: `${HOUSE_CLERK_BASE}/FinancialDisclosure`,
  };
  cacheSet(key, report);
  return report;
}

// ---------------------------------------------------------------------------
// PTR PDF parsing — extract per-trade rows from a House Clerk PDF
// ---------------------------------------------------------------------------

/**
 * Cache of extracted PDF text keyed by pdfUrl, so hot-reload doesn't repeat
 * pdfjs work. Successful extractions are cached indefinitely (PTR filings
 * are immutable once posted). Failures are cached with a short TTL so a
 * transient 5xx doesn't permanently pin the entry as "empty".
 */
interface PtrCacheEntry {
  text: string;
  /** null = success, cache indefinitely; number = failure, expires at ms epoch. */
  expiresAt: number | null;
}
const _ptrTextCache = new Map<string, PtrCacheEntry>();
const PTR_FAILURE_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function fetchPtrPdfText(pdfUrl: string): Promise<string | null> {
  const cached = _ptrTextCache.get(pdfUrl);
  if (cached) {
    if (cached.expiresAt === null || cached.expiresAt > Date.now()) {
      return cached.text || null;
    }
    _ptrTextCache.delete(pdfUrl);
  }

  const rememberFailure = () => {
    _ptrTextCache.set(pdfUrl, {
      text: "",
      expiresAt: Date.now() + PTR_FAILURE_TTL_MS,
    });
  };

  let res: Response;
  try {
    res = await timedFetch(pdfUrl, {
      cache: "no-store",
      headers: { "User-Agent": settings.portfolios.secUserAgent },
      timeoutMs: 30_000,
    });
  } catch {
    rememberFailure();
    return null;
  }
  if (!res.ok) {
    rememberFailure();
    return null;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());

  try {
    const { text } = await _pdfExtractText(bytes, { mergePages: true });
    _ptrTextCache.set(pdfUrl, { text, expiresAt: null });
    return text;
  } catch {
    rememberFailure();
    return null;
  }
}

/**
 * Regex-based extractor for the House Clerk PTR PDF text layout. The
 * form standard is documented at
 *   https://ethics.house.gov/financial-disclosure
 * — rows follow the pattern:
 *
 *   [Owner: SP/JT/DC/-]  <Company Name> (TICKER) [ASSET_CLASS]
 *   P|S|S(partial)|E   MM/DD/YYYY  MM/DD/YYYY  $LOW - $HIGH
 *
 * This is a best-effort parse; typed forms extract cleanly, scanned
 * / handwritten forms will return empty (they contain no text stream).
 */
/**
 * Fragments the PDF layout injects between rows: page headers, section
 * dividers, and boilerplate. We strip these from the "preTicker" region
 * to keep asset-name extraction from picking up the neighbouring row's
 * description.
 */
const PTR_BOILERPLATE_RE =
  /(?:Filing ID\s*#?\s*\d+|ID\s+Owner\s+Asset\s+Transaction\s+Type\s+Date\s+Notification\s+Date\s+Amount\s+Cap\.?\s*Gains\s*>\s*\$\d+\?|\b(?:F\s*[:\.]?\s*S\s*[:\.]?|D\s*:\s*[A-Z][a-z]+\s+[^.]*?\.))/g;

function parsePtrText(
  text: string,
  filing: Pick<PoliticianFiling, "docId" | "filingDate" | "year" | "pdfUrl">,
): PoliticianTrade[] {
  // Strip null bytes (pdfjs inserts them between label glyphs on House
  // Clerk forms) and collapse whitespace so we can regex over one linear
  // string.
  const normalized = text.replace(/\u0000/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  // Ticker in parens: 1-5 uppercase alnums, optional `.X` suffix (BRK.A).
  // Skip capture groups that look like transaction codes or amount labels.
  const NOT_A_TICKER = new Set([
    "SP", "JT", "DC", "D", "I", "A", "P", "S", "E", "II", "III", "IV",
    "AM", "PM", "US", "USA", "UK", "EU", "TBD", "OTC", "IPO", "NA",
  ]);
  const tickerRe = /\(([A-Z][A-Z0-9]{0,4}(?:\.[A-Z])?)\)/g;

  interface TickerMatch { ticker: string; index: number; endIndex: number; }
  const tickers: TickerMatch[] = [];
  let tm: RegExpExecArray | null;
  while ((tm = tickerRe.exec(normalized)) !== null) {
    if (NOT_A_TICKER.has(tm[1]!)) continue;
    tickers.push({ ticker: tm[1]!, index: tm.index, endIndex: tm.index + tm[0].length });
  }

  const trades: PoliticianTrade[] = [];
  for (let i = 0; i < tickers.length; i++) {
    const cur = tickers[i]!;
    const next = tickers[i + 1];
    const blockStart = i === 0 ? Math.max(0, cur.index - 200) : tickers[i - 1]!.endIndex;
    const blockEnd = next ? next.index : Math.min(normalized.length, cur.endIndex + 500);

    const post = normalized.slice(cur.endIndex, blockEnd);
    const preTicker = normalized.slice(blockStart, cur.index);

    // Amount range — the strongest signal a transaction actually occurred.
    // Format is always "$X,XXX - $Y,YYY" (with or without spaces around dash).
    const amtMatch = /\$([0-9][0-9,]*)\s*[-–]\s*\$?([0-9][0-9,]*)/.exec(post);
    if (!amtMatch) continue;
    const amountLow = Number(amtMatch[1]!.replace(/,/g, ""));
    const amountHigh = Number(amtMatch[2]!.replace(/,/g, ""));
    if (!Number.isFinite(amountLow) || !Number.isFinite(amountHigh)) continue;
    if (amountLow < 1000) continue;      // smallest PTR bucket is $1,001
    if (amountHigh < amountLow) continue;

    // Type + partial marker — appears just before the dates. Search only
    // within the pre-dates zone so descriptions like "Purchased 20 call
    // options" (in the D: line of the PREVIOUS row) can't leak in.
    const beforeAmt = post.slice(0, amtMatch.index);
    const firstDateIdx = beforeAmt.search(/\d{1,2}\/\d{1,2}\/\d{4}/);
    const typeZone = firstDateIdx > 0 ? beforeAmt.slice(0, firstDateIdx) : beforeAmt;
    let action: PoliticianTrade["action"] = null;
    const isPartial = /\(partial\)/i.test(typeZone);
    // Match a standalone P/S/E — preceded by space/pipe/`]`, followed by
    // space or `(partial)`.
    const typeMatch = /(?:^|[\s|\]])(P|S|E)(?=\s|\(|$)/.exec(typeZone);
    if (typeMatch) {
      const t = typeMatch[1]!.toUpperCase();
      action = t === "S" && isPartial ? "S_PARTIAL" : (t as "P" | "S" | "E");
    }

    // Asset class in square brackets: [ST], [GS], [OP], ...
    const classMatch = /\[([A-Z]{2})\]/.exec(post.slice(0, Math.min(post.length, 80)));

    // Two MM/DD/YYYY dates: first = transaction, second = notification
    const dateRe = /(\d{1,2})\/(\d{1,2})\/(\d{4})/g;
    const dates: string[] = [];
    let dm: RegExpExecArray | null;
    while ((dm = dateRe.exec(beforeAmt)) !== null) {
      const iso = `${dm[3]!}-${dm[1]!.padStart(2, "0")}-${dm[2]!.padStart(2, "0")}`;
      dates.push(iso);
      if (dates.length >= 2) break;
    }

    // Owner code — look in the ~60 chars before the ticker
    const ownerMatch = /(?:^|[\s|])(SP|JT|DC)\s*(?=[\s|])/.exec(preTicker.slice(-60));
    const ownerCode = ownerMatch?.[1] as PoliticianTrade["ownerCode"] ?? null;

    // Asset name — extract the "Something Inc." right before the ticker.
    // Strip boilerplate first (page headers, "D: Sold 20,000 shares." from
    // the previous row's description leaking in, etc.), then re-anchor on
    // the owner code so the name starts cleanly after it.
    const cleaned = preTicker
      .replace(PTR_BOILERPLATE_RE, " ")
      .replace(/\s+/g, " ")
      .trim();
    // If we have an owner code, take everything after the LAST occurrence.
    const ownerAnchorRe = /\b(?:SP|JT|DC)\b/g;
    let anchorEnd = 0;
    let am: RegExpExecArray | null;
    while ((am = ownerAnchorRe.exec(cleaned)) !== null) anchorEnd = am.index + am[0].length;
    const nameCandidate = (anchorEnd > 0 ? cleaned.slice(anchorEnd) : cleaned).trim();
    const assetName = (nameCandidate || cleaned.split(/\s+/).slice(-6).join(" ")).trim();

    trades.push({
      ownerCode,
      assetName: assetName || "Unknown",
      ticker: cur.ticker,
      assetClass: classMatch?.[1] ?? null,
      action,
      transactionDate: dates[0] ?? null,
      notificationDate: dates[1] ?? null,
      amountLow,
      amountHigh,
      amountLabel: `$${amtMatch[1]!.trim()} - $${amtMatch[2]!.trim()}`,
      filingDocId: filing.docId,
      filingDate: filing.filingDate,
      filingYear: filing.year,
      pdfUrl: filing.pdfUrl,
    });
  }

  return trades;
}

async function parsePoliticianPtr(filing: PoliticianFiling): Promise<PoliticianTrade[]> {
  const text = await fetchPtrPdfText(filing.pdfUrl);
  if (!text) return [];
  return parsePtrText(text, filing);
}

/**
 * Roll up a stream of parsed trades into per-ticker aggregates. Since the
 * PTR form only reports amount RANGES (never exact dollar figures), the
 * "net position" is a bracket — `netEstimateLow` is the worst-case
 * outcome for someone who bought (bought the min, sold the max) and
 * `netEstimateHigh` is the best case. Both can be negative if the
 * politician net-sold that ticker.
 */
function summarisePoliticianTrades(trades: PoliticianTrade[]): PoliticianHolding[] {
  const byTicker = new Map<string, PoliticianTrade[]>();
  for (const t of trades) {
    if (!t.ticker) continue;
    const arr = byTicker.get(t.ticker) ?? [];
    arr.push(t);
    byTicker.set(t.ticker, arr);
  }

  const holdings: PoliticianHolding[] = [];
  for (const [ticker, group] of byTicker) {
    let buyCount = 0, sellCount = 0;
    let totalBuyLow = 0, totalBuyHigh = 0, totalSellLow = 0, totalSellHigh = 0;
    let lastDate: string | null = null;
    let name = "";
    for (const t of group) {
      if (t.action === "P") {
        buyCount++;
        totalBuyLow += t.amountLow;
        totalBuyHigh += t.amountHigh;
      } else if (t.action === "S" || t.action === "S_PARTIAL") {
        sellCount++;
        totalSellLow += t.amountLow;
        totalSellHigh += t.amountHigh;
      }
      const d = t.transactionDate ?? t.filingDate;
      if (d && (!lastDate || d > lastDate)) lastDate = d;
      if (!name && t.assetName) name = t.assetName;
    }
    holdings.push({
      ticker,
      assetName: name || ticker,
      buyCount,
      sellCount,
      totalBuyLow,
      totalBuyHigh,
      totalSellLow,
      totalSellHigh,
      netEstimateLow: totalBuyLow - totalSellHigh,
      netEstimateHigh: totalBuyHigh - totalSellLow,
      lastTradeDate: lastDate,
      trades: [...group].sort((a, b) =>
        (b.transactionDate ?? b.filingDate ?? "").localeCompare(
          a.transactionDate ?? a.filingDate ?? "",
        ),
      ),
    });
  }

  // Order by total activity (buys+sells), then by most recent trade.
  return holdings.sort((a, b) => {
    const ac = a.buyCount + a.sellCount;
    const bc = b.buyCount + b.sellCount;
    if (bc !== ac) return bc - ac;
    return (b.lastTradeDate ?? "").localeCompare(a.lastTradeDate ?? "");
  });
}

// ---------------------------------------------------------------------------
// SEC 13F — fund holdings
// ---------------------------------------------------------------------------

export const SEC_BASE = "https://data.sec.gov";
export const SEC_ARCHIVE = "https://www.sec.gov/Archives/edgar/data";

export function secHeaders(): HeadersInit {
  return {
    // SEC's usage policy: identify yourself with a plain-text User-Agent
    // that includes contact info. Rate-limited to 10 requests per second.
    "User-Agent": settings.portfolios.secUserAgent,
    "Accept": "application/json,text/xml,application/xml,*/*;q=0.5",
  };
}

export interface SubmissionsRecent {
  accessionNumber: string[];
  form: string[];
  filingDate: string[];
  reportDate: string[];
  primaryDocument: string[];
}

export interface SubmissionsResponse {
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
  const res = await timedFetch(url, {
    headers: secHeaders(),
    cache: "no-store",
    timeoutMs: 20_000,
  });
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
  const res = await timedFetch(indexUrl, {
    headers: secHeaders(),
    cache: "no-store",
    timeoutMs: 20_000,
  });
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
    const xmlRes = await timedFetch(xmlUrl, {
      headers: secHeaders(),
      cache: "no-store",
      timeoutMs: 30_000,
    });
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
 *
 * Also extracts the reporting owner block so callers can surface who
 * filed the report (e.g. "Cook Timothy D · CEO") — issuer-centric flows
 * need this because they don't know the filer up front.
 */
export function parseForm4Xml(
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
  reporterName: string;
  reporterCik: string | null;
  reporterRelation: string | null;
} {
  const issuerBlockRe = /<issuer\b[^>]*>([\s\S]*?)<\/issuer>/;
  const issuerBlock = issuerBlockRe.exec(xml)?.[1] ?? "";
  const issuerName = form4Extract("issuerName", issuerBlock) ?? "";
  const rawTicker = form4Extract("issuerTradingSymbol", issuerBlock) ?? "";
  const issuerTicker = rawTicker ? rawTicker.toUpperCase() : null;
  const issuerCik = form4Extract("issuerCik", issuerBlock) ?? null;

  // Reporting owner — Form 4 always has at least one, but may have
  // multiple (rare: joint filings). We surface just the first for now.
  const ownerBlockRe = /<reportingOwner\b[^>]*>([\s\S]*?)<\/reportingOwner>/;
  const ownerBlock = ownerBlockRe.exec(xml)?.[1] ?? "";
  const rawOwnerName = form4Extract("rptOwnerName", ownerBlock) ?? "";
  const reporterName = rawOwnerName.trim();
  const reporterCik = form4Extract("rptOwnerCik", ownerBlock) ?? null;
  const reporterRelation = describeOwnerRelation(ownerBlock);

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

  return {
    transactions,
    issuerName,
    issuerTicker,
    issuerCik,
    reporterName,
    reporterCik,
    reporterRelation,
  };
}

/**
 * Human-readable relation from a `<reportingOwnerRelationship>` block.
 * Combines all "is*" flags into a comma-separated list, with the officer
 * title appended when applicable. Returns null when nothing usable is
 * present (rare — most Form 4s have at least one flag set).
 */
function describeOwnerRelation(ownerBlock: string): string | null {
  const relBlockRe = /<reportingOwnerRelationship\b[^>]*>([\s\S]*?)<\/reportingOwnerRelationship>/;
  const rel = relBlockRe.exec(ownerBlock)?.[1] ?? "";
  if (!rel) return null;

  const parts: string[] = [];
  const isTrue = (tag: string): boolean => {
    const raw = form4Extract(tag, rel);
    if (!raw) return false;
    const t = raw.trim();
    return t === "1" || t.toLowerCase() === "true";
  };
  if (isTrue("isDirector")) parts.push("Director");
  if (isTrue("isOfficer")) {
    const title = form4Extract("officerTitle", rel);
    parts.push(title ? `Officer: ${title}` : "Officer");
  }
  if (isTrue("isTenPercentOwner")) parts.push("10% owner");
  if (isTrue("isOther")) {
    const other = form4Extract("otherText", rel);
    parts.push(other ? `Other: ${other}` : "Other");
  }
  return parts.length > 0 ? parts.join(" · ") : null;
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
export async function mapConcurrent<T, R>(
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

  const requestedLimit = Math.max(5, Math.min(120, limit));
  // Always fetch at the max cap and slice on read. This means moving the
  // "Recent filings" slider or re-visiting the page with a different
  // preset limit never re-hits SEC — the cache is keyed on the preset id.
  const MAX_LIMIT = 120;
  const key = `portfolios:person:${preset.id}:${MAX_LIMIT}`;
  const cached = cacheGet<PersonReport>(key);
  if (cached) {
    return {
      ...cached,
      recentTransactions: cached.recentTransactions.slice(0, requestedLimit),
    };
  }
  const clampedLimit = MAX_LIMIT;

  // Step 1 — pull the submissions index and pluck all insider filings.
  const submissionsUrl = `${SEC_BASE}/submissions/CIK${preset.cik}.json`;
  const subRes = await timedFetch(submissionsUrl, {
    headers: secHeaders(),
    cache: "no-store",
    timeoutMs: 20_000,
  });
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
      const res = await timedFetch(xmlUrl, {
        headers: secHeaders(),
        cache: "no-store",
        timeoutMs: 20_000,
      });
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
  // Respect the caller's requested limit even on cold-fetch — otherwise
  // the first call would return `MAX_LIMIT` entries and subsequent calls
  // (from cache) would return `requestedLimit`.
  return {
    ...report,
    recentTransactions: report.recentTransactions.slice(0, requestedLimit),
  };
}

// ---------------------------------------------------------------------------
// List helper (used by the /portfolios page to render the preset chooser)
// ---------------------------------------------------------------------------

/**
 * The `custom` flag on each entry distinguishes user-added presets
 * (persisted in SQLite via `lib/portfolio-presets.ts`) from the built-in
 * seed lists. The UI uses this to gate the "delete" affordance so a user
 * can't remove the built-in entries.
 */
export type PoliticianPresetView = PoliticianPreset & { custom: boolean };
export type FundPresetView = FundPreset & { custom: boolean };
export type PersonPresetView = PersonPreset & { custom: boolean };

export interface PortfolioIndex {
  politicians: PoliticianPresetView[];
  funds: FundPresetView[];
  people: PersonPresetView[];
}

export function listPresets(): PortfolioIndex {
  const seededPols = new Set(POLITICIAN_PRESETS.map((p) => p.id));
  const seededFunds = new Set(FUND_PRESETS.map((f) => f.id));
  const seededPeople = new Set(PERSON_PRESETS.map((p) => p.id));

  const customPols = listCustomPoliticians().filter((p) => !seededPols.has(p.id));
  const customFunds = listCustomFunds().filter((f) => !seededFunds.has(f.id));
  const customPeople = listCustomPeople().filter((p) => !seededPeople.has(p.id));

  return {
    politicians: [
      ...POLITICIAN_PRESETS.map((p) => ({ ...p, custom: false })),
      ...customPols.map((p) => ({ ...p, custom: true })),
    ],
    funds: [
      ...FUND_PRESETS.map((f) => ({ ...f, custom: false })),
      ...customFunds.map((f) => ({ ...f, custom: true })),
    ],
    people: [
      ...PERSON_PRESETS.map((p) => ({ ...p, custom: false })),
      ...customPeople.map((p) => ({ ...p, custom: true })),
    ],
  };
}

// ---------------------------------------------------------------------------
// SEC EDGAR full-text search — power the "type a name to add" UX
// ---------------------------------------------------------------------------

/**
 * One row shown in the add-preset autocomplete. `cik` is always zero-padded
 * to 10 digits (EDGAR's canonical form). `companies` is the top few
 * counterparties surfaced across the person's filings — the issuer of the
 * shares for insider filings, or the fund entity itself for 13F filings.
 */
export interface EntitySearchResult {
  kind: "person" | "fund";
  cik: string;
  name: string;
  /**
   * For `person`: recent issuers this insider has filed against, most
   * frequent first. For `fund`: usually just the filing entity itself,
   * so this is typically empty for 13F results.
   */
  companies: string[];
  /** Number of matching filings (used to rank results). */
  filingCount: number;
  /** Most-recent filing date across the matches, ISO. */
  latestFilingDate: string | null;
  /** Distinct SEC form types observed (e.g. ["4","3"] or ["13F-HR"]). */
  formTypes: string[];
}

const EDGAR_FTS_URL = "https://efts.sec.gov/LATEST/search-index";

interface FtsHit {
  _source?: {
    ciks?: string[];
    display_names?: string[];
    form?: string;
    file_date?: string;
    adsh?: string;
  };
}

interface FtsResponse {
  hits?: {
    total?: { value?: number };
    hits?: FtsHit[];
  };
}

/** Strip the "  (CIK 0001234567)" suffix EDGAR appends to display names. */
function stripCikSuffix(display: string): string {
  return display.replace(/\s*\(CIK\s*\d+\)\s*$/i, "").trim();
}

interface AggEntry {
  cik: string;
  name: string;
  companies: Map<string, number>;
  filingCount: number;
  latest: string;
  formTypes: Set<string>;
}

/** Single EDGAR FTS call, up to 100 hits. */
async function fetchFtsPage(
  entityName: string,
  forms: string,
): Promise<FtsHit[]> {
  const url = new URL(EDGAR_FTS_URL);
  url.searchParams.set("entityName", entityName);
  url.searchParams.set("forms", forms);
  url.searchParams.set("hits", "100");
  const res = await timedFetch(url.toString(), {
    cache: "no-store",
    headers: {
      "User-Agent": settings.portfolios.secUserAgent,
      "Accept": "application/json",
    },
    timeoutMs: 15_000,
  });
  if (!res.ok) {
    throw new DataSourceUnavailableError("sec-edgar-fts", res.status);
  }
  const body = (await res.json()) as FtsResponse;
  return body.hits?.hits ?? [];
}

/**
 * Aggregate FTS hits into unique-entity results. Only display_names that
 * match every token of `query` (as case-insensitive substrings) are
 * treated as the "entity we care about"; the rest of the display_names
 * in a hit become "companies" context.
 */
function aggregateHits(
  hits: FtsHit[],
  tokens: string[],
  agg: Map<string, AggEntry>,
): void {
  const matches = (name: string): boolean => {
    const n = name.toLowerCase();
    return tokens.every((t) => n.includes(t));
  };

  for (const hit of hits) {
    const src = hit._source ?? {};
    const names = src.display_names ?? [];
    const ciks = src.ciks ?? [];
    const form = src.form ?? "";
    const fileDate = src.file_date ?? "";

    for (let i = 0; i < names.length; i++) {
      const raw = names[i] ?? "";
      const clean = stripCikSuffix(raw);
      if (!matches(clean)) continue;

      const cikRaw = ciks[i];
      if (!cikRaw) continue;
      const cik = cikRaw.padStart(10, "0");

      let entry = agg.get(cik);
      if (!entry) {
        entry = {
          cik,
          name: clean,
          companies: new Map(),
          filingCount: 0,
          latest: "",
          formTypes: new Set(),
        };
        agg.set(cik, entry);
      }
      entry.filingCount++;
      if (fileDate > entry.latest) entry.latest = fileDate;
      if (form) entry.formTypes.add(form);
      for (let j = 0; j < names.length; j++) {
        if (j === i) continue;
        const other = stripCikSuffix(names[j] ?? "");
        if (!other) continue;
        entry.companies.set(other, (entry.companies.get(other) ?? 0) + 1);
      }
    }
  }
}

/**
 * Search SEC EDGAR by name for either an insider (Forms 3/4/5) or a
 * fund manager (Form 13F-HR), returning up to 20 unique CIKs ranked by
 * recent filing activity.
 *
 * Uses EDGAR's full-text-search index with the `entityName` filter (not
 * the plain `q` filter, which matches anywhere in filing text and would
 * pollute fund results with holdings-table mentions).
 *
 * Because EDGAR's `entityName` is a whole-token match (so "Tim Cook"
 * returns 0 hits while "Cook Timothy" returns 176), when the exact query
 * yields nothing we fall back to querying each token individually and
 * post-filter to entries whose display name contains every query token
 * as a substring. This is what makes "Tim Cook" find "COOK TIMOTHY D".
 *
 * The CIK returned is always zero-padded to 10 digits so it can be fed
 * straight into `PersonPreset.cik` / `FundPreset.cik`.
 *
 * Results are cached for 15 minutes per (kind, normalized query) pair.
 */
export async function searchEntities(
  query: string,
  kind: "person" | "fund",
): Promise<EntitySearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const cacheKey = `entity-search:${kind}:${q.toLowerCase()}`;
  const cached = cacheGet<EntitySearchResult[]>(cacheKey);
  if (cached) return cached;

  const forms = kind === "person" ? "4,3,5" : "13F-HR,13F-HR/A";
  const tokens = q
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  const agg = new Map<string, AggEntry>();

  const primary = await fetchFtsPage(q, forms);
  aggregateHits(primary, tokens, agg);

  // Nickname / shortened-name fallback: if the whole-token entityName
  // match returned no candidates, try each token separately and rely on
  // the substring post-filter to narrow.
  if (agg.size === 0 && tokens.length > 1) {
    const byLength = [...tokens].sort((a, b) => b.length - a.length);
    for (const t of byLength) {
      const hits = await fetchFtsPage(t, forms);
      aggregateHits(hits, tokens, agg);
      if (agg.size > 0) break;
    }
  }

  const results: EntitySearchResult[] = Array.from(agg.values())
    .sort((a, b) => {
      if (b.filingCount !== a.filingCount) return b.filingCount - a.filingCount;
      return b.latest.localeCompare(a.latest);
    })
    .slice(0, 20)
    .map((e) => ({
      kind,
      cik: e.cik,
      name: e.name,
      companies: Array.from(e.companies.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([n]) => n),
      filingCount: e.filingCount,
      latestFilingDate: e.latest || null,
      formTypes: Array.from(e.formTypes),
    }));

  cacheSet(cacheKey, results, 60 * 15);
  return results;
}
