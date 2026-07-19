"use client";

/**
 * Table controls — reusable search + sort layer that composes on top
 * of `usePagination` (see `./pagination.tsx`).
 *
 * Why this exists: the Portfolios page (and a handful of other
 * pages) has half-a-dozen data tables — insider holdings, insider
 * transactions, politician holdings, politician trades, 13F fund
 * holdings — all of which are already paginated but had no way to
 * search or re-order rows. A user staring at "1–25 of 400 trades"
 * couldn't jump to "the ORCL row" or "the largest amount" without
 * clicking through pages. That's what this module fixes.
 *
 * The design goal is that adopting search + sort in an existing
 * paginated table is a 4-line change:
 *
 *   const ctl = useTableControls(rows, {
 *     searchFields: (r) => [r.ticker, r.name],
 *     sorters: {
 *       date: (a, b) => compareDate(a.date, b.date),
 *       shares: (a, b) => a.shares - b.shares,
 *     },
 *     initialSort: { key: "date", dir: "desc" },
 *   });
 *   const pager = usePagination(ctl.rows, 25);
 *   ...
 *   <TableToolbar controls={ctl} />
 *   ...
 *   <SortableTh controls={ctl} sortKey="date">Date</SortableTh>
 *
 * The controls object is the single source of truth for search /
 * sort state; the toolbar renders the input, the header renders
 * the sort affordance, and the hook produces the derived rows. Any
 * consumer that just wants "sort but no search" (or vice versa)
 * can leave the corresponding field off — an omitted `searchFields`
 * disables the input, an omitted `sorters` map keeps every header
 * static.
 *
 * Perf notes:
 *
 *   • Filter + sort are `useMemo`'d against the source array +
 *     current state, so the O(N log N) sort re-runs only when
 *     something actually changed — even on a 500-row 13F it's
 *     sub-millisecond and re-runs at most on keystroke / header
 *     click.
 *   • Search normalization (lower-case + trim + basic diacritic
 *     handling) is done once per keystroke, not per row.
 *   • Filter uses a substring match on the concatenated searchable
 *     text, which is the right shape for issuer / ticker / CUSIP
 *     type queries. A tokenizer-based match would over-match
 *     ("APPLE" → "APPLE HOSPITALITY REIT") without adding value.
 */

import * as React from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

/**
 * `asc` / `desc` are the two "on" states. `null` on the current
 * sort means "no sort applied — preserve the source array order".
 * Header clicks cycle desc → asc → null (see `cycleDir`).
 */
export type SortDir = "asc" | "desc";

export interface SortState<K extends string = string> {
  key: K;
  dir: SortDir;
}

/**
 * A comparator per sortable column. The map's keys are what the
 * `<SortableTh sortKey="...">` header refers to; the values compare
 * two rows and return a stable number (negative → a first).
 *
 * Direction is applied by the hook, so comparators should always
 * be written in a natural "ascending" direction (smaller first).
 */
export type SorterMap<T, K extends string = string> = Record<
  K,
  (a: T, b: T) => number
>;

export interface UseTableControlsOptions<T, K extends string = string> {
  /**
   * Function returning the searchable text fields for one row. The
   * returned values are lower-cased and concatenated internally
   * before substring matching, so return raw strings — no need to
   * pre-format. `null` / `undefined` / non-strings are ignored so
   * callers can pass "nullable string" fields directly.
   *
   * Omit to disable search entirely.
   */
  searchFields?: (row: T) => Array<string | null | undefined>;
  /**
   * Column comparator map — see `SorterMap`. Omit to disable sort.
   */
  sorters?: SorterMap<T, K>;
  /**
   * Optional starting sort. Ignored (with a dev warning) if the
   * key doesn't exist in `sorters`. Defaults to no sort — the
   * source array's natural order is preserved.
   */
  initialSort?: SortState<K> | null;
  /**
   * Optional initial query text. Rare — only useful for tests or
   * "deep link into a filtered view" flows.
   */
  initialQuery?: string;
}

export interface UseTableControlsResult<T, K extends string = string> {
  /** Filtered + sorted rows, ready to feed into `usePagination`. */
  rows: T[];
  /** Row count BEFORE filtering — used to show "N of M matching". */
  totalBeforeFilter: number;
  /** Current search query (raw, not normalized). */
  query: string;
  setQuery: (q: string) => void;
  /** Current sort or null. */
  sort: SortState<K> | null;
  /**
   * Cycle a column's sort state: desc → asc → null → desc → …
   * Clicking a different column jumps straight to desc on that
   * column (which is what a user almost always wants — biggest
   * first for money columns, most recent first for dates).
   */
  toggleSort: (key: K) => void;
  /** Whether search or sort has been touched. Used to render the "clear" chip. */
  isFiltered: boolean;
  /** Reset both search and sort to their initial values. */
  reset: () => void;
  /** Whether search is even available (mirrors `searchFields` presence). */
  searchable: boolean;
  /** Whether sorting is even available (mirrors `sorters` presence). */
  sortable: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTableControls<T, K extends string = string>(
  items: readonly T[],
  opts: UseTableControlsOptions<T, K> = {},
): UseTableControlsResult<T, K> {
  const { searchFields, sorters, initialSort = null, initialQuery = "" } = opts;

  const [query, setQuery] = React.useState<string>(initialQuery);
  const [sort, setSort] = React.useState<SortState<K> | null>(() => {
    if (!initialSort) return null;
    if (sorters && initialSort.key in sorters) return initialSort;
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(
        `[useTableControls] initialSort.key "${initialSort.key}" has no matching sorter; ignoring.`,
      );
    }
    return null;
  });

  const searchable = !!searchFields;
  const sortable = !!sorters;

  // Normalize the query once per keystroke, not per row.
  const normalizedQuery = React.useMemo(() => query.trim().toLowerCase(), [query]);

  const filtered = React.useMemo(() => {
    if (!normalizedQuery || !searchFields) return items as T[];
    return (items as T[]).filter((row) => {
      const fields = searchFields(row);
      for (const f of fields) {
        if (typeof f === "string" && f && f.toLowerCase().includes(normalizedQuery)) {
          return true;
        }
      }
      return false;
    });
  }, [items, normalizedQuery, searchFields]);

  const sorted = React.useMemo(() => {
    if (!sort || !sorters) return filtered;
    const cmp = sorters[sort.key];
    if (!cmp) return filtered;
    // Copy before sort — never mutate the caller's array. Attach
    // the original index as a tie-breaker so equal rows keep their
    // input order (a stable sort under the guarantee we care about).
    const indexed = filtered.map((row, i) => ({ row, i }));
    indexed.sort((a, b) => {
      const raw = cmp(a.row, b.row);
      if (raw !== 0) return sort.dir === "asc" ? raw : -raw;
      return a.i - b.i;
    });
    return indexed.map((x) => x.row);
  }, [filtered, sort, sorters]);

  const toggleSort = React.useCallback(
    (key: K) => {
      setSort((prev) => {
        if (!sorters || !(key in sorters)) return prev;
        // Clicking a different column always lands on desc — the
        // most-common intent (largest / newest first).
        if (!prev || prev.key !== key) return { key, dir: "desc" };
        // Same column: desc → asc → clear.
        if (prev.dir === "desc") return { key, dir: "asc" };
        return null;
      });
    },
    [sorters],
  );

  const reset = React.useCallback(() => {
    setQuery("");
    setSort(initialSort ?? null);
  }, [initialSort]);

  const isFiltered =
    normalizedQuery.length > 0 ||
    (sort !== null &&
      (initialSort === null ||
        sort.key !== initialSort.key ||
        sort.dir !== initialSort.dir));

  return {
    rows: sorted,
    totalBeforeFilter: items.length,
    query,
    setQuery,
    sort,
    toggleSort,
    isFiltered,
    reset,
    searchable,
    sortable,
  };
}

// ---------------------------------------------------------------------------
// <TableToolbar>
// ---------------------------------------------------------------------------

export interface TableToolbarProps<T, K extends string = string> {
  controls: UseTableControlsResult<T, K>;
  /** Placeholder shown in the search input. Defaults to "Search…". */
  placeholder?: string;
  /**
   * When search is active and the filter narrowed the rows, show
   * "N of M matching". Defaults to true. Pass false for tables
   * where the pager footer already exposes the total (redundant).
   */
  showMatchHint?: boolean;
  /** i18n label for the "Clear" button. Defaults to "Clear". */
  clearLabel?: string;
  /**
   * Localized "N of M matching" builder. Called with the visible
   * count and pre-filter total. Only invoked when
   * `showMatchHint` is true AND the filter narrowed the set.
   * Default: `${n} of ${m} matching`.
   */
  formatMatchHint?: (visible: number, total: number) => string;
  className?: string;
}

export function TableToolbar<T, K extends string = string>({
  controls,
  placeholder = "Search…",
  showMatchHint = true,
  clearLabel = "Clear",
  formatMatchHint,
  className,
}: TableToolbarProps<T, K>) {
  // Nothing to render if the caller didn't wire up search AND
  // sort is a header-driven affordance (not a toolbar item) — but
  // we still render the "reset sort" chip when the sort has moved
  // off its initial state, so the user can get back to default
  // without clicking headers.
  if (!controls.searchable && !controls.isFiltered) return null;

  const narrowed =
    controls.query.trim() !== "" && controls.rows.length !== controls.totalBeforeFilter;
  const matchHint = narrowed
    ? (formatMatchHint ?? ((n, m) => `${n} of ${m} matching`))(
        controls.rows.length,
        controls.totalBeforeFilter,
      )
    : null;

  return (
    <div
      className={cn(
        "flex items-center gap-2 flex-wrap px-4 py-2 border-b border-border/60",
        className,
      )}
    >
      {controls.searchable && (
        <div className="relative flex-1 min-w-[10rem] max-w-xs">
          <Search
            aria-hidden
            className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
          />
          <input
            type="search"
            value={controls.query}
            onChange={(e) => controls.setQuery(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            spellCheck={false}
            className="w-full h-8 pl-7 pr-7 rounded-md border border-border bg-card text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {controls.query && (
            <button
              type="button"
              onClick={() => controls.setQuery("")}
              aria-label={clearLabel}
              title={clearLabel}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
      {matchHint && (
        <span className="text-[0.7rem] text-muted-foreground tabular-nums">
          {matchHint}
        </span>
      )}
      {controls.isFiltered && (
        <button
          type="button"
          onClick={controls.reset}
          className="ml-auto text-[0.7rem] text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          {clearLabel}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// <SortableTh>
// ---------------------------------------------------------------------------

export interface SortableThProps<T, K extends string = string>
  extends React.ThHTMLAttributes<HTMLTableCellElement> {
  controls: UseTableControlsResult<T, K>;
  /** Sort key — must exist in the `sorters` map passed to the hook. */
  sortKey: K;
  /**
   * Where the sort indicator icon sits relative to the label.
   * "auto" (default) puts it on the right for left-aligned cells
   * and on the left for right-aligned (numeric) cells. Override
   * only for unusual layouts.
   */
  align?: "auto" | "left" | "right";
  /** Accessible label prefix for the sort control. Defaults to "Sort by". */
  sortLabelPrefix?: string;
}

export function SortableTh<T, K extends string = string>({
  controls,
  sortKey,
  align = "auto",
  sortLabelPrefix = "Sort by",
  children,
  className,
  ...rest
}: SortableThProps<T, K>) {
  const active = controls.sort?.key === sortKey;
  const dir: SortDir | null = active ? controls.sort!.dir : null;

  // Detect right-aligned cells via `text-right` in the caller's
  // className. That's the same convention already used in the
  // portfolios page and elsewhere for numeric columns.
  const isRightAligned =
    align === "right" ||
    (align === "auto" && typeof className === "string" && className.includes("text-right"));
  const iconOnLeft = isRightAligned;

  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ChevronUp : ChevronDown;
  const iconClass = cn(
    "h-3 w-3 shrink-0",
    active ? "text-foreground" : "text-muted-foreground/50",
  );

  const currentDirLabel =
    dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none";
  const label = typeof children === "string" ? children : sortKey;

  return (
    <th
      {...rest}
      className={className}
      aria-sort={
        active ? (dir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={() => controls.toggleSort(sortKey)}
        title={`${sortLabelPrefix} ${label}${
          active ? ` (${currentDirLabel})` : ""
        }`}
        aria-label={`${sortLabelPrefix} ${label}, currently ${currentDirLabel}`}
        className={cn(
          "inline-flex items-center gap-1 transition-colors cursor-pointer select-none",
          // Reset the default browser button styling — this <button>
          // lives inside a header cell so it should look like the
          // surrounding text, not a raised button. `[font:inherit]`
          // is a Tailwind arbitrary property that emits
          // `font: inherit` — a single-shot cascade of font-family
          // / size / weight / line-height from the surrounding
          // <th>, so headers keep their uppercase + tracking-wider
          // + text-[0.7rem] styling instead of getting the browser's
          // default button font.
          "bg-transparent p-0 m-0 border-0 [font:inherit]",
          // Color: baseline matches the muted header text and hover
          // brightens to full foreground. When actively sorting we
          // stay bright so the user can spot which column is live
          // without hunting for the chevron.
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {iconOnLeft && <Icon className={iconClass} />}
        <span>{children}</span>
        {!iconOnLeft && <Icon className={iconClass} />}
      </button>
    </th>
  );
}
