"use client";

import * as React from "react";
import { Building2, Loader2, Search, User } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Serialised shape of `EntitySearchResult` from `lib/portfolios.ts`. */
export interface EntityHit {
  kind: "person" | "fund";
  cik: string;
  name: string;
  companies: string[];
  filingCount: number;
  latestFilingDate: string | null;
  formTypes: string[];
}

interface Props {
  kind: "person" | "fund";
  onPick: (hit: EntityHit) => void;
  autoFocus?: boolean;
  placeholder?: string;
}

/**
 * Type-ahead SEC EDGAR search. Debounced by 250ms so we don't hammer the
 * SEC endpoint on every keystroke, and the parent only sees the eventual
 * selection via `onPick`.
 */
export function EntitySearch({ kind, onPick, autoFocus, placeholder }: Props) {
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<EntityHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sourceDown, setSourceDown] = React.useState(false);
  const t = useT();

  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    const q = query.trim();
    setError(null);
    setSourceDown(false);
    if (q.length < 2) {
      setHits([]);
      setLoading(false);
      abortRef.current?.abort();
      return;
    }
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;
      setLoading(true);
      try {
        const url = `/api/portfolios/search?q=${encodeURIComponent(q)}&kind=${kind}`;
        const res = await fetch(url, { cache: "no-store", signal: ctl.signal });
        const body = await res.json();
        if (ctl.signal.aborted) return;
        if (res.status === 503 && body?.sourceUnavailable) {
          setSourceDown(true);
          setHits([]);
        } else if (!res.ok) {
          setError(body?.error ?? `HTTP ${res.status}`);
          setHits([]);
        } else {
          setHits((body?.results ?? []) as EntityHit[]);
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, kind]);

  const Icon = kind === "person" ? User : Building2;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            placeholder ??
            (kind === "person"
              ? t("entitySearch.personPlaceholder")
              : t("entitySearch.fundPlaceholder"))
          }
          className="w-full rounded-md border border-border bg-card pl-8 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
          aria-label={
            kind === "person"
              ? t("entitySearch.personAria")
              : t("entitySearch.fundAria")
          }
        />
        {loading && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
        )}
      </div>

      {sourceDown && (
        <p className="text-xs text-warning bg-warning/10 border border-warning/30 rounded-md px-2 py-1.5">
          {t("portfolios.sec.throttled")}
        </p>
      )}
      {error && !sourceDown && (
        <p className="text-xs text-danger bg-danger/10 border border-danger/30 rounded-md px-2 py-1.5">
          {error}
        </p>
      )}

      {query.trim().length >= 2 && !loading && hits.length === 0 && !error && !sourceDown && (
        <p className="text-xs text-muted-foreground px-1">
          {t("entitySearch.noMatch", { q: query.trim() })}
        </p>
      )}

      {hits.length > 0 && (
        <ul
          className="max-h-72 overflow-y-auto rounded-md border border-border divide-y divide-border/50"
          role="listbox"
        >
          {hits.map((h) => (
            <li key={h.cik}>
              <button
                type="button"
                onClick={() => onPick(h)}
                className={cn(
                  "w-full text-left px-3 py-2.5 hover:bg-primary/10 transition-colors",
                  "focus:outline-none focus:bg-primary/10",
                )}
              >
                <div className="flex items-start gap-2">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium leading-tight truncate">
                      {titleCase(h.name)}
                    </div>
                    {h.companies.length > 0 && (
                      <div className="text-[0.7rem] text-muted-foreground mt-0.5 truncate">
                        {h.companies.slice(0, 2).map(titleCase).join(" · ")}
                      </div>
                    )}
                    <div className="text-[0.65rem] text-muted-foreground/70 mt-0.5 font-mono">
                      CIK {h.cik}
                      {h.latestFilingDate && (
                        <span className="ml-2">
                          {t("entitySearch.lastFiled", { date: new Date(h.latestFilingDate).toLocaleDateString() })}
                        </span>
                      )}
                      <span className="ml-2">
                        · {t("entitySearch.filingCount", { n: h.filingCount })}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * SEC returns names in ALL CAPS ("COOK TIMOTHY D") for individuals and
 * mixed case for firms. Normalise both to Title Case for the UI, but
 * keep obvious acronyms/all-caps tokens as-is (e.g. "LLC", "INC", "LP").
 */
export function titleCase(input: string): string {
  const parts = input.split(/(\s+|[,()])/);
  return parts
    .map((tok) => {
      if (/^\s+$/.test(tok)) return tok;
      if (/^[,()]$/.test(tok)) return tok;
      if (tok.length <= 3 && /^[A-Z]+$/.test(tok)) return tok; // LLC, INC, LP, CIK
      if (/^\d/.test(tok)) return tok;
      const lower = tok.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}
