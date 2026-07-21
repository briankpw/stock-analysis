/**
 * Portfolio picker chip + management dialog for the paper-trading page.
 *
 * ## Role in the multi-portfolio system
 *
 * Renders as a single row above the paper page's existing three-card
 * layout. The visible chip shows the currently-active portfolio's
 * name + a summary of its state (P&L status via colour; not a full
 * number to avoid duplicating the PortfolioCard headline). Clicking
 * the chip opens the dropdown; clicking the pencil icon opens a
 * separate management dialog for rename / delete.
 *
 * ## Data flow
 *
 * The picker is a *controlled* component: it never fetches its own
 * portfolio list. The parent (`app/paper/page.tsx`) already has that
 * list on its `/api/paper` response, so passing `portfolios` as a
 * prop avoids the duplicate GET and, more importantly, keeps the
 * picker's "which name is highlighted" state perfectly aligned with
 * what the rest of the page just rendered.
 *
 * Mutations POST/PATCH/DELETE to `/api/paper/portfolios` directly
 * and, on success, call `onChanged()` so the parent refetches
 * `/api/paper` — which then re-derives everything from a single
 * source of truth. `onSwitch(id)` writes to zustand
 * (`activePaperPortfolioId`) and the parent's `usePaper(id)`
 * effect re-fires with the new id.
 */

"use client";

import * as React from "react";
import {
  ChevronDown,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtCurrency } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { PortfolioSummary } from "@/lib/paper-trading";

interface PortfolioPickerProps {
  portfolios: PortfolioSummary[];
  activePortfolioId: number;
  /** Fires when the user picks a different portfolio in the dropdown.
   *  The parent should persist this in `activePaperPortfolioId` — the
   *  picker deliberately does NOT touch zustand itself so it stays a
   *  pure controlled component (easier to test and reason about). */
  onSwitch: (id: number) => void;
  /** Fires after any create / rename / delete succeeds. The parent
   *  should refetch `/api/paper` (and thereby the portfolios list) so
   *  the picker sees the change in the next render. */
  onChanged: () => void;
}

export function PortfolioPicker({
  portfolios,
  activePortfolioId,
  onSwitch,
  onChanged,
}: PortfolioPickerProps) {
  const t = useT();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [manageOpen, setManageOpen] = React.useState(false);
  const active = portfolios.find((p) => p.id === activePortfolioId);
  const pickerRef = React.useRef<HTMLDivElement | null>(null);

  // Close the dropdown when the user clicks anywhere else. Escape
  // closes it too — matches the affordance the rest of the app uses
  // for popovers (e.g. the ticker picker).
  React.useEffect(() => {
    if (!pickerOpen) return;
    const onClickAway = (e: MouseEvent) => {
      if (!pickerRef.current) return;
      if (!pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerOpen(false);
    };
    document.addEventListener("mousedown", onClickAway);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickAway);
      document.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);

  return (
    <>
      <div
        ref={pickerRef}
        className="relative inline-flex items-center gap-1 rounded-lg border border-border bg-card/80 shadow-sm"
      >
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={pickerOpen}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 text-sm rounded-l-lg",
            "hover:bg-muted/40 transition-colors",
          )}
        >
          <span className="metric-label leading-none">
            {t("paper.portfolios.label")}
          </span>
          <span className="font-semibold truncate max-w-[200px]">
            {active?.name ?? t("paper.portfolios.empty")}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform",
              pickerOpen && "rotate-180",
            )}
          />
        </button>
        <button
          type="button"
          onClick={() => setManageOpen(true)}
          className="px-2 py-1.5 border-l border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors rounded-r-lg"
          aria-label={t("paper.portfolios.manage")}
          title={t("paper.portfolios.manage")}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>

        {pickerOpen && (
          // Solid `bg-card` (matches the rest of the app's popovers —
          // see `add-issuer-to-watchlist-button.tsx` and
          // `components/ui/tooltip.tsx`). An earlier version used
          // `bg-popover`, which isn't defined in this project's
          // Tailwind theme and rendered fully transparent — the
          // listbox looked empty even though the options were there.
          <div
            role="listbox"
            className="absolute left-0 top-[calc(100%+4px)] z-40 min-w-[260px] max-w-[380px] rounded-lg border border-border bg-card shadow-lg py-1"
          >
            <ul className="max-h-72 overflow-y-auto">
              {portfolios.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={p.id === activePortfolioId}
                    onClick={() => {
                      onSwitch(p.id);
                      setPickerOpen(false);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-sm flex items-center gap-2",
                      "hover:bg-muted/60 transition-colors",
                      p.id === activePortfolioId && "bg-muted/40",
                    )}
                  >
                    <span className="flex-1 min-w-0 truncate">{p.name}</span>
                    <span className="tabular-nums text-xs text-muted-foreground shrink-0">
                      {fmtCurrency(p.cash)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t border-border mt-1 pt-1">
              <button
                type="button"
                onClick={() => {
                  setPickerOpen(false);
                  setManageOpen(true);
                }}
                className="w-full text-left px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors flex items-center gap-2"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("paper.portfolios.newDots")}
              </button>
            </div>
          </div>
        )}
      </div>

      {manageOpen && (
        <ManageDialog
          portfolios={portfolios}
          activePortfolioId={activePortfolioId}
          onClose={() => setManageOpen(false)}
          onSwitch={onSwitch}
          onChanged={onChanged}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Manage dialog
// ---------------------------------------------------------------------------

/**
 * Full CRUD surface for portfolios. Sits in a modal so the paper page
 * doesn't have to squeeze rename / delete controls into the already-
 * dense header. Actions:
 *
 *   * Create — name + starting cash (defaults to app config value).
 *   * Rename — inline per-row, guarded by UNIQUE.
 *   * Delete — confirmed via alert; server refuses if this is the last
 *     one (matches the "at least one row exists" invariant).
 *
 * Every mutation POSTs / PATCHes / DELETEs against
 * `/api/paper/portfolios` and, on success, fires `onChanged()` so the
 * parent paper page re-hydrates. That's cheap because the parent's
 * `usePaper()` re-runs on a nonce bump.
 */
function ManageDialog({
  portfolios,
  activePortfolioId,
  onClose,
  onSwitch,
  onChanged,
}: {
  portfolios: PortfolioSummary[];
  activePortfolioId: number;
  onClose: () => void;
  onSwitch: (id: number) => void;
  onChanged: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = React.useState<
    { kind: "create" | "rename" | "delete"; id?: number } | null
  >(null);
  const [error, setError] = React.useState<string | null>(null);

  // ---- Create form ----------------------------------------------------
  const [newName, setNewName] = React.useState("");
  const [newCash, setNewCash] = React.useState("");

  const createNew = async () => {
    setError(null);
    setBusy({ kind: "create" });
    try {
      const parsedCash = newCash.trim() === "" ? undefined : Number(newCash);
      if (parsedCash !== undefined && (!Number.isFinite(parsedCash) || parsedCash <= 0)) {
        throw new Error(t("paper.portfolios.err.badCash"));
      }
      const res = await fetch("/api/paper/portfolios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: newName,
          startingCash: parsedCash,
        }),
      });
      const body = (await res.json()) as
        | { ok: true; portfolio: PortfolioSummary }
        | { ok: false; error: string };
      if (!body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setNewName("");
      setNewCash("");
      // Switch to the newly-created portfolio so the user immediately
      // sees the empty state they just asked for.
      onSwitch(body.portfolio.id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // Escape key closes the dialog — the standard modal affordance.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center px-4 py-8 bg-background/70 backdrop-blur-sm overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card className="w-full max-w-lg shadow-2xl">
        <CardHeader className="flex-row items-start justify-between">
          <div>
            <CardTitle>{t("paper.portfolios.manageTitle")}</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {t("paper.portfolios.manageHint")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label={t("common.close")}
          >
            <X className="h-4 w-4" />
          </button>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* ---- Create form ---- */}
          <div className="rounded-md border border-border bg-card/50 p-3 space-y-2">
            <p className="metric-label">{t("paper.portfolios.createTitle")}</p>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-2 items-end">
              <div>
                <label className="text-[0.7rem] text-muted-foreground">
                  {t("paper.portfolios.field.name")}
                </label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={t("paper.portfolios.placeholder.name")}
                  className="mt-0.5 w-full h-9 rounded-md border border-border bg-card px-3 text-sm"
                  maxLength={60}
                />
              </div>
              <div>
                <label className="text-[0.7rem] text-muted-foreground">
                  {t("paper.portfolios.field.cash")}
                </label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={newCash}
                  onChange={(e) => setNewCash(e.target.value)}
                  placeholder={t("paper.portfolios.placeholder.cash")}
                  className="mt-0.5 w-full h-9 rounded-md border border-border bg-card px-3 text-sm tabular-nums"
                />
              </div>
              <Button
                onClick={createNew}
                disabled={busy?.kind === "create" || newName.trim() === ""}
              >
                {busy?.kind === "create" ? "…" : t("paper.portfolios.create")}
              </Button>
            </div>
          </div>

          {/* ---- Existing rows ---- */}
          <div>
            <p className="metric-label mb-2">
              {t("paper.portfolios.existing", { n: portfolios.length })}
            </p>
            <ul className="space-y-1.5">
              {portfolios.map((p) => (
                <PortfolioRow
                  key={p.id}
                  portfolio={p}
                  isActive={p.id === activePortfolioId}
                  canDelete={portfolios.length > 1}
                  busy={busy?.id === p.id ? busy.kind : null}
                  onRename={async (newName) => {
                    setError(null);
                    setBusy({ kind: "rename", id: p.id });
                    try {
                      const res = await fetch("/api/paper/portfolios", {
                        method: "PATCH",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ id: p.id, name: newName }),
                      });
                      const body = await res.json();
                      if (!res.ok || !body?.ok) {
                        throw new Error(body?.error || `HTTP ${res.status}`);
                      }
                      onChanged();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setBusy(null);
                    }
                  }}
                  onDelete={async () => {
                    if (
                      !confirm(
                        t("paper.portfolios.deleteConfirm", { name: p.name }),
                      )
                    ) {
                      return;
                    }
                    setError(null);
                    setBusy({ kind: "delete", id: p.id });
                    try {
                      const res = await fetch(
                        `/api/paper/portfolios?id=${p.id}`,
                        { method: "DELETE" },
                      );
                      const body = await res.json();
                      if (!res.ok || !body?.ok) {
                        throw new Error(body?.error || `HTTP ${res.status}`);
                      }
                      // If we just deleted the currently-active one,
                      // switch to whatever's still around. The server
                      // will pick a default on the next GET, but doing
                      // it here avoids one round-trip of stale UI.
                      if (p.id === activePortfolioId) {
                        const first = portfolios.find((x) => x.id !== p.id);
                        if (first) onSwitch(first.id);
                      }
                      onChanged();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setBusy(null);
                    }
                  }}
                />
              ))}
            </ul>
          </div>

          {error && (
            <p className="text-xs text-danger" role="alert">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PortfolioRow({
  portfolio,
  isActive,
  canDelete,
  busy,
  onRename,
  onDelete,
}: {
  portfolio: PortfolioSummary;
  isActive: boolean;
  canDelete: boolean;
  busy: "create" | "rename" | "delete" | null;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const t = useT();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(portfolio.name);

  React.useEffect(() => {
    setDraft(portfolio.name);
  }, [portfolio.name]);

  const commit = async () => {
    const trimmed = draft.trim();
    if (trimmed === "" || trimmed === portfolio.name) {
      setEditing(false);
      setDraft(portfolio.name);
      return;
    }
    await onRename(trimmed);
    setEditing(false);
  };

  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-md border px-3 py-2",
        isActive
          ? "border-primary/60 bg-primary/5"
          : "border-border bg-card/40",
      )}
    >
      {editing ? (
        <>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setEditing(false);
                setDraft(portfolio.name);
              }
            }}
            className="flex-1 min-w-0 h-8 rounded-md border border-border bg-card px-2 text-sm"
            maxLength={60}
          />
          <Button size="sm" onClick={commit} disabled={busy === "rename"}>
            {busy === "rename" ? "…" : t("common.save")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setDraft(portfolio.name);
            }}
          >
            {t("common.cancel")}
          </Button>
        </>
      ) : (
        <>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold truncate">{portfolio.name}</span>
              {isActive && (
                <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[0.6rem] uppercase tracking-wider text-primary font-semibold">
                  {t("paper.portfolios.activeChip")}
                </span>
              )}
            </div>
            <p className="text-[0.7rem] text-muted-foreground mt-0.5 tabular-nums">
              {t("paper.portfolios.rowStats", {
                cash: fmtCurrency(portfolio.cash),
                starting: fmtCurrency(portfolio.startingCash),
              })}
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditing(true)}
            aria-label={t("paper.portfolios.rename", { name: portfolio.name })}
            title={t("paper.portfolios.rename", { name: portfolio.name })}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            disabled={!canDelete || busy === "delete"}
            aria-label={t("paper.portfolios.deleteBtn", { name: portfolio.name })}
            title={
              canDelete
                ? t("paper.portfolios.deleteBtn", { name: portfolio.name })
                : t("paper.portfolios.deleteBlocked")
            }
            className={cn(!canDelete && "opacity-40 cursor-not-allowed")}
          >
            <Trash2 className="h-3.5 w-3.5 text-danger" />
          </Button>
        </>
      )}
    </li>
  );
}
