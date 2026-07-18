"use client";

/**
 * PortfolioUploader — the "bring your own CSV" import UI.
 *
 * Flow:
 *   1. User picks or drops a `.csv` file exported from their broker /
 *      portfolio tracker (MSP format tested; header aliases in
 *      `portfolio-import.ts` accept close variants).
 *   2. We read the file in the browser via `FileReader.readAsText` and
 *      parse it with `parseHoldingsCsv`. No bytes leave the device.
 *   3. A preview panel summarises what was found (row counts, unique
 *      portfolios / symbols, date range) and lists any per-row errors.
 *      When the store already has rows, we also compute a diff and show
 *      how many rows are new vs already stored.
 *   4. The user picks between:
 *      • **Merge** — add-only. Rows whose fingerprint is already in the
 *        store are silently skipped, so a monthly re-export just
 *        appends the new trades. This is the default action once the
 *        store has data.
 *      • **Replace all** — wipe existing rows and use the CSV as the
 *        sole source of truth. Confirmed via `window.confirm` to
 *        prevent accidental data loss.
 *
 *   Nothing hits the persisted store until the user explicitly picks
 *   an action — mis-selecting a file never destroys existing data.
 */

import * as React from "react";
import {
  FileUp, FileWarning, CheckCircle2, X, Upload,
  Plus, Repeat, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useHoldings } from "@/lib/holdings-state";
import {
  parseHoldingsCsv,
  diffHoldings,
  type HoldingsParseResult,
  type HoldingsDiff,
} from "@/lib/portfolio-import";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Preview {
  filename: string;
  filesize: number;
  parsed: HoldingsParseResult;
  /**
   * Diff against the currently-persisted rows. Computed eagerly on file
   * parse so the preview panel can show "X new / Y already stored"
   * without waiting on a second pass.
   */
  diff: HoldingsDiff;
  /** Snapshot of the previously-stored row count at parse time. */
  existingCount: number;
}

/**
 * Read a browser `File` as text. Wrapped in a Promise so the caller
 * can `await` it inside an async handler. Rejects on the `error` event
 * so callers see a real Error rather than a mysterious "readyState 2".
 */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.readAsText(file);
  });
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function PortfolioUploader() {
  const t = useT();
  const setHoldings = useHoldings((s) => s.setHoldings);
  const mergeHoldings = useHoldings((s) => s.mergeHoldings);
  const existingRows = useHoldings((s) => s.rows);

  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const [readError, setReadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Read the current store rows via a ref so `handleFile` doesn't need
  // to close over a possibly-stale snapshot. This matters if a user
  // saves, then immediately picks another file without unmounting the
  // component — we want to diff against the *just-saved* state.
  const existingRowsRef = React.useRef(existingRows);
  existingRowsRef.current = existingRows;

  const handleFile = React.useCallback(async (file: File) => {
    setReadError(null);
    setBusy(true);
    try {
      // Guardrails: CSV is text, and even the largest self-hosted
      // portfolios don't cross a couple of MB. Reject obvious mistakes
      // (dropped a video, PDF, etc.) early with a clear message.
      if (file.size > 25 * 1024 * 1024) {
        throw new Error(t("myPortfolio.upload.tooLarge"));
      }
      const text = await readFileAsText(file);
      const parsed = parseHoldingsCsv(text);
      const diff = diffHoldings(existingRowsRef.current, parsed.rows);
      setPreview({
        filename: file.name,
        filesize: file.size,
        parsed,
        diff,
        existingCount: existingRowsRef.current.length,
      });
    } catch (e) {
      setPreview(null);
      setReadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const onInputChange = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (file) void handleFile(file);
    // Reset the input so re-picking the same file re-triggers `onChange`.
    ev.target.value = "";
  };

  const onDrop = (ev: React.DragEvent) => {
    ev.preventDefault();
    setIsDragging(false);
    const file = ev.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const onMerge = () => {
    if (!preview) return;
    mergeHoldings(preview.parsed.rows, {
      sourceFilename: preview.filename,
      importedAt: new Date().toISOString(),
    });
    setPreview(null);
  };

  const onReplace = () => {
    if (!preview) return;
    // If the user has existing data, replacing is destructive — make them
    // acknowledge it. First-time imports skip the confirm because there's
    // nothing to lose.
    if (existingRowsRef.current.length > 0) {
      if (!window.confirm(t("myPortfolio.upload.confirmReplace"))) return;
    }
    setHoldings(preview.parsed.rows, {
      sourceFilename: preview.filename,
      importedAt: new Date().toISOString(),
      rowCount: preview.parsed.rows.length,
    });
    setPreview(null);
  };

  const onCancelPreview = () => setPreview(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileUp className="h-5 w-5 text-primary" />
          {t("myPortfolio.upload.title")}
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
          {t("myPortfolio.upload.subtitle")}
        </p>
      </CardHeader>
      <CardContent>
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          className={cn(
            "relative rounded-xl border-2 border-dashed p-6 sm:p-8 text-center transition-colors",
            isDragging
              ? "border-primary bg-primary/5"
              : "border-border bg-muted/20 hover:border-primary/50",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv,application/vnd.ms-excel"
            onChange={onInputChange}
            className="sr-only"
            aria-label={t("myPortfolio.upload.pickLabel")}
          />
          <div className="flex flex-col items-center gap-3">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Upload className="h-6 w-6" />
            </span>
            <div>
              <p className="text-sm font-semibold">
                {t("myPortfolio.upload.dropHere")}
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                {t("myPortfolio.upload.helper")}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              {busy ? t("myPortfolio.upload.reading") : t("myPortfolio.upload.pickButton")}
            </Button>
          </div>
        </div>

        {readError && (
          <div className="mt-4 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            <div className="flex items-center gap-2 font-medium">
              <FileWarning className="h-4 w-4" />
              {t("myPortfolio.upload.readErrorTitle")}
            </div>
            <p className="mt-1 text-xs opacity-90">{readError}</p>
          </div>
        )}

        {preview && (
          <PreviewPanel
            preview={preview}
            onMerge={onMerge}
            onReplace={onReplace}
            onCancel={onCancelPreview}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Preview panel — shown once a file is parsed, before persisting.
// ---------------------------------------------------------------------------

function StatChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "add" | "skip";
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 min-w-0",
        tone === "add"
          ? "border-success/40 bg-success/5"
          : tone === "skip"
            ? "border-warning/40 bg-warning/5"
            : "border-border bg-card/60",
      )}
    >
      <p
        className={cn(
          "text-[0.6rem] uppercase tracking-wider",
          tone === "add"
            ? "text-success"
            : tone === "skip"
              ? "text-warning"
              : "text-muted-foreground",
        )}
      >
        {label}
      </p>
      <p className="text-sm font-semibold tabular-nums mt-0.5 truncate">
        {value}
      </p>
    </div>
  );
}

function PreviewPanel({
  preview,
  onMerge,
  onReplace,
  onCancel,
}: {
  preview: Preview;
  onMerge: () => void;
  onReplace: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const { parsed, filename, filesize, diff, existingCount } = preview;
  const empty = parsed.rows.length === 0;
  const nothingNew = diff.newRows.length === 0 && !empty;
  const hasExisting = existingCount > 0;

  return (
    <div className="mt-5 rounded-xl border border-border bg-card/40">
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-border/60">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("myPortfolio.upload.previewTitle")}
          </p>
          <p className="text-sm font-semibold truncate" title={filename}>
            {filename}
          </p>
          <p className="text-[0.65rem] text-muted-foreground">
            {fmtBytes(filesize)}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onCancel} aria-label={t("common.cancel")}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-4 space-y-4">
        {/* Diff banner: highest-signal info goes at the top so users who
            re-import monthly instantly see "X new, Y already stored".
            Only shown when the store already has rows — first-time
            imports get the flat overview instead. */}
        {hasExisting && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatChip
              label={t("myPortfolio.preview.alreadyStored")}
              value={existingCount}
            />
            <StatChip
              label={t("myPortfolio.preview.inFile")}
              value={parsed.rows.length}
            />
            <StatChip
              label={t("myPortfolio.preview.newRows")}
              value={diff.newRows.length}
              tone="add"
            />
            <StatChip
              label={t("myPortfolio.preview.duplicateRows")}
              value={diff.duplicateRows.length}
              tone="skip"
            />
          </div>
        )}

        {hasExisting && nothingNew && (
          <div className="rounded-md border border-border bg-muted/30 p-3 flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <p>{t("myPortfolio.preview.upToDate")}</p>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <StatChip label={t("myPortfolio.preview.total")} value={parsed.totalRows} />
          <StatChip label={t("myPortfolio.preview.buys")} value={parsed.buyCount} />
          <StatChip label={t("myPortfolio.preview.sells")} value={parsed.sellCount} />
          <StatChip label={t("myPortfolio.preview.watches")} value={parsed.watchCount} />
          <StatChip label={t("myPortfolio.preview.portfolios")} value={parsed.portfolios.length} />
          <StatChip label={t("myPortfolio.preview.symbols")} value={parsed.symbols.length} />
        </div>

        {parsed.earliestDate && parsed.latestDate && (
          <p className="text-xs text-muted-foreground">
            {t("myPortfolio.preview.dateRange", {
              from: parsed.earliestDate,
              to: parsed.latestDate,
            })}
          </p>
        )}

        {parsed.portfolios.length > 0 && (
          <div>
            <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground mb-1.5">
              {t("myPortfolio.preview.portfoliosLabel")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {parsed.portfolios.map((p) => (
                <span key={p} className="chip chip-neu text-[0.65rem]">
                  {p}
                </span>
              ))}
            </div>
          </div>
        )}

        {parsed.symbols.length > 0 && (
          <div>
            <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground mb-1.5">
              {t("myPortfolio.preview.symbolsLabel")}
            </p>
            <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
              {parsed.symbols.map((s) => (
                <span
                  key={s}
                  className="inline-flex items-center rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[0.65rem] font-mono tabular-nums"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {parsed.errors.length > 0 && (
          <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
            <div className="flex items-center gap-2 text-warning font-medium text-sm">
              <FileWarning className="h-4 w-4" />
              {t("myPortfolio.preview.warningsTitle", { n: parsed.errors.length })}
            </div>
            <ul className="mt-1.5 space-y-0.5 text-xs text-warning/90 max-h-32 overflow-y-auto">
              {parsed.errors.slice(0, 20).map((err, i) => (
                <li key={i}>
                  {t("myPortfolio.preview.warningLine", {
                    line: err.line,
                    message: err.message,
                  })}
                </li>
              ))}
              {parsed.errors.length > 20 && (
                <li className="opacity-70">
                  {t("myPortfolio.preview.warningMore", {
                    n: parsed.errors.length - 20,
                  })}
                </li>
              )}
            </ul>
          </div>
        )}

        {/* Actions.
            • First-time import: only "Save" — merge and replace are
              semantically identical when the store is empty.
            • Subsequent imports: primary action is "Merge (add N new)".
              "Replace all" is offered as a secondary outline button
              behind a confirm dialog for full-refresh workflows. */}
        <div className="flex items-center justify-end gap-2 pt-1 flex-wrap">
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          {!hasExisting ? (
            <Button onClick={onReplace} disabled={empty}>
              <CheckCircle2 className="h-4 w-4" />
              {t("myPortfolio.upload.saveButton")}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={onReplace}
                disabled={empty}
                title={t("myPortfolio.upload.replaceHint")}
              >
                <Repeat className="h-4 w-4" />
                {t("myPortfolio.upload.replaceButton")}
              </Button>
              <Button
                onClick={onMerge}
                disabled={empty || diff.newRows.length === 0}
                title={t("myPortfolio.upload.mergeHint")}
              >
                <Plus className="h-4 w-4" />
                {t("myPortfolio.upload.mergeButton", { n: diff.newRows.length })}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
