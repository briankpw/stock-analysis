/**
 * Bearer-token login screen.
 *
 * Shown when `APP_TOKEN` is set on the server and the browser doesn't
 * yet have a matching `app_token` cookie. The middleware redirects
 * unauthenticated page requests here with `?next=<original path>`; on
 * successful login we redirect back to that path (falling back to `/`
 * when it's missing/relative-unsafe).
 *
 * Also handles the "auth not configured" state gracefully — if the
 * operator hasn't set APP_TOKEN at all, `/api/auth/status` reports
 * `required=false` and we redirect home immediately.
 */

"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

// The parent layout renders a persistent Sidebar next to <main>. On the
// login screen we want a clean full-viewport backdrop, so we cover the
// sidebar with a fixed overlay rather than restructuring the whole
// layout tree with a route group.
const OVERLAY_CLASS =
  "fixed inset-0 z-[60] flex items-center justify-center px-4 bg-background";

// Wrapper enforces a Suspense boundary around `useSearchParams()`, which
// Next.js 15 requires for any client component that reads the URL query
// during rendering. Without it, `next build` refuses to prerender the
// page. The fallback matches the bootstrapping state of the inner form.
export default function LoginPage() {
  return (
    <React.Suspense
      fallback={
        <div className={OVERLAY_CLASS}>
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      }
    >
      <LoginPageInner />
    </React.Suspense>
  );
}

function safeNext(raw: string | null): string {
  if (!raw) return "/";
  // Only accept absolute-path, single-slash starts. Rejects
  // `//evil.example.com` (protocol-relative), full URLs, and any
  // "javascript:" nonsense. Also rejects the login page itself so we
  // don't loop.
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  if (raw.startsWith("/login")) return "/";
  return raw;
}

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = React.useMemo(
    () => safeNext(searchParams.get("next")),
    [searchParams],
  );

  const [token, setToken] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = React.useState(true);

  // If auth isn't required (or we're already signed in), skip the form
  // entirely. Cheap probe, and it fires before we render inputs so the
  // page never flashes.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/status", { credentials: "same-origin" });
        if (!res.ok) return;
        const body = (await res.json()) as { required: boolean; authenticated: boolean };
        if (cancelled) return;
        if (!body.required || body.authenticated) {
          router.replace(next);
          return;
        }
      } catch {
        // Network error — fall through to showing the form.
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [next, router]);

  const onSubmit = React.useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!token.trim()) return;
      setSubmitting(true);
      setError(null);
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ token: token.trim() }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body.error || `Login failed (${res.status})`);
          setSubmitting(false);
          return;
        }
        // Full navigation so any protected server components re-render
        // with the new cookie attached.
        window.location.assign(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setSubmitting(false);
      }
    },
    [next, token],
  );

  if (bootstrapping) {
    return (
      <div className={OVERLAY_CLASS}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  return (
    <div className={OVERLAY_CLASS}>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-3">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <ShieldCheck className="h-6 w-6" aria-hidden />
          </span>
          <CardTitle className="text-base tracking-normal normal-case text-foreground">
            Sign in
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            This dashboard is token-protected. Enter the access token to continue.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="app-token"
                className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
              >
                Access token
              </label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <input
                  id="app-token"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  disabled={submitting}
                  aria-invalid={error ? "true" : undefined}
                  aria-describedby={error ? "app-token-error" : undefined}
                  className={cn(
                    "w-full h-10 rounded-md border border-border bg-card/50 pl-9 pr-3 text-sm",
                    "placeholder:text-muted-foreground",
                    "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background",
                    "disabled:opacity-50",
                    error && "border-danger/60 focus:ring-danger",
                  )}
                  placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
                />
              </div>
              {error && (
                <p id="app-token-error" role="alert" className="text-xs text-danger">
                  {error}
                </p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={submitting || !token.trim()}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {submitting ? "Signing in\u2026" : "Sign in"}
            </Button>
            <p className="text-[0.7rem] text-muted-foreground text-center leading-relaxed">
              The token comes from the <code className="font-mono">APP_TOKEN</code> env var set
              on the server. Ask your operator if you don&apos;t have it.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
