/**
 * SEC EDGAR diagnostic probe.
 *
 * Purpose: when the fund/insider pages are showing "SEC EDGAR is
 * throttling us", the operator needs to distinguish between:
 *
 *   1. Real SEC-side throttle (the container's public IP is on SEC's
 *      naughty list — waiting or changing egress IP fixes it).
 *   2. Bad User-Agent (SEC's newer heuristics flagged our value —
 *      changing `SEC_USER_AGENT` fixes it immediately).
 *   3. Local circuit breaker still open (the app's own defensive
 *      cooldown is still counting down — the fix is time or a manual
 *      reset).
 *   4. Egress firewall (production can't reach `www.sec.gov` at all —
 *      needs infra changes).
 *
 * Reading server logs from a Portainer/Docker deploy is often
 * inconvenient; this endpoint runs the diagnostic from inside the
 * running server and returns a structured JSON summary. Every check
 * respects the local pacer + breaker so calling it can't itself
 * exacerbate an ongoing throttle.
 *
 * Query params:
 *   ?force=1        — before probing, reset the LOCAL circuit breaker so
 *                     an ongoing local cooldown doesn't short-circuit the
 *                     probes. Does NOT affect SEC's own state. Use once
 *                     you suspect SEC has recovered and want to verify.
 *   ?cik=…          — override which CIK to probe (default Berkshire's,
 *                     matching the most-visited preset). Accepts either
 *                     10-digit zero-padded (`0001067983`) or unpadded
 *                     (`1067983`).
 *   ?clear=<kind>:<id>
 *                   — delete the SQLite snapshot for `(kind, id)` so the
 *                     next visit to that preset does a fresh cold fetch
 *                     instead of serving the stale poisoned payload or
 *                     honouring the 15-minute error backoff. Recovery
 *                     tool for the state where SEC has recovered but the
 *                     coordinator hasn't yet triggered a re-fetch. Kind
 *                     is one of `politician` / `person` / `fund`; id is
 *                     the preset id (`berkshire`, `pelosi`, etc.).
 *                     Repeat the param to clear multiple presets.
 *
 * Response shape is intentionally verbose so the operator gets a
 * complete picture without having to open logs. Sensitive values
 * (User-Agent) are echoed back so it's obvious whether the env var
 * is set correctly in production.
 *
 * Inherits auth from `middleware.ts` — if `APP_TOKEN` is set, the
 * probe requires the same token as every other /api/* call.
 */

import { NextResponse } from "next/server";
import { redactError } from "@/lib/http";
import { secHeaders, SEC_BASE } from "@/lib/portfolios";
import {
  getBreakerState,
  resetBreaker,
  secTimedFetch,
} from "@/lib/sec-limiter";
import { deleteSnapshot, type PortfolioSnapshotKind } from "@/lib/portfolios-cache/store";
import { settings } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ProbeStep {
  label: string;
  url: string;
  ok: boolean;
  status: number;
  /** ms wall time for the fetch (excludes pacer queue wait). */
  elapsedMs: number;
  /** Truncated response body preview when non-ok, else null. */
  bodyPreview: string | null;
  /** Non-ok reason string (network / timeout / short-circuited / …). */
  errorReason: string | null;
}

async function probe(url: string, label: string): Promise<ProbeStep> {
  const start = Date.now();
  try {
    const res = await secTimedFetch(url, {
      headers: secHeaders(),
      cache: "no-store",
      timeoutMs: 15_000,
    });
    const elapsedMs = Date.now() - start;
    if (res.ok) {
      return { label, url, ok: true, status: res.status, elapsedMs, bodyPreview: null, errorReason: null };
    }
    // Preview the first 500 chars — enough to distinguish "SEC 429
    // rate-limit page" from "local breaker short-circuit" from
    // "generic Cloudflare block".
    let preview: string | null = null;
    try {
      const text = await res.text();
      preview = text.slice(0, 500);
    } catch {
      preview = "<unreadable>";
    }
    return {
      label,
      url,
      ok: false,
      status: res.status,
      elapsedMs,
      bodyPreview: preview,
      errorReason: res.statusText || `HTTP ${res.status}`,
    };
  } catch (err) {
    const elapsedMs = Date.now() - start;
    return {
      label,
      url,
      ok: false,
      status: 0,
      elapsedMs,
      bodyPreview: null,
      errorReason: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    const rawCik = (url.searchParams.get("cik") ?? "1067983").trim();
    // Accept both "0001067983" and "1067983"; SEC APIs expect a 10-digit
    // zero-padded form for `data.sec.gov/submissions/CIK…` and an
    // unpadded form for `www.sec.gov/Archives/edgar/data/…`.
    if (!/^\d{1,10}$/.test(rawCik)) {
      return NextResponse.json({ error: "invalid cik" }, { status: 400 });
    }
    const cikPadded = rawCik.padStart(10, "0");
    const cikNoZeros = String(Number(cikPadded));

    if (force) {
      resetBreaker();
    }

    // Optional snapshot deletion. Accepts repeated `?clear=fund:berkshire`
    // params (Next.js `getAll` returns them as an array). We validate
    // each pair independently so a typo on one doesn't sink the rest.
    const cleared: Array<{ kind: string; id: string; ok: boolean; reason?: string }> = [];
    const clearParams = url.searchParams.getAll("clear");
    for (const raw of clearParams) {
      const [kindRaw, idRaw] = raw.split(":", 2);
      if (!kindRaw || !idRaw) {
        cleared.push({ kind: kindRaw ?? "", id: idRaw ?? "", ok: false, reason: "expected `kind:id` format" });
        continue;
      }
      const kind = kindRaw as PortfolioSnapshotKind;
      if (kind !== "politician" && kind !== "person" && kind !== "fund") {
        cleared.push({ kind, id: idRaw, ok: false, reason: "unknown kind" });
        continue;
      }
      if (!/^[A-Za-z0-9_-]{1,48}$/.test(idRaw)) {
        cleared.push({ kind, id: idRaw, ok: false, reason: "invalid id" });
        continue;
      }
      try {
        deleteSnapshot(kind, idRaw);
        cleared.push({ kind, id: idRaw, ok: true });
      } catch (err) {
        cleared.push({
          kind,
          id: idRaw,
          ok: false,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Redact anything after the space in the User-Agent so the
    // response doesn't leak the operator's contact email to whoever
    // ends up with this JSON — but keep the "shape" visible so they
    // can verify the env var is set to something sensible.
    const uaFull = settings.portfolios.secUserAgent;
    const uaRedacted = uaFull.replace(/([^\s@]+)@([^\s@]+)/g, "***@$2");

    // Probe three canonical SEC endpoints, in order of increasing
    // strictness. `data.sec.gov` is the JSON API (loose throttling);
    // `www.sec.gov/Archives/…` is the file server (strict throttling,
    // where 429s usually first appear).
    const steps: ProbeStep[] = [];
    steps.push(
      await probe(
        `${SEC_BASE}/submissions/CIK${cikPadded}.json`,
        "SEC submissions API (data.sec.gov)",
      ),
    );
    // The CIK-level archive directory (`/Archives/edgar/data/<cik>/`)
    // always exists for a valid CIK and returns an HTML listing of
    // every accession that CIK has filed. It's the cheapest stable
    // way to probe the `www.sec.gov` archive path (which is the
    // endpoint that first starts returning 429 under SEC's stricter
    // rate-limit on filings, distinct from `data.sec.gov`'s looser
    // JSON API limits).
    steps.push(
      await probe(
        `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cikNoZeros}&type=13F-HR&dateb=&owner=include&count=1&output=atom`,
        "SEC EDGAR filings feed (www.sec.gov)",
      ),
    );
    steps.push(
      await probe(
        `https://www.sec.gov/files/company_tickers.json`,
        "SEC tickers file (www.sec.gov)",
      ),
    );

    const anyBlocked = steps.some((s) => s.status === 429 || s.status === 403);
    const allOk = steps.every((s) => s.ok);

    // Actionable summary tailored to the observed status pattern.
    // Ordered from most-common to least-common so the first hit is
    // usually the right diagnosis.
    let diagnosis = "";
    if (allOk) {
      diagnosis =
        "All SEC endpoints reachable from this container. If fund pages are still showing errors, the local circuit breaker may still be open (check `breaker.open`) — pass `?force=1` to reset it.";
    } else if (getBreakerState().open) {
      diagnosis =
        "Local circuit breaker is open, so all probes short-circuited without reaching SEC. Pass `?force=1` to reset it and re-probe — if SEC has cooled down, all steps should return 200.";
    } else if (steps.every((s) => s.status === 429)) {
      diagnosis =
        "Every SEC endpoint returned 429 — SEC is rate-limiting this egress IP. Common causes: (1) burst from the bot worker exceeded SEC's 10 req/s cap earlier and the throttle window hasn't cleared yet; (2) shared cloud NAT with a noisy neighbour also hammering SEC. Wait 15-30 minutes and re-probe. If it persists >1h, consider a dedicated egress IP.";
    } else if (steps.some((s) => s.status === 403)) {
      diagnosis =
        "One or more endpoints returned 403 — SEC rejected the User-Agent. Verify `SEC_USER_AGENT` env var contains BOTH a name AND a real contact email (e.g. `Brian's Stock Dashboard brian@yourdomain.com`). Bot-like or generic values get 403'd.";
    } else if (steps.some((s) => s.status === 0)) {
      diagnosis =
        "One or more probes failed to reach SEC at all (status 0 — network / DNS / firewall). Verify outbound HTTPS to `data.sec.gov` and `www.sec.gov` is allowed from this container.";
    } else {
      diagnosis =
        "Mixed results — see individual steps below. Most common mixed pattern: submissions API OK (data.sec.gov has looser limits) but archive throttled (www.sec.gov is stricter).";
    }

    return NextResponse.json({
      probedAt: new Date().toISOString(),
      cik: cikPadded,
      userAgent: {
        raw: uaRedacted,
        looksPlaceholder: /example\.com/i.test(uaFull),
        hasName:
          uaFull.split(" ").length > 1 &&
          /^[A-Za-z]/.test(uaFull.trim().split(" ")[0] ?? ""),
        hasEmail: /@[^\s]+\.[^\s]+/.test(uaFull),
      },
      breaker: getBreakerState(),
      forceReset: force,
      cleared,
      steps,
      anyBlocked,
      allOk,
      diagnosis,
    });
  } catch (e) {
    const r = redactError(e, 500, "Probe failed");
    return NextResponse.json({ error: r.message }, { status: r.status });
  }
}
