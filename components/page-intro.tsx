"use client";

import * as React from "react";
import { useIsBeginner, useLocale } from "@/lib/state";
import { pageIntro } from "@/lib/knowledge";
import { useT } from "@/lib/i18n";
import { renderMiniMarkdown } from "@/lib/utils";

/**
 * Beginner-mode helper block shown at the top of each page. Automatically
 * hides itself in Advanced mode so the UI doesn't feel patronising, and
 * follows the current UI locale.
 */
export function PageIntro({ pageKey }: { pageKey: string }) {
  const beginner = useIsBeginner();
  const locale = useLocale();
  const t = useT();
  if (!beginner) return null;
  const text = pageIntro(pageKey, locale);
  if (!text) return null;

  // Escape HTML first, then apply the `**bold**` transform — otherwise
  // any future interpolation into pageIntro strings could inject tags
  // into the innerHTML sink below.
  const html = renderMiniMarkdown(text);

  return (
    <div className="page-intro animate-slide-up">
      <span className="page-intro-badge">{t("beginner.badge")}</span>
      <p className="page-intro-body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
