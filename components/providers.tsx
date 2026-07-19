"use client";

import * as React from "react";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@radix-ui/react-tooltip";

/**
 * Client-only provider tree. Kept in its own file so `app/layout.tsx` can
 * stay a Server Component (which is required for setting `metadata` /
 * `<html lang>` etc.).
 *
 * `nonce` is the CSP nonce middleware minted for this response. We
 * forward it to `next-themes` so its inline FOUC-guard `<script>`
 * carries the nonce attribute — required now that the production CSP
 * uses `'strict-dynamic'` and no longer trusts `'unsafe-inline'`.
 * Empty string is safe: the theme script becomes non-nonced, which
 * matches the pre-strict-dynamic behaviour on legacy browsers.
 */
export function Providers({
  children,
  nonce,
}: {
  children: React.ReactNode;
  nonce?: string;
}) {
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
      nonce={nonce}
    >
      <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
    </ThemeProvider>
  );
}
