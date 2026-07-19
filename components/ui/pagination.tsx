"use client";

/**
 * Pagination — small, purely-client list slicing utility.
 *
 * Exposes both the state hook (`usePagination`) and the presentational
 * control (`<Pagination>`) so callers can compose the two independently
 * (some lists want the slice logic but a bespoke footer; others want the
 * default look).
 *
 * Page is 1-indexed to match how it's shown to users. Pages are clamped
 * whenever the underlying list shrinks so the current page never points
 * at empty space after deletes / refetches — a common footgun with
 * naive `useState<page>(1)` implementations.
 *
 * The hook manages **both** page number and page size internally so a
 * caller only needs a single line to get a fully-featured pager:
 *
 *   const pager = usePagination(rows, 25);
 *   ...
 *   <Pagination
 *     page={pager.page}
 *     pageCount={pager.pageCount}
 *     total={pager.total}
 *     range={pager.range}
 *     onPageChange={pager.setPage}
 *     pageSize={pager.pageSize}
 *     onPageSizeChange={pager.setPageSize}
 *     pageSizeOptions={[10, 25, 50, 100]}   // 0 = "All"
 *   />
 *
 * When `pageSize === 0` (the "All" option), the hook returns every row
 * on a single page. This keeps the previous behaviour of Positions /
 * Holdings tables that used a magic `0` sentinel.
 */

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UsePaginationResult<T> {
  visibleItems: T[];
  page: number;
  setPage: (n: number) => void;
  pageCount: number;
  total: number;
  /** 1-indexed inclusive range currently visible; `[0, 0]` when empty. */
  range: readonly [number, number];
  /** Current page size. `0` means "All rows on one page". */
  pageSize: number;
  /**
   * Change the page size. Attempts to preserve the first-visible item
   * across the change so the user isn't teleported to an unrelated
   * section of the list. Pass `0` to switch to "All rows".
   */
  setPageSize: (n: number) => void;
}

export function usePagination<T>(
  items: readonly T[],
  initialPageSize: number = 25,
): UsePaginationResult<T> {
  const total = items.length;
  const [pageSize, setPageSizeRaw] = React.useState<number>(initialPageSize);
  const [page, setPageRaw] = React.useState(1);

  // `pageSize === 0` means "All". Internally we treat it as
  // `max(total, 1)` so `pageCount` degrades to 1 and every row is on
  // the same page. Fallback to 1 for empty lists so we never
  // `Math.ceil(0 / 0)` ourselves into NaN.
  const effectivePageSize =
    pageSize <= 0 ? Math.max(total, 1) : pageSize;
  const pageCount = Math.max(1, Math.ceil(total / effectivePageSize));

  // When the list shrinks below the current page, snap back to the last
  // non-empty page instead of rendering a blank body until the user
  // clicks Prev. `page > pageCount` covers both delete-all (pageCount
  // becomes 1) and delete-some (current page ends up past the tail).
  React.useEffect(() => {
    if (page > pageCount) setPageRaw(pageCount);
  }, [page, pageCount]);

  const setPage = React.useCallback(
    (n: number) => setPageRaw(Math.max(1, Math.min(pageCount, n))),
    [pageCount],
  );

  const setPageSize = React.useCallback(
    (n: number) => {
      // Anchor on the currently-visible top row so pageSize changes
      // don't jerk the user into a completely different slice. If the
      // caller switches from 25/page (currently on page 3, showing rows
      // 51–75) to 50/page, we want to land on page 2 (rows 51–100),
      // not page 3 (rows 101–150).
      const firstVisible = (page - 1) * effectivePageSize + 1;
      const nextEffective = n <= 0 ? Math.max(total, 1) : n;
      const nextPage = Math.max(1, Math.ceil(firstVisible / nextEffective));
      setPageSizeRaw(n);
      setPageRaw(nextPage);
    },
    [page, effectivePageSize, total],
  );

  const start = (page - 1) * effectivePageSize;
  const end = Math.min(start + effectivePageSize, total);
  const visibleItems = React.useMemo(
    () => items.slice(start, end),
    [items, start, end],
  );
  const range =
    total === 0 ? ([0, 0] as const) : ([start + 1, end] as const);

  return {
    visibleItems,
    page,
    setPage,
    pageCount,
    total,
    range,
    pageSize,
    setPageSize,
  };
}

// ---------------------------------------------------------------------------
// Presentational control
// ---------------------------------------------------------------------------

export interface PaginationProps {
  page: number;
  pageCount: number;
  total: number;
  range: readonly [number, number];
  onPageChange: (page: number) => void;
  className?: string;
  /**
   * Singular noun for the item type, used in the "Showing X–Y of Z {label}"
   * summary. Passed as-is; callers handle plurals in their own copy if
   * needed (English is lenient enough that "3 notifications" reads fine
   * as a generic label).
   */
  label?: string;
  /**
   * Show the First / Last (`<<` / `>>`) buttons in addition to Prev / Next.
   * Defaults to `true` — jumping to head/tail is a common request on the
   * long tables here (13F holdings, insider histories, alert notification
   * feeds). Callers with a UX reason to suppress them (e.g. a tiny
   * embedded pager) can opt out.
   */
  showFirstLast?: boolean;
  /**
   * Hide the whole footer when there's only one page **and** no size
   * selector is present. Handy for "Recent notifications"-style feeds
   * that are often empty or short. When a size selector IS present we
   * always render the footer so users can still switch it.
   */
  hideWhenSingle?: boolean;
  /**
   * Current page size. Required together with `onPageSizeChange` to
   * render the size selector. `0` means "All rows".
   */
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  /**
   * Options offered in the size selector. Pass `0` to include an "All"
   * choice. Defaults to `[10, 25, 50, 100]` when a selector is enabled.
   */
  pageSizeOptions?: readonly number[];
  /** Label shown next to the size selector. Defaults to "Rows". */
  pageSizeLabel?: string;
  /** Localised label for the `0` = "All" option. Defaults to "All". */
  allLabel?: string;
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export function Pagination({
  page,
  pageCount,
  total,
  range,
  onPageChange,
  className,
  label = "items",
  showFirstLast = true,
  hideWhenSingle = false,
  pageSize,
  onPageSizeChange,
  pageSizeOptions,
  pageSizeLabel = "Rows",
  allLabel = "All",
}: PaginationProps) {
  const hasSizeSelector =
    typeof pageSize === "number" && typeof onPageSizeChange === "function";

  // With a selector present the user always has *something* to
  // interact with, so we render even for single-page lists — otherwise
  // they'd be locked in at the current size with no way to reach the
  // "Show 100/page" option that would collapse into a single page.
  if (hideWhenSingle && pageCount <= 1 && !hasSizeSelector) return null;

  const prevDisabled = page <= 1;
  const nextDisabled = page >= pageCount;

  const summary =
    total === 0
      ? `0 ${label}`
      : `${range[0]}–${range[1]} of ${total} ${label}`;

  const options = pageSizeOptions ?? DEFAULT_PAGE_SIZE_OPTIONS;

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-[0.7rem] text-muted-foreground flex-wrap",
        className,
      )}
    >
      <span className="tabular-nums">{summary}</span>

      {hasSizeSelector && (
        <label className="flex items-center gap-1.5 ml-2">
          <span className="whitespace-nowrap">{pageSizeLabel}</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange!(Number(e.target.value))}
            className="h-6 rounded-md border border-border bg-card px-1.5 text-[0.7rem] tabular-nums focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={pageSizeLabel}
          >
            {options.map((size) => (
              <option key={size} value={size}>
                {size === 0 ? allLabel : size}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="ml-auto flex items-center gap-0.5">
        {showFirstLast && (
          <PagerButton
            onClick={() => onPageChange(1)}
            disabled={prevDisabled}
            title="First page"
            aria-label="First page"
          >
            <ChevronsLeft className="h-3 w-3" />
          </PagerButton>
        )}
        <PagerButton
          onClick={() => onPageChange(page - 1)}
          disabled={prevDisabled}
          title="Previous page"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3 w-3" />
        </PagerButton>
        <span className="px-2 tabular-nums select-none">
          {page} / {pageCount}
        </span>
        <PagerButton
          onClick={() => onPageChange(page + 1)}
          disabled={nextDisabled}
          title="Next page"
          aria-label="Next page"
        >
          <ChevronRight className="h-3 w-3" />
        </PagerButton>
        {showFirstLast && (
          <PagerButton
            onClick={() => onPageChange(pageCount)}
            disabled={nextDisabled}
            title="Last page"
            aria-label="Last page"
          >
            <ChevronsRight className="h-3 w-3" />
          </PagerButton>
        )}
      </div>
    </div>
  );
}

function PagerButton({
  onClick,
  disabled,
  title,
  children,
  "aria-label": ariaLabel,
}: {
  onClick: () => void;
  disabled: boolean;
  title: string;
  children: React.ReactNode;
  "aria-label": string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className="h-6 w-6 inline-flex items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );
}
