/**
 * PDF proxy for House Clerk PTR filings.
 *
 * Why this exists: the filings page (`app/portfolios/page.tsx`) previews
 * each PTR filing in an <iframe>. Loading the House Clerk URL directly
 * fails in two independent ways:
 *
 *   1. The upstream (`disclosures-clerk.house.gov`) serves the PDF with
 *      `X-Frame-Options` / a restrictive CSP `frame-ancestors`, so no
 *      third-party site can embed it. New-tab navigation works, but
 *      iframe embedding doesn't — which is exactly the symptom the
 *      user reported ("PDF always cannot be view … open new tab was
 *      working well").
 *   2. Our own app's CSP (see `next.config.mjs`) is `default-src 'self'`
 *      with no explicit `frame-src`, so it also blocks embedding a
 *      third-party origin regardless of what the upstream sends.
 *
 * Proxying through our own origin fixes both: the response becomes
 * same-origin so our CSP is satisfied, and we drop the House Clerk's
 * frame-blocking headers on the way through so the browser will let
 * us embed the PDF. `next.config.mjs` overrides the default
 * `X-Frame-Options: DENY` for this specific path so our own iframe
 * can actually load it.
 *
 * Security posture (SSRF is the obvious risk here):
 *
 *   • We NEVER accept an arbitrary URL from the client — we accept a
 *     `year` (4-digit integer in a sane range) and a `docId` (opaque
 *     string matching a tight `[0-9A-Za-z_-]+` pattern) and build the
 *     upstream URL server-side from a hard-coded template. That
 *     restricts the reachable universe to the House Clerk's PTR PDF
 *     tree — nothing else.
 *   • We only forward the response body if the upstream Content-Type
 *     starts with `application/pdf`; if the House Clerk redirects us
 *     to an HTML error page (which they occasionally do for missing
 *     documents), we surface a 404 rather than leaking HTML into an
 *     <iframe> that's expecting a PDF.
 *   • The response is served `inline` so the browser renders in-place
 *     rather than triggering a download, with `nosniff` to keep the
 *     browser from re-guessing the type.
 *   • PTR filings are immutable once published, so we set a long
 *     `Cache-Control` — that way a user flipping between filings gets
 *     the second view instantly instead of re-hitting House Clerk.
 */

import { NextResponse } from "next/server";
import { timedFetch } from "@/lib/http";
import { settings } from "@/lib/config";

// Same URL template as `lib/portfolios.ts`. Duplicated deliberately to
// keep this route's dependency graph tiny — importing the whole
// portfolios module (heavy PDF parser, cache, etc.) into an edge-
// adjacent route handler would inflate cold-start time for a request
// that ultimately just streams bytes.
const HOUSE_CLERK_PTR_PDF = (year: number, docId: string) =>
  `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${year}/${docId}.pdf`;

// The `docId` on House Clerk PTR filings is a short alphanumeric
// string (typically 8 digits or a `YYYYFDNNNN`-style code). We accept
// letters, digits, dashes, and underscores — nothing that could
// influence URL parsing (no `/`, `?`, `#`, `.`, `\`, or spaces). This
// makes SSRF via path traversal impossible: the constructed URL
// always lives under `/public_disc/ptr-pdfs/{year}/`.
const DOC_ID_RE = /^[0-9A-Za-z_-]+$/;

// House Clerk PTR filings only go back to ~2010. Anything outside a
// generous 2000..(current + 1) window is a client bug or a probe;
// reject early so we don't fire a wasted upstream request.
const MIN_YEAR = 2000;
const MAX_YEAR = new Date().getUTCFullYear() + 1;

// PDFs can be a few MB. A 30s timeout matches how the rest of the
// portfolios module fetches these documents.
const FETCH_TIMEOUT_MS = 30_000;

// PTR filings are immutable once uploaded, so hint aggressive caching
// down the pipe. `immutable` tells modern browsers not to even fire a
// conditional revalidation on repeat views.
const CACHE_HEADER = "public, max-age=86400, s-maxage=86400, immutable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const yearRaw = searchParams.get("year");
  const docId = searchParams.get("docId");

  if (!yearRaw || !docId) {
    return NextResponse.json(
      { error: "year and docId query params are required" },
      { status: 400 },
    );
  }
  const year = Number.parseInt(yearRaw, 10);
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    return NextResponse.json(
      { error: `year must be an integer between ${MIN_YEAR} and ${MAX_YEAR}` },
      { status: 400 },
    );
  }
  if (!DOC_ID_RE.test(docId)) {
    return NextResponse.json(
      { error: "docId contains disallowed characters" },
      { status: 400 },
    );
  }

  const upstreamUrl = HOUSE_CLERK_PTR_PDF(year, docId);

  let upstream: Response;
  try {
    upstream = await timedFetch(upstreamUrl, {
      cache: "no-store",
      headers: {
        // House Clerk serves the same content regardless of UA, but a
        // real UA reduces the chance we get treated as a bot on a
        // future rate-limit tune-up on their end.
        "User-Agent": settings.portfolios.secUserAgent,
        "Accept": "application/pdf,*/*;q=0.5",
      },
      timeoutMs: FETCH_TIMEOUT_MS,
      // Follow redirects — House Clerk occasionally redirects between
      // trailing-slash forms. `redirect: "follow"` is the fetch default
      // but stated explicitly for future-proofing.
      redirect: "follow",
    });
  } catch (err) {
    // Timeout, DNS failure, TLS failure, etc. Surface as 504 so the
    // client can distinguish "your request was bad" (400) from
    // "upstream is unhappy" (5xx) and retry accordingly.
    const isTimeout =
      err instanceof Error && err.name === "TimeoutError";
    return NextResponse.json(
      {
        error: isTimeout
          ? "Upstream House Clerk PDF fetch timed out"
          : "Failed to reach the House Clerk PDF server",
      },
      { status: isTimeout ? 504 : 502 },
    );
  }

  if (upstream.status === 404) {
    return NextResponse.json(
      { error: "Filing not found on House Clerk" },
      { status: 404 },
    );
  }
  if (!upstream.ok) {
    return NextResponse.json(
      { error: `House Clerk returned HTTP ${upstream.status}` },
      { status: 502 },
    );
  }

  // Guard against the House Clerk redirecting us to an HTML error page
  // that still returns 200 (they've been known to do this for old /
  // withdrawn filings). Serving HTML through a PDF Content-Type would
  // just render a broken viewer; better to surface an honest 404.
  const upstreamType = upstream.headers.get("content-type") ?? "";
  if (!/^application\/pdf\b/i.test(upstreamType)) {
    return NextResponse.json(
      {
        error:
          "House Clerk returned a non-PDF response (filing may be missing or withdrawn)",
        upstreamContentType: upstreamType,
      },
      { status: 404 },
    );
  }

  // Response headers we control on the way back. `X-Frame-Options`
  // gets overridden to `SAMEORIGIN` in `next.config.mjs` for this
  // path — see the comment there — because same-origin embedding is
  // the whole point of this proxy.
  const headers = new Headers();
  headers.set("Content-Type", "application/pdf");
  // `inline` (not `attachment`) so browsers render in the <iframe>
  // instead of triggering a download. Filename is only a hint used
  // when the user *does* choose to save.
  headers.set(
    "Content-Disposition",
    `inline; filename="ptr-${year}-${docId}.pdf"`,
  );
  headers.set("Cache-Control", CACHE_HEADER);
  headers.set("X-Content-Type-Options", "nosniff");
  // If the upstream advertised a length, forward it — helps the
  // browser's PDF viewer show a progress bar.
  const upstreamLength = upstream.headers.get("content-length");
  if (upstreamLength) headers.set("Content-Length", upstreamLength);

  // Stream the upstream body straight through — no need to buffer
  // the entire PDF in memory when the client can start rendering
  // pages as they arrive.
  return new Response(upstream.body, { status: 200, headers });
}
