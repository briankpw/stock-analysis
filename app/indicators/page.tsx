import { redirect } from "next/navigation";

/**
 * Legacy route stub — the indicators cards were merged into `/charts`
 * (renamed "Charts & Indicators"). We keep this file so external
 * bookmarks and the router's back-stack still resolve; server-side
 * redirects are cheaper than a client-mounted "Loading…" screen.
 */
export default function IndicatorsRedirect(): never {
  redirect("/charts");
}
