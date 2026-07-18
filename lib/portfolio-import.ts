/**
 * My-Portfolio CSV importer.
 *
 * Parses the "MyStocksPortfolio" (MSP) app export format that the user
 * uploads through the /my-portfolio page. The format is a flat CSV
 * of transactions and per-portfolio "watch" rows:
 *
 *   Id, Symbol, Name, Display Symbol, Exchange, Portfolio, Currency,
 *   Shares Owned, Cost Per Share, Commission, Transaction Date,
 *   Transaction Time, Purchase Exchange Rate, Purchase Exchange
 *   Currencies, Type, Accounting, Accounting Execution Ids, Notes,
 *   OutgoingCashLink
 *
 * Rows where the "Type" column is blank are **portfolio header** rows
 * (the app records the symbols each portfolio watches, even those with
 * no trades yet). Rows with Type = "Buy" or "Sell" are actual trades.
 *
 * This module deliberately does NO aggregation (no cost-basis, no
 * positions, no PnL) — the first iteration listed by the user is
 * "list down all the details first". The aggregation layer can sit on
 * top of the raw rows without needing to re-parse.
 *
 * Everything runs client-side: the CSV is read in the browser and
 * persisted to `localStorage` via the holdings-state store. Nothing
 * touches the server.
 */

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

export type HoldingType = "Buy" | "Sell";

export interface HoldingRow {
  /** Original Id column from the CSV (kept as string — MSP uses these as
   *  sequential ordering but numeric parsing isn't needed anywhere). */
  id: string;
  symbol: string;
  name: string;
  displaySymbol: string | null;
  exchange: string;
  portfolio: string;
  currency: string;
  /** Null on portfolio-header rows (no trade attached). */
  shares: number | null;
  costPerShare: number | null;
  commission: number | null;
  /** Original as-written date string (e.g. `"2018-11-01 GMT+0800"`). We keep
   *  the raw string so timezone info isn't silently lost, and expose an
   *  ISO helper below. */
  transactionDate: string | null;
  transactionTime: string | null;
  purchaseExchangeRate: number | null;
  purchaseExchangeCurrencies: string | null;
  type: HoldingType | null;
  accounting: string | null;
  accountingExecutionIds: string | null;
  notes: string | null;
  outgoingCashLink: string | null;
}

// ---------------------------------------------------------------------------
// Parse result
// ---------------------------------------------------------------------------

export interface HoldingsParseError {
  /** 1-based line number in the original CSV. */
  line: number;
  message: string;
}

export interface HoldingsParseResult {
  rows: HoldingRow[];
  errors: HoldingsParseError[];
  /** Total non-blank data rows read (including headers + trades). */
  totalRows: number;
  /** Rows whose Type is "Buy". */
  buyCount: number;
  /** Rows whose Type is "Sell". */
  sellCount: number;
  /** Rows with empty Type — the per-portfolio "watch" markers. */
  watchCount: number;
  /** Unique portfolio names seen (sorted). */
  portfolios: string[];
  /** Unique tickers seen (sorted). */
  symbols: string[];
  /** Unique currencies seen (sorted). */
  currencies: string[];
  /** Earliest transaction date encountered (ISO date, YYYY-MM-DD) or null. */
  earliestDate: string | null;
  /** Latest transaction date encountered (ISO date, YYYY-MM-DD) or null. */
  latestDate: string | null;
}

// ---------------------------------------------------------------------------
// RFC-4180-ish line splitter
// ---------------------------------------------------------------------------

/**
 * Split a CSV file into rows of string cells. Handles:
 *   - Quoted fields (`"..."`) with commas inside them.
 *   - Escaped quotes inside quoted fields (`""` → `"`).
 *   - Unquoted fields.
 *   - `\r\n` / `\r` / `\n` line endings.
 *   - Blank lines (skipped by the caller).
 *
 * Kept ~40 lines and dependency-free rather than pulling in `papaparse`
 * for a well-behaved single-source-per-user format.
 */
function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const flushField = () => { row.push(field); field = ""; };
  const flushRow = () => { rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") { flushField(); continue; }
    if (ch === "\r") {
      // Treat `\r\n` as a single line break — swallow the `\n`.
      if (text[i + 1] === "\n") i++;
      flushField();
      flushRow();
      continue;
    }
    if (ch === "\n") {
      flushField();
      flushRow();
      continue;
    }
    field += ch;
  }
  // Terminal record without trailing newline.
  if (field.length > 0 || row.length > 0) {
    flushField();
    flushRow();
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Field cleanup helpers
// ---------------------------------------------------------------------------

/** Trim whitespace; return null when the result is empty. */
function s(v: string | undefined): string | null {
  if (v === undefined) return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Parse a numeric field. Empty → null. NaN → null (parse error). */
function n(v: string | undefined): number | null {
  const t = s(v);
  if (t === null) return null;
  const num = Number(t);
  return Number.isFinite(num) ? num : null;
}

/** Coerce the CSV "Type" column into a strongly-typed variant. */
function parseType(v: string | undefined): HoldingType | null {
  const t = s(v);
  if (t === null) return null;
  const lower = t.toLowerCase();
  if (lower === "buy") return "Buy";
  if (lower === "sell") return "Sell";
  return null;
}

/**
 * Extract the ISO date (`YYYY-MM-DD`) from a MSP-style "Transaction Date"
 * string like `"2018-11-01 GMT+0800"`. Returns null if we can't recognize
 * the shape — we never guess with locale-specific formats.
 */
export function extractIsoDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// ---------------------------------------------------------------------------
// Column layout — match the exact header order from the MSP export
// ---------------------------------------------------------------------------

/**
 * Case-insensitive fuzzy match: strip non-alphanumeric characters before
 * comparing. Lets us accept minor header variants (e.g. `"Cost Per Share"`
 * vs `"CostPerShare"` vs `"cost-per-share"`) without breaking the import.
 */
function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const HEADER_ALIASES: Record<keyof HoldingRow, string[]> = {
  id: ["id"],
  symbol: ["symbol", "ticker"],
  name: ["name", "companyname"],
  displaySymbol: ["displaysymbol"],
  exchange: ["exchange"],
  portfolio: ["portfolio", "account", "broker"],
  currency: ["currency"],
  shares: ["sharesowned", "shares", "quantity", "qty"],
  costPerShare: ["costpershare", "price", "unitcost"],
  commission: ["commission", "fees", "fee"],
  transactionDate: ["transactiondate", "date", "tradedate"],
  transactionTime: ["transactiontime", "time"],
  purchaseExchangeRate: ["purchaseexchangerate", "exchangerate", "fxrate"],
  purchaseExchangeCurrencies: [
    "purchaseexchangecurrencies", "exchangecurrencies", "fxpair",
  ],
  type: ["type", "side", "action"],
  accounting: ["accounting", "method"],
  accountingExecutionIds: ["accountingexecutionids"],
  notes: ["notes", "note", "comment"],
  outgoingCashLink: ["outgoingcashlink"],
};

/**
 * Build a map of `HoldingRow` field → column index by matching each
 * required field against the parsed header row. Returns null on the
 * fields that aren't present in the CSV (so parsing can still succeed
 * on lightly-shaped exports that drop optional columns).
 */
function buildColumnMap(headerRow: string[]): Record<keyof HoldingRow, number | null> {
  const normalized = headerRow.map(normalizeHeader);
  const out = {} as Record<keyof HoldingRow, number | null>;
  for (const key of Object.keys(HEADER_ALIASES) as Array<keyof HoldingRow>) {
    const aliases = HEADER_ALIASES[key];
    let idx: number | null = null;
    for (let i = 0; i < normalized.length; i++) {
      if (aliases.includes(normalized[i]!)) {
        idx = i;
        break;
      }
    }
    out[key] = idx;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API — parse a raw CSV string into rows + summary stats
// ---------------------------------------------------------------------------

export function parseHoldingsCsv(text: string): HoldingsParseResult {
  const raw = splitCsv(text);
  const errors: HoldingsParseError[] = [];

  // Discard leading blank rows so a file with a whitespace preamble
  // still lines up on the real header.
  let headerRowIdx = -1;
  for (let i = 0; i < raw.length; i++) {
    const cells = raw[i]!;
    if (cells.some((c) => c.trim().length > 0)) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1) {
    return {
      rows: [],
      errors: [{ line: 1, message: "The file appears to be empty." }],
      totalRows: 0,
      buyCount: 0,
      sellCount: 0,
      watchCount: 0,
      portfolios: [],
      symbols: [],
      currencies: [],
      earliestDate: null,
      latestDate: null,
    };
  }
  const columnMap = buildColumnMap(raw[headerRowIdx]!);

  // Require at least the "core" identity columns to be present; without
  // them we can't tell one transaction from another and shouldn't
  // silently persist a mangled feed.
  const CORE_REQUIRED: Array<keyof HoldingRow> = [
    "symbol", "portfolio",
  ];
  const missing = CORE_REQUIRED.filter((k) => columnMap[k] === null);
  if (missing.length > 0) {
    errors.push({
      line: headerRowIdx + 1,
      message: `Missing required column(s): ${missing.join(", ")}. Are you sure this is a portfolio CSV export?`,
    });
    return {
      rows: [],
      errors,
      totalRows: 0,
      buyCount: 0,
      sellCount: 0,
      watchCount: 0,
      portfolios: [],
      symbols: [],
      currencies: [],
      earliestDate: null,
      latestDate: null,
    };
  }

  const rows: HoldingRow[] = [];
  const portfolios = new Set<string>();
  const symbols = new Set<string>();
  const currencies = new Set<string>();
  let earliestDate: string | null = null;
  let latestDate: string | null = null;
  let buyCount = 0;
  let sellCount = 0;
  let watchCount = 0;

  for (let i = headerRowIdx + 1; i < raw.length; i++) {
    const cells = raw[i]!;
    // Skip blank / whitespace-only rows (MSP uses these as visual
    // separators between portfolio groups).
    if (cells.every((c) => c.trim().length === 0)) continue;

    const pick = (key: keyof HoldingRow): string | undefined => {
      const idx = columnMap[key];
      return idx === null || idx === undefined ? undefined : cells[idx];
    };

    const symbol = s(pick("symbol"));
    const portfolio = s(pick("portfolio"));
    if (!symbol || !portfolio) {
      errors.push({
        line: i + 1,
        message: "Row is missing a Symbol or Portfolio value; skipped.",
      });
      continue;
    }
    const row: HoldingRow = {
      id: s(pick("id")) ?? String(rows.length + 1),
      symbol,
      name: s(pick("name")) ?? symbol,
      displaySymbol: s(pick("displaySymbol")),
      exchange: s(pick("exchange")) ?? "",
      portfolio,
      currency: s(pick("currency")) ?? "",
      shares: n(pick("shares")),
      costPerShare: n(pick("costPerShare")),
      commission: n(pick("commission")),
      transactionDate: s(pick("transactionDate")),
      transactionTime: s(pick("transactionTime")),
      purchaseExchangeRate: n(pick("purchaseExchangeRate")),
      purchaseExchangeCurrencies: s(pick("purchaseExchangeCurrencies")),
      type: parseType(pick("type")),
      accounting: s(pick("accounting")),
      accountingExecutionIds: s(pick("accountingExecutionIds")),
      notes: s(pick("notes")),
      outgoingCashLink: s(pick("outgoingCashLink")),
    };

    rows.push(row);
    portfolios.add(row.portfolio);
    symbols.add(row.symbol);
    if (row.currency) currencies.add(row.currency);
    if (row.type === "Buy") buyCount++;
    else if (row.type === "Sell") sellCount++;
    else watchCount++;

    const iso = extractIsoDate(row.transactionDate);
    if (iso) {
      if (earliestDate === null || iso < earliestDate) earliestDate = iso;
      if (latestDate === null || iso > latestDate) latestDate = iso;
    }
  }

  return {
    rows,
    errors,
    totalRows: rows.length,
    buyCount,
    sellCount,
    watchCount,
    portfolios: [...portfolios].sort(),
    symbols: [...symbols].sort(),
    currencies: [...currencies].sort(),
    earliestDate,
    latestDate,
  };
}

// ---------------------------------------------------------------------------
// Convenience derivations for the UI layer
// ---------------------------------------------------------------------------

/**
 * Deterministic identity fingerprint for a row. Two rows with the same
 * fingerprint are "the same transaction" and safe to de-duplicate across
 * successive CSV uploads.
 *
 * Deliberately based on **content**, not the CSV `Id` column: MSP's
 * numeric Id is stable when re-exporting from the same database, but
 * users who migrate between trackers (or delete + re-add a trade)
 * would get spurious duplicates. The fields below uniquely identify a
 * real-world transaction:
 *
 *   portfolio  — which account
 *   symbol     — which security
 *   type       — buy / sell / watch (portfolio-header)
 *   date+time  — when it happened (down to the minute for MSP)
 *   shares     — how many
 *   cost       — at what price
 *   currency   — in what denomination
 *
 * A `\u0000` NUL byte separator is used to make accidental collisions
 * across fields impossible (no user-visible string contains NUL).
 */
export function fingerprintRow(row: HoldingRow): string {
  return [
    row.portfolio,
    row.symbol,
    row.type ?? "watch",
    row.transactionDate ?? "",
    row.transactionTime ?? "",
    row.shares ?? "",
    row.costPerShare ?? "",
    row.currency ?? "",
  ].join("\u0000");
}

/**
 * Diff a fresh parse against an already-persisted set of rows. Used by
 * the uploader to compute "how many rows are new vs already known"
 * before the user picks between merge and replace.
 */
export interface HoldingsDiff {
  /** Rows in `incoming` whose fingerprint is not present in `existing`. */
  newRows: HoldingRow[];
  /** Rows in `incoming` whose fingerprint IS present in `existing`. */
  duplicateRows: HoldingRow[];
}

export function diffHoldings(
  existing: HoldingRow[],
  incoming: HoldingRow[],
): HoldingsDiff {
  const seen = new Set<string>();
  for (const r of existing) seen.add(fingerprintRow(r));
  const newRows: HoldingRow[] = [];
  const duplicateRows: HoldingRow[] = [];
  for (const r of incoming) {
    if (seen.has(fingerprintRow(r))) duplicateRows.push(r);
    else newRows.push(r);
  }
  return { newRows, duplicateRows };
}

/**
 * Group rows by (Portfolio, Symbol) so the UI can render one section per
 * ticker held in each account. Watch-only rows (no transactions) are
 * kept in the group so they appear in the list even when no trades exist.
 */
export interface GroupedHoldings {
  portfolio: string;
  symbol: string;
  name: string;
  currency: string;
  rows: HoldingRow[];
}

export function groupByPortfolioAndSymbol(rows: HoldingRow[]): GroupedHoldings[] {
  const map = new Map<string, GroupedHoldings>();
  for (const row of rows) {
    const key = `${row.portfolio}\u0000${row.symbol}`;
    let group = map.get(key);
    if (!group) {
      group = {
        portfolio: row.portfolio,
        symbol: row.symbol,
        name: row.name,
        currency: row.currency,
        rows: [],
      };
      map.set(key, group);
    }
    // Prefer the *first* non-empty name/currency we see (usually the
    // portfolio-header row that comes before any trades).
    if (!group.name) group.name = row.name;
    if (!group.currency && row.currency) group.currency = row.currency;
    group.rows.push(row);
  }
  return [...map.values()].sort((a, b) => {
    if (a.portfolio !== b.portfolio) return a.portfolio.localeCompare(b.portfolio);
    return a.symbol.localeCompare(b.symbol);
  });
}
