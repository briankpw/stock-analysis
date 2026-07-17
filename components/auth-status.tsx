/**
 * Sidebar footer widget: shows a "Sign out" button when the server has
 * `APP_TOKEN` configured and the user has a valid session. Renders
 * nothing when auth isn't required — no visual noise on open installs.
 *
 * The status probe is intentionally cheap (`/api/auth/status`) and is
 * whitelisted by the middleware so it always answers.
 */

"use client";

import * as React from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

type Status = { required: boolean; authenticated: boolean };

export function AuthStatus(): React.ReactElement | null {
  const [status, setStatus] = React.useState<Status | null>(null);
  const [signingOut, setSigningOut] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/status", { credentials: "same-origin" });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as Status;
        if (!cancelled) setStatus(body);
      } catch {
        // Swallow — worst case we don't show the button.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSignOut = React.useCallback(async () => {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch {
      // Even a network failure is OK — the cookie is httpOnly so we
      // can't clear it client-side, but the server-set cookie has a
      // short life and the middleware will redirect on the next load.
    } finally {
      // Full navigation so any in-memory app state (zustand, etc.) is
      // dropped and the login page gets a clean fetch.
      window.location.assign("/login");
    }
  }, []);

  if (!status || !status.required || !status.authenticated) return null;

  return (
    <div className="space-y-1.5">
      <p className="metric-label">Session</p>
      <Button
        variant="outline"
        className="w-full justify-center"
        onClick={onSignOut}
        disabled={signingOut}
      >
        <LogOut className="h-4 w-4" aria-hidden />
        Sign out
      </Button>
    </div>
  );
}
