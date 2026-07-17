/**
 * Sign-in screen.
 *
 * Shown when the server has auth configured (via APP_TOKEN or
 * APP_USERNAME + APP_PASSWORD) and the browser doesn't yet have a
 * matching `app_token` cookie. Renders one of two forms based on the
 * server-reported mode:
 *
 *   * "credentials": username + password (APP_USERNAME/APP_PASSWORD)
 *   * "token":       single-field token   (APP_TOKEN)
 *
 * Middleware redirects unauthenticated page requests here with
 * `?next=<original path>`; on success we redirect back to that path
 * (falling back to `/` when it's missing or unsafe).
 *
 * When no auth is configured (`required=false`) or the user's cookie
 * is still valid (`authenticated=true`), we redirect home immediately
 * so an operator turning off APP_TOKEN doesn't strand users on /login.
 */

"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Lock, ShieldCheck, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type AuthMode = "none" | "token" | "credentials";
type StatusResponse = { required: boolean; authenticated: boolean; mode: AuthMode };

const OVERLAY_CLASS =
  "fixed inset-0 z-[60] flex items-center justify-center px-4 bg-background";

const INPUT_CLASS = cn(
  "w-full h-10 rounded-md border border-border bg-card/50 pl-9 pr-3 text-sm",
  "placeholder:text-muted-foreground",
  "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background",
  "disabled:opacity-50",
);

// Suspense wrapper — `useSearchParams()` in Next.js 15 refuses to
// prerender without one. Fallback matches the bootstrapping state.
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
  // `//evil.example.com` (protocol-relative), full URLs, and
  // `javascript:`. Also rejects the login page itself so we don't
  // create a redirect loop after successful sign-in.
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

  const [mode, setMode] = React.useState<AuthMode | null>(null);
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [token, setToken] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = React.useState(true);

  // Probe status once on mount: skip the form entirely when auth isn't
  // required or the visitor is already signed in. Also determines which
  // form (credentials vs token) to render.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/status", { credentials: "same-origin" });
        if (!res.ok) return;
        const body = (await res.json()) as StatusResponse;
        if (cancelled) return;
        if (!body.required || body.authenticated) {
          router.replace(next);
          return;
        }
        setMode(body.mode);
      } catch {
        // Network error — fall through to the form with a permissive
        // default (credentials) so the user has something to try.
        if (!cancelled) setMode("credentials");
      } finally {
        if (!cancelled) setBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [next, router]);

  const canSubmit =
    mode === "credentials"
      ? username.trim().length > 0 && password.length > 0
      : mode === "token"
        ? token.trim().length > 0
        : false;

  const onSubmit = React.useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!canSubmit || !mode) return;
      setSubmitting(true);
      setError(null);
      try {
        const payload =
          mode === "credentials"
            ? { username: username.trim(), password }
            : { token: token.trim() };
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body.error || `Sign-in failed (${res.status})`);
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
    [canSubmit, mode, next, password, token, username],
  );

  if (bootstrapping || !mode) {
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
            {mode === "credentials"
              ? "Enter your username and password to continue."
              : "This dashboard is token-protected. Enter the access token to continue."}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            {mode === "credentials" ? (
              <>
                <FieldWithIcon
                  id="app-username"
                  label="Username"
                  icon={<User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />}
                  input={
                    <input
                      id="app-username"
                      type="text"
                      autoComplete="username"
                      autoFocus
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={submitting}
                      aria-invalid={error ? "true" : undefined}
                      className={cn(INPUT_CLASS, error && "border-danger/60 focus:ring-danger")}
                    />
                  }
                />
                <FieldWithIcon
                  id="app-password"
                  label="Password"
                  icon={<Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />}
                  input={
                    <input
                      id="app-password"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={submitting}
                      aria-invalid={error ? "true" : undefined}
                      aria-describedby={error ? "app-auth-error" : undefined}
                      className={cn(INPUT_CLASS, error && "border-danger/60 focus:ring-danger")}
                      placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
                    />
                  }
                />
              </>
            ) : (
              <FieldWithIcon
                id="app-token"
                label="Access token"
                icon={<Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />}
                input={
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
                    aria-describedby={error ? "app-auth-error" : undefined}
                    className={cn(INPUT_CLASS, error && "border-danger/60 focus:ring-danger")}
                    placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
                  />
                }
              />
            )}
            {error && (
              <p id="app-auth-error" role="alert" className="text-xs text-danger">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={submitting || !canSubmit}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {submitting ? "Signing in\u2026" : "Sign in"}
            </Button>
            <p className="text-[0.7rem] text-muted-foreground text-center leading-relaxed">
              {mode === "credentials" ? (
                <>
                  Credentials come from the{" "}
                  <code className="font-mono">APP_USERNAME</code> /{" "}
                  <code className="font-mono">APP_PASSWORD</code> env vars on the server.
                </>
              ) : (
                <>
                  The token comes from the <code className="font-mono">APP_TOKEN</code>{" "}
                  env var on the server.
                </>
              )}
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function FieldWithIcon({
  id,
  label,
  icon,
  input,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  input: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="text-xs font-medium text-muted-foreground uppercase tracking-wider"
      >
        {label}
      </label>
      <div className="relative">
        {icon}
        {input}
      </div>
    </div>
  );
}
