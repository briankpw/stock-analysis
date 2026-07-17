"use client";

/**
 * Portfolios rail — the master list of People / Politicians / Fund managers
 * with search, collapsible sections, A-Z sort toggles, section reordering,
 * recently-viewed history, and the "add new…" dialog.
 *
 * This component lives in the app sidebar (portfolio mode) so it's
 * available from every route inside the module. Selection + prefs live
 * in a shared Zustand store (`lib/portfolios-state`) so the /portfolios
 * detail page stays in sync.
 */

import * as React from "react";
import {
  ArrowDownAZ,
  ArrowUpDown,
  Bell,
  Building2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Landmark,
  Plus,
  Search,
  SearchX,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EntitySearch, titleCase, type EntityHit } from "@/components/entity-search";
import { LoadingPage, ErrorBanner } from "@/components/loading";
import { usePortfolioIndex } from "@/hooks/use-portfolios";
import { usePortfolioWatches } from "@/hooks/use-portfolio-watches";
import { useT } from "@/lib/i18n";
import {
  usePortfolios,
  type Category,
  type Selection,
  type SortMode,
} from "@/lib/portfolios-state";
import type {
  FundPreset,
  PersonPreset,
  PoliticianPreset,
  PortfolioIndex,
} from "@/lib/portfolios";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Presentation constants — shared with the detail views (`PARTY_META`) via
// re-export so the party chip looks the same in the rail and the header.
// ---------------------------------------------------------------------------

export const PARTY_META: Record<"D" | "R" | "I", { chip: string; label: string }> = {
  D: { chip: "bg-blue-500/15 text-blue-500 border-blue-500/40", label: "Democrat" },
  R: { chip: "bg-red-500/15 text-red-500 border-red-500/40", label: "Republican" },
  I: { chip: "bg-purple-500/15 text-purple-500 border-purple-500/40", label: "Independent" },
};

/**
 * Per-category visual language:
 *   - `icon`   — the section heading glyph
 *   - `accent` — a solid vertical bar (left edge) and matching dot chip;
 *                gives each row a quick, glance-able "which category
 *                is this?" cue when they show up mixed in Recently viewed
 *                or filtered search results.
 */
const CATEGORY_META: Record<
  Category,
  {
    label: string;
    singular: string;
    icon: React.ComponentType<{ className?: string }>;
    accentBar: string;
    dot: string;
    iconClass: string;
  }
> = {
  people: {
    label: "People",
    singular: "person",
    icon: Users,
    accentBar: "before:bg-sky-500/70",
    dot: "bg-sky-500",
    iconClass: "text-sky-500",
  },
  politicians: {
    label: "Politicians",
    singular: "politician",
    icon: Landmark,
    accentBar: "before:bg-amber-500/70",
    dot: "bg-amber-500",
    iconClass: "text-amber-500",
  },
  funds: {
    label: "Fund managers",
    singular: "fund manager",
    icon: Building2,
    accentBar: "before:bg-emerald-500/70",
    dot: "bg-emerald-500",
    iconClass: "text-emerald-500",
  },
};

// ---------------------------------------------------------------------------
// Rail entry adapters — flatten each category into a common shape so the
// row component can render any of them.
// ---------------------------------------------------------------------------

interface RailEntry {
  id: string;
  primary: string;
  secondary?: string;
  badge?: React.ReactNode;
  custom: boolean;
}

export function entriesForCategory(index: PortfolioIndex, category: Category): RailEntry[] {
  if (category === "people") {
    return index.people.map((p) => ({
      id: p.id,
      primary: p.name,
      secondary: p.role,
      custom: p.custom,
    }));
  }
  if (category === "politicians") {
    return index.politicians.map((p) => ({
      id: p.id,
      primary: p.name,
      secondary: `${p.chamber}${p.role ? ` · ${p.role}` : ""}`,
      badge: <span className={cn("chip", PARTY_META[p.party].chip)}>{p.party}</span>,
      custom: p.custom,
    }));
  }
  return index.funds.map((f) => ({
    id: f.id,
    primary: f.manager,
    secondary: f.firm,
    custom: f.custom,
  }));
}

function matchesSearch(e: RailEntry, needle: string): boolean {
  if (!needle) return true;
  const n = needle.toLowerCase();
  return (
    e.primary.toLowerCase().includes(n) ||
    (e.secondary?.toLowerCase().includes(n) ?? false) ||
    e.id.toLowerCase().includes(n)
  );
}

// ---------------------------------------------------------------------------
// PortfoliosRail — the master list, wired to the shared store so the
// /portfolios detail view stays in sync.
// ---------------------------------------------------------------------------

export function PortfoliosRail() {
  const { data: index, loading, error, addPreset, removePreset } = usePortfolioIndex();
  const { isPersonWatched } = usePortfolioWatches();
  const selection = usePortfolios((s) => s.selection);
  const prefs = usePortfolios((s) => s.prefs);
  const addDialogCategory = usePortfolios((s) => s.addDialogCategory);
  const recordViewed = usePortfolios((s) => s.recordViewed);
  const setSelection = usePortfolios((s) => s.setSelection);
  const setAddDialogCategory = usePortfolios((s) => s.setAddDialogCategory);
  const updatePrefs = usePortfolios((s) => s.updatePrefs);
  const forgetRecent = usePortfolios((s) => s.forgetRecent);
  const t = useT();

  const [query, setQuery] = React.useState("");
  const needle = query.trim();

  const toggleCollapse = (c: Category) =>
    updatePrefs((p) => ({ ...p, collapsed: { ...p.collapsed, [c]: !p.collapsed[c] } }));
  const toggleSort = (c: Category) =>
    updatePrefs((p) => ({
      ...p,
      sort: { ...p.sort, [c]: (p.sort[c] ?? "default") === "default" ? "alpha" : "default" },
    }));
  const moveSection = (c: Category, direction: -1 | 1) =>
    updatePrefs((p) => {
      const order = [...p.order];
      const idx = order.indexOf(c);
      const target = idx + direction;
      if (idx < 0 || target < 0 || target >= order.length) return p;
      [order[idx], order[target]] = [order[target]!, order[idx]!];
      return { ...p, order };
    });

  const handleDelete = async (category: Category, id: string) => {
    const apiCategory =
      category === "people" ? "person" : category === "politicians" ? "politician" : "fund";
    try {
      await removePreset(apiCategory, id);
      forgetRecent(category, id);
      if (selection?.category === category && selection.id === id) {
        setSelection(null);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  const handleAdd = async (
    apiCategory: "politician" | "fund" | "person",
    preset: PoliticianPreset | FundPreset | PersonPreset,
  ) => {
    await addPreset(apiCategory, preset);
    const uiCategory: Category =
      apiCategory === "person" ? "people" : apiCategory === "politician" ? "politicians" : "funds";
    recordViewed({ category: uiCategory, id: preset.id });
    setAddDialogCategory(null);
  };

  if (loading && !index) return <LoadingPage label={t("loading.presetList")} />;
  if (error && !index) return <ErrorBanner message={error} />;
  if (!index) return null;

  const recentEntries: Array<{ sel: Selection; entry: RailEntry; category: Category }> = [];
  for (const sel of prefs.recent) {
    const entry = entriesForCategory(index, sel.category).find((e) => e.id === sel.id);
    if (entry) recentEntries.push({ sel, entry, category: sel.category });
  }

  const showRecent = needle === "" && recentEntries.length > 0;
  const anyMatches =
    !needle ||
    prefs.order.some((c) => entriesForCategory(index, c).some((e) => matchesSearch(e, needle)));

  return (
    <>
      <div className="space-y-3">
        <RailSearchBar query={query} onChange={setQuery} />

        {showRecent && (
          <RecentSection
            rows={recentEntries}
            selection={selection}
            onSelect={recordViewed}
          />
        )}

        {!anyMatches && (
          <Card className="p-6 text-center">
            <SearchX className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {t("portfolios.rail.noMatch", { q: needle })}
            </p>
            <button
              onClick={() => setQuery("")}
              className="mt-3 text-xs text-primary hover:underline"
            >
              {t("common.clearSearch")}
            </button>
          </Card>
        )}

        {prefs.order.map((category, idx) => {
          const rawEntries = entriesForCategory(index, category);
          const filtered = rawEntries.filter((e) => matchesSearch(e, needle));
          if (needle && filtered.length === 0) return null;

          const sortMode = prefs.sort[category] ?? "default";
          const displayed =
            sortMode === "alpha"
              ? [...filtered].sort((a, b) => a.primary.localeCompare(b.primary))
              : filtered;

          return (
            <RailSection
              key={category}
              category={category}
              entries={displayed}
              rawCount={rawEntries.length}
              selection={selection}
              collapsed={!!prefs.collapsed[category]}
              sortMode={sortMode}
              canMoveUp={idx > 0}
              canMoveDown={idx < prefs.order.length - 1}
              onSelect={recordViewed}
              onDelete={handleDelete}
              onAddClick={setAddDialogCategory}
              onToggleCollapse={() => toggleCollapse(category)}
              onToggleSort={() => toggleSort(category)}
              onMoveUp={() => moveSection(category, -1)}
              onMoveDown={() => moveSection(category, 1)}
              forceOpen={!!needle}
              isWatched={(id) => isPersonWatched(category, id)}
            />
          );
        })}
      </div>

      {addDialogCategory && (
        <AddPresetDialog
          category={addDialogCategory}
          onClose={() => setAddDialogCategory(null)}
          onSubmit={handleAdd}
        />
      )}
    </>
  );
}

function RailSearchBar({
  query,
  onChange,
}: {
  query: string;
  onChange: (v: string) => void;
}) {
  const t = useT();
  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      <input
        type="search"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("portfolios.rail.searchPlaceholder")}
        className="w-full rounded-md border border-border bg-card pl-8 pr-8 py-1.5 text-sm placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
      />
      {query && (
        <button
          onClick={() => onChange("")}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted/50 text-muted-foreground"
          aria-label={t("common.clearSearch")}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function RecentSection({
  rows,
  selection,
  onSelect,
}: {
  rows: Array<{ sel: Selection; entry: RailEntry; category: Category }>;
  selection: Selection | null;
  onSelect: (sel: Selection) => void;
}) {
  const t = useT();
  return (
    <Card className={cn(
      "p-0 overflow-hidden relative",
      "before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-primary/50",
    )}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/20">
        <Clock className="h-3.5 w-3.5 text-primary" />
        <span className="metric-label flex-1">
          {t("portfolios.rail.recent", { n: rows.length })}
        </span>
      </div>
      <ul className="divide-y divide-border/50">
        {rows.map(({ sel, entry, category }) => {
          const meta = CATEGORY_META[category];
          const label = t(`portfolios.cat.${category}`);
          const singular = t(`portfolios.cat.${category}.singular`);
          const active =
            selection?.category === sel.category && selection.id === sel.id;
          return (
            <li key={`${sel.category}:${sel.id}`}>
              <button
                onClick={() => onSelect(sel)}
                className={cn(
                  "w-full text-left flex items-center gap-2 px-3 py-1.5 transition-colors",
                  active ? "bg-primary/10" : "hover:bg-muted/30",
                )}
              >
                <span
                  className={cn("h-2 w-2 rounded-full shrink-0", meta.dot)}
                  title={label}
                />
                <span className="text-sm truncate flex-1">{entry.primary}</span>
                <span className="text-[0.65rem] uppercase text-muted-foreground/70 shrink-0">
                  {singular}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function RailSection({
  category,
  entries,
  rawCount,
  selection,
  collapsed,
  forceOpen,
  sortMode,
  canMoveUp,
  canMoveDown,
  onSelect,
  onDelete,
  onAddClick,
  onToggleCollapse,
  onToggleSort,
  onMoveUp,
  onMoveDown,
  isWatched,
}: {
  category: Category;
  entries: RailEntry[];
  rawCount: number;
  selection: Selection | null;
  collapsed: boolean;
  forceOpen: boolean;
  sortMode: SortMode;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelect: (sel: Selection) => void;
  onDelete: (category: Category, id: string) => void | Promise<void>;
  onAddClick: (category: Category) => void;
  onToggleCollapse: () => void;
  onToggleSort: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  isWatched: (presetId: string) => boolean;
}) {
  const t = useT();
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  const label = t(`portfolios.cat.${category}`);
  const singular = t(`portfolios.cat.${category}.singular`);
  const showList = !collapsed || forceOpen;

  return (
    <Card
      className={cn(
        "p-0 overflow-hidden relative",
        "before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px]",
        meta.accentBar,
      )}
    >
      <div className="group/header flex items-center gap-1.5 px-3 py-2 border-b border-border bg-muted/20">
        <button
          onClick={onToggleCollapse}
          className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted/50 text-muted-foreground shrink-0"
          aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed && !forceOpen ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
        <Icon className={cn("h-3.5 w-3.5", meta.iconClass)} />
        <span className="metric-label flex-1 truncate">
          {label} ({rawCount})
        </span>
        <button
          onClick={onToggleSort}
          className={cn(
            "h-5 w-5 inline-flex items-center justify-center rounded shrink-0 transition-colors",
            sortMode === "alpha"
              ? "bg-primary/15 text-primary"
              : "hover:bg-muted/50 text-muted-foreground",
          )}
          title={sortMode === "alpha" ? "Sorted A-Z (click to reset)" : "Sort A-Z"}
          aria-label="Toggle A-Z sort"
        >
          {sortMode === "alpha" ? (
            <ArrowDownAZ className="h-3 w-3" />
          ) : (
            <ArrowUpDown className="h-3 w-3" />
          )}
        </button>
        <div className="opacity-0 group-hover/header:opacity-100 transition-opacity flex items-center shrink-0">
          <button
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted/50 text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label={`Move ${label} up`}
            title="Move section up"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <button
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-muted/50 text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label={`Move ${label} down`}
            title="Move section down"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
        <button
          onClick={() => onAddClick(category)}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.7rem] text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors shrink-0"
          title={t("portfolios.dialog.title", { singular })}
        >
          <Plus className="h-3 w-3" />
          {t("portfolios.rail.addAction")}
        </button>
      </div>
      {showList && (
        <ul className="divide-y divide-border/50">
          {entries.length === 0 ? (
            <li className="px-3 py-4 text-center text-xs text-muted-foreground">
              {t("portfolios.rail.noneYet", { label: singular })}{" "}
              <button
                onClick={() => onAddClick(category)}
                className="text-primary hover:underline"
              >
                {t("portfolios.rail.addOne")}
              </button>
              .
            </li>
          ) : (
            entries.map((e) => {
              const active =
                selection?.category === category && selection.id === e.id;
              return (
                <li key={e.id}>
                  <div
                    className={cn(
                      "group relative flex items-start gap-2 px-3 py-1.5 transition-colors",
                      active ? "bg-primary/10" : "hover:bg-muted/30",
                    )}
                  >
                    <button
                      onClick={() => onSelect({ category, id: e.id })}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">{e.primary}</span>
                        {isWatched(e.id) && (
                          <span
                            title="Alerts enabled — every trade notifies via Telegram"
                            className="inline-flex items-center"
                          >
                            <Bell
                              className="h-3 w-3 text-primary shrink-0"
                              aria-label="Alerts enabled"
                            />
                          </span>
                        )}
                        {e.badge}
                        {e.custom && (
                          <span
                            className="text-[0.6rem] uppercase tracking-wider text-muted-foreground/60 border border-border/60 rounded px-1"
                            title={t("portfolios.rail.customTitle")}
                          >
                            {t("portfolios.rail.customBadge")}
                          </span>
                        )}
                      </div>
                      {e.secondary && (
                        <div className="text-[0.7rem] text-muted-foreground truncate mt-0.5">
                          {e.secondary}
                        </div>
                      )}
                    </button>
                    {e.custom && (
                      <button
                        onClick={() => {
                          if (confirm(`Remove "${e.primary}" from ${label}?`)) {
                            void onDelete(category, e.id);
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 inline-flex items-center justify-center rounded hover:bg-danger/15 hover:text-danger text-muted-foreground"
                        title={`Remove ${e.primary}`}
                        aria-label={`Remove ${e.primary}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                    {active && (
                      <ChevronRight className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                    )}
                  </div>
                </li>
              );
            })
          )}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Add-preset dialog — one form per category
// ---------------------------------------------------------------------------

function AddPresetDialog({
  category,
  onClose,
  onSubmit,
}: {
  category: Category;
  onClose: () => void;
  onSubmit: (
    apiCategory: "politician" | "fund" | "person",
    preset: PoliticianPreset | FundPreset | PersonPreset,
  ) => Promise<void>;
}) {
  const t = useT();
  const singular = t(`portfolios.cat.${category}.singular`);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <Card
        className="w-full max-w-md p-0 overflow-hidden shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">{t("portfolios.dialog.title", { singular })}</h3>
          <button
            onClick={onClose}
            className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-muted/40 text-muted-foreground"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {category === "people" && (
          <PersonForm onCancel={onClose} onSubmit={(p) => onSubmit("person", p)} />
        )}
        {category === "politicians" && (
          <PoliticianForm onCancel={onClose} onSubmit={(p) => onSubmit("politician", p)} />
        )}
        {category === "funds" && (
          <FundForm onCancel={onClose} onSubmit={(p) => onSubmit("fund", p)} />
        )}
      </Card>
    </div>
  );
}

function toIdSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function FormShell({
  children,
  onCancel,
  onSubmit,
  submitting,
  error,
}: {
  children: React.ReactNode;
  onCancel: () => void;
  onSubmit: (e: React.FormEvent) => void;
  submitting: boolean;
  error: string | null;
}) {
  const t = useT();
  return (
    <form onSubmit={onSubmit} className="p-4 space-y-3">
      {children}
      {error && (
        <div className="text-xs text-danger bg-danger/10 border border-danger/30 rounded-md px-2 py-1.5">
          {error}
        </div>
      )}
      <div className="flex items-center justify-end gap-2 pt-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={submitting}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? t("common.adding") : t("common.add")}
        </Button>
      </div>
    </form>
  );
}

function LabeledInput({
  label,
  hint,
  ...props
}: {
  label: string;
  hint?: React.ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block text-xs">
      <span className="metric-label block mb-1">{label}</span>
      <input
        {...props}
        className={cn(
          "w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary",
          props.className,
        )}
      />
      {hint && <div className="text-[0.65rem] text-muted-foreground mt-1">{hint}</div>}
    </label>
  );
}

function PersonForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (preset: PersonPreset) => Promise<void>;
}) {
  const [picked, setPicked] = React.useState<EntityHit | null>(null);
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const t = useT();

  const choose = (hit: EntityHit) => {
    setPicked(hit);
    setName(titleCase(hit.name));
    const topCompany = hit.companies[0] ? titleCase(hit.companies[0]) : null;
    setRole(topCompany ? `Insider at ${topCompany}` : "Insider");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked) return;
    setError(null);
    setBusy(true);
    try {
      const cleanName = name.trim();
      if (!cleanName) throw new Error("Name is required");
      await onSubmit({
        id: toIdSlug(cleanName),
        name: cleanName,
        role: role.trim() || "Insider",
        cik: picked.cik,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!picked) {
    return (
      <div className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          {t("form.personSearchIntro")}
        </p>
        <EntitySearch kind="person" onPick={choose} autoFocus />
        <div className="flex items-center justify-end pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <FormShell onCancel={onCancel} onSubmit={submit} submitting={busy} error={error}>
      <SelectedEntityCard
        hit={picked}
        onChange={() => {
          setPicked(null);
          setName("");
          setRole("");
        }}
      />
      <LabeledInput
        label={t("form.displayName")}
        placeholder="Jane Doe"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        hint={t("form.displayNameHint")}
      />
      <LabeledInput
        label={t("form.role")}
        placeholder={t("form.rolePlaceholder")}
        value={role}
        onChange={(e) => setRole(e.target.value)}
      />
    </FormShell>
  );
}

function SelectedEntityCard({
  hit,
  onChange,
}: {
  hit: EntityHit;
  onChange: () => void;
}) {
  const t = useT();
  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-[0.65rem] uppercase tracking-wider text-muted-foreground">
          {t("portfolios.dialog.selectedOn")}
        </div>
        <div className="text-sm font-medium truncate">{titleCase(hit.name)}</div>
        <div className="text-[0.65rem] text-muted-foreground/80 font-mono mt-0.5">
          CIK {hit.cik}
          {hit.companies.length > 0 && (
            <span className="not-italic ml-2 font-sans">
              · {hit.companies.slice(0, 2).map(titleCase).join(", ")}
            </span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onChange}
        className="text-[0.7rem] text-primary hover:underline shrink-0"
      >
        {t("common.change")}
      </button>
    </div>
  );
}

function PoliticianForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (preset: PoliticianPreset) => Promise<void>;
}) {
  const [name, setName] = React.useState("");
  const [chamber, setChamber] = React.useState<"House" | "Senate">("House");
  const [party, setParty] = React.useState<"D" | "R" | "I">("D");
  const [role, setRole] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const t = useT();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onSubmit({
        id: toIdSlug(name),
        name: name.trim(),
        chamber,
        party,
        role: role.trim() || undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormShell onCancel={onCancel} onSubmit={submit} submitting={busy} error={error}>
      <div className="text-[0.7rem] text-muted-foreground bg-muted/30 border border-border rounded-md p-2.5">
        <p>{t("form.politicianDataSource")}</p>
      </div>
      <LabeledInput
        label={t("form.namePolitician")}
        placeholder="Nancy Pelosi"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        hint={t("form.politicianNameHint")}
      />
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs">
          <span className="metric-label block mb-1">{t("form.chamber")}</span>
          <select
            className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            value={chamber}
            onChange={(e) => setChamber(e.target.value as "House" | "Senate")}
          >
            <option value="House">{t("form.chamberHouse")}</option>
            <option value="Senate">{t("form.chamberSenate")}</option>
          </select>
        </label>
        <label className="block text-xs">
          <span className="metric-label block mb-1">{t("form.party")}</span>
          <select
            className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            value={party}
            onChange={(e) => setParty(e.target.value as "D" | "R" | "I")}
          >
            <option value="D">{t("form.party.d")}</option>
            <option value="R">{t("form.party.r")}</option>
            <option value="I">{t("form.party.i")}</option>
          </select>
        </label>
      </div>
      <LabeledInput
        label={t("form.roleOptional")}
        placeholder="Former Speaker"
        value={role}
        onChange={(e) => setRole(e.target.value)}
      />
    </FormShell>
  );
}

function FundForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (preset: FundPreset) => Promise<void>;
}) {
  const [picked, setPicked] = React.useState<EntityHit | null>(null);
  const [manager, setManager] = React.useState("");
  const [firm, setFirm] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const t = useT();

  const choose = (hit: EntityHit) => {
    setPicked(hit);
    setFirm(titleCase(hit.name));
    setManager("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!picked) return;
    setError(null);
    setBusy(true);
    try {
      const cleanFirm = firm.trim();
      const cleanManager = manager.trim() || cleanFirm;
      if (!cleanFirm) throw new Error("Firm is required");
      await onSubmit({
        id: toIdSlug(`${cleanManager}-${cleanFirm}`),
        manager: cleanManager,
        firm: cleanFirm,
        cik: picked.cik,
        note: note.trim() || undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!picked) {
    return (
      <div className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          {t("form.fundSearchIntro")}
        </p>
        <EntitySearch kind="fund" onPick={choose} autoFocus />
        <div className="flex items-center justify-end pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <FormShell onCancel={onCancel} onSubmit={submit} submitting={busy} error={error}>
      <SelectedEntityCard
        hit={picked}
        onChange={() => {
          setPicked(null);
          setManager("");
          setFirm("");
        }}
      />
      <LabeledInput
        label={t("form.manager")}
        placeholder="Warren Buffett"
        value={manager}
        onChange={(e) => setManager(e.target.value)}
        hint={t("form.managerHint")}
      />
      <LabeledInput
        label={t("form.firm")}
        placeholder="Berkshire Hathaway"
        required
        value={firm}
        onChange={(e) => setFirm(e.target.value)}
      />
      <LabeledInput
        label={t("form.noteOptional")}
        placeholder="Small, concentrated portfolio; often uses put/call options"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </FormShell>
  );
}
