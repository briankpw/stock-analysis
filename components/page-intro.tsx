"use client";

import * as React from "react";
import { useIsBeginner } from "@/lib/state";
import { pageIntro } from "@/lib/knowledge";

/**
 * Beginner-mode helper block shown at the top of each page. Automatically
 * hides itself in Advanced mode so the UI doesn't feel patronising.
 */
export function PageIntro({ pageKey }: { pageKey: string }) {
  const beginner = useIsBeginner();
  if (!beginner) return null;
  const text = pageIntro(pageKey);
  if (!text) return null;

  // Basic markdown-lite: `**bold**` → <strong>.
  const html = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  return (
    <div className="page-intro animate-slide-up">
      <span className="page-intro-badge">Beginner</span>
      <p className="page-intro-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
