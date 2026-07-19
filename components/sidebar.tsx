"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3, LineChart, Newspaper, Wallet, Bot,
  Home, ChartBar, Menu, X, Users, Briefcase, Gauge, ChevronDown, Settings,
  Layers, Target, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { LevelToggle } from "./level-toggle";
import { LocaleToggle } from "./locale-toggle";
import { ModeToggle } from "./mode-toggle";
import { TickerPicker } from "./ticker-picker";
import { PortfoliosRail } from "./portfolios-rail";
import { AuthStatus } from "./auth-status";
import { useUi } from "@/lib/state";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Pages that operate on the currently selected ticker. The `labelKey`
 * points into the i18n dictionary so the sidebar re-labels when the
 * user flips the language toggle.
 *
 * User-owned surfaces (My Portfolio, Paper Trading, Alert Bot) used
 * to live at the bottom of this list because they were "your stuff
 * about *this* ticker". That framing broke down once each of them
 * grew into a full page with its own persistent state — so they now
 * live in `PERSONAL_NAV` below, and this list stays true to its
 * name: everything here is a lens on the currently-selected ticker.
 */
const TICKER_NAV = [
  { href: "/overview",     labelKey: "nav.overview",    icon: Home },
  { href: "/ratios",       labelKey: "nav.ratios",      icon: BarChart3 },
  { href: "/charts",       labelKey: "nav.charts",      icon: LineChart },
  { href: "/signal",       labelKey: "nav.signal",      icon: Target },
  { href: "/news",         labelKey: "nav.news",        icon: Newspaper },
  { href: "/holders",      labelKey: "nav.holders",     icon: Users },
  { href: "/raw",          labelKey: "nav.raw",         icon: ChartBar },
] as const;

/**
 * User-owned surfaces. Each one operates on data the user has
 * imported, simulated, or subscribed to — none of them are locked to
 * the sidebar's active ticker. Grouped together so the "your stuff"
 * cluster reads at a glance and doesn't confuse newcomers into
 * thinking Alert Bot is "alerts *about the current ticker only*".
 */
const PERSONAL_NAV = [
  { href: "/my-portfolio", labelKey: "nav.myPortfolio", icon: Briefcase },
  { href: "/paper",        labelKey: "nav.paper",       icon: Wallet },
  { href: "/bot",          labelKey: "nav.bot",         icon: Bot },
] as const;

/**
 * Market-wide (not ticker-scoped) pages. Broadcasts like CNN's Fear & Greed
 * gauge live here — they colour every ticker's read but don't depend on
 * which one is selected.
 *
 * All entries render at the same visual level (no indentation). The
 * `matchPrefix` flag decides how the "active" highlight is computed:
 *
 *   • false (default) — pathname must equal `href` exactly. Used for the
 *     top-level `/market` page so it doesn't stay lit while the user is
 *     browsing `/market/segments`.
 *   • true — pathname equals `href` OR is a nested child (e.g.
 *     `/market/segments/AI`). Used for section landing pages that own a
 *     tree of detail routes.
 */
const MARKET_NAV = [
  { href: "/market",          labelKey: "nav.market",   icon: Gauge,  matchPrefix: false },
  { href: "/market/segments", labelKey: "nav.segments", icon: Layers, matchPrefix: true  },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  // Preferences (view / theme / experience / language) live in the sidebar
  // footer. They start collapsed on every breakpoint so the nav column
  // reads cleanly on load; users open the panel with the disclosure
  // button below when they want to tweak a setting.
  const [prefsOpen, setPrefsOpen] = React.useState(false);
  // Desktop-only collapse. Persisted so the choice survives reloads.
  // Below `lg:` this flag is ignored — mobile always uses the drawer
  // + hamburger interaction.
  const desktopCollapsed = useUi((s) => s.sidebarDesktopCollapsed);
  const toggleDesktopCollapsed = useUi((s) => s.toggleSidebarDesktopCollapsed);
  const t = useT();

  // Auto-close on route change (mobile). Navigating away from the drawer
  // is unambiguous intent; we don't need to distinguish sources here.
  React.useEffect(() => setMobileOpen(false), [pathname]);

  // NOTE: We deliberately do NOT auto-close on `useTicker()` changes.
  // Doing so races against passive ticker mutations — Zustand persist
  // rehydration and the TickerPicker's "snap to first watchlist entry
  // when the persisted symbol vanished" effect both fire asynchronously
  // and can slam a freshly-opened drawer shut mid-tap. Instead, we hand
  // the picker an explicit `onSelectTicker` callback so it only closes
  // the drawer when the change came from a user click inside the picker.
  const closeMobile = React.useCallback(() => setMobileOpen(false), []);

  const isPortfolioMode =
    pathname === "/portfolios" || pathname.startsWith("/portfolios/");

  return (
    <>
      {/* Mobile top bar (logo only). The hamburger has been pulled OUT
          of this bar into its own `position: fixed` button below so it
          can never be masked by a parent's `overflow`, `transform`, or
          stacking context — a class of intermittent "the menu doesn't
          open" bugs that are essentially impossible to diagnose from
          static CSS review alone. */}
      <div
        className="lg:hidden sticky top-0 z-30 flex items-center h-14 border-b border-border bg-background/80 backdrop-blur-md"
        style={{
          // Extend the bar into the iOS notch/status-bar area without
          // pushing the logo under it.
          paddingTop: "env(safe-area-inset-top)",
          paddingLeft: "max(1rem, env(safe-area-inset-left))",
          // Reserve space on the right for the fixed hamburger so the
          // logo can't visually collide with it on narrow devices.
          paddingRight: "calc(max(1rem, env(safe-area-inset-right)) + 3rem)",
          height: "calc(3.5rem + env(safe-area-inset-top))",
        }}
      >
        <Link href="/overview" className="flex items-center gap-2 font-semibold min-w-0">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary/20 text-primary shrink-0">
            <BarChart3 className="h-4 w-4" />
          </span>
          <span className="truncate">{t("brand.name")}</span>
        </Link>
      </div>

      {/*
        Hamburger — free-floating, `position: fixed`, `z-50`.
          * z-50 puts it ABOVE the aside (z-40) and the scrim (z-20), so
            the same button toggles both "open" and "close" and is
            always reachable — even when the drawer covers the top bar.
          * Sized 44×44 to meet WCAG 2.5.5 (minimum tap target).
          * `touchAction: manipulation` disables the browser's 300 ms
            double-tap-to-zoom delay on mobile Safari, so the first tap
            fires the click without a perceptible lag.
          * Fixed positioning is deliberately outside the sticky top
            bar's stacking context — no parent `overflow`, `transform`,
            filter, or contain: paint can trap the click.
        `lg:hidden` collapses it on desktop where the persistent sidebar
        makes the hamburger meaningless.
      */}
      <button
        type="button"
        onClick={() => setMobileOpen((v) => !v)}
        aria-label={t("sidebar.toggleMenu")}
        aria-expanded={mobileOpen}
        aria-controls="app-sidebar"
        data-mobile-open={mobileOpen}
        className="lg:hidden fixed z-50 inline-flex h-11 w-11 items-center justify-center rounded-md bg-background/80 backdrop-blur-md text-foreground border border-border/60 shadow-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-colors"
        style={{
          top: "max(0.5rem, env(safe-area-inset-top))",
          right: "max(0.5rem, env(safe-area-inset-right))",
          touchAction: "manipulation",
        }}
      >
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/*
        Desktop-only floating "expand sidebar" button — rendered ONLY when
        the persistent sidebar has been collapsed. Fixed to the top-left
        of the viewport (mirror image of the mobile hamburger on the
        right) so the exit path is always in the same spot as the entry.
        Hidden below `lg:` because the mobile drawer already has its own
        hamburger.
      */}
      {desktopCollapsed && (
        <button
          type="button"
          onClick={toggleDesktopCollapsed}
          aria-label={t("sidebar.expandSidebar")}
          aria-expanded={false}
          aria-controls="app-sidebar"
          className="hidden lg:inline-flex fixed z-50 top-4 left-4 h-10 w-10 items-center justify-center rounded-md bg-background/80 backdrop-blur-md text-foreground border border-border/60 shadow-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-colors"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      )}

      {/* Sidebar */}
      <aside
        id="app-sidebar"
        className={cn(
          // Explicit `left-0` on the fixed drawer — never rely on
          // `left: auto` computing to the static position, which some
          // mobile WebViews (WKWebView in particular) resolve
          // inconsistently once a `transform` is also on the element.
          "fixed left-0 lg:sticky top-0 z-40 lg:z-10 h-[100dvh] lg:h-screen w-72 max-w-[85vw] lg:max-w-none",
          "bg-background/95 lg:bg-background/60 backdrop-blur-xl border-r border-border",
          "flex flex-col transition-transform",
          // Single, unambiguous translate class per state — computed
          // outside the `cn()` to avoid stacking conflicting Tailwind
          // utilities (`translate-x-0` vs `-translate-x-full`) whose
          // final winner depends on utility ordering in the generated
          // CSS, not on `cn()`'s argument order.
          //
          //   mobileOpen                 → drawer visible at all sizes
          //   !mobileOpen && !collapsed  → mobile hidden, desktop visible
          //   !mobileOpen &&  collapsed  → hidden at all sizes
          mobileOpen
            ? "translate-x-0"
            : desktopCollapsed
              ? "-translate-x-full"
              : "-translate-x-full lg:translate-x-0",
          // Guard against accidental focus / hover on off-screen nav
          // links when the desktop drawer is tucked away. Also
          // signalled to assistive tech via `aria-hidden` below.
          desktopCollapsed && "lg:pointer-events-none",
        )}
        style={{
          // On mobile the drawer covers the whole viewport height incl.
          // the status bar and home-indicator; pad content in from both
          // ends so it stays legible.
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
        aria-label={t("sidebar.primaryNav")}
        aria-hidden={desktopCollapsed && !mobileOpen ? "true" : undefined}
      >
        <div className="hidden lg:flex px-5 pt-6 pb-4 items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 text-primary">
            <BarChart3 className="h-4 w-4" />
          </span>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-semibold leading-tight truncate">{t("brand.name")}</span>
            <span className="text-[0.7rem] uppercase tracking-wider text-muted-foreground leading-tight truncate">
              {t("brand.subtitle")}
            </span>
          </div>
          {/* Desktop-only collapse button. Tucked into the brand row so
              it's discoverable without adding a fourth toolbar surface.
              On mobile the button is `hidden` — the drawer already has
              the hamburger + scrim as its dismissal affordances. */}
          <button
            type="button"
            onClick={toggleDesktopCollapsed}
            aria-label={t("sidebar.collapseSidebar")}
            aria-expanded={!desktopCollapsed}
            aria-controls="app-sidebar"
            className="hidden lg:inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors shrink-0"
            title={t("sidebar.collapseSidebar")}
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>

        {/* Ticker picker only makes sense when in Stock mode. */}
        {!isPortfolioMode && (
          <div className="px-5 py-4 space-y-4 border-y border-border">
            <TickerPicker onSelectTicker={closeMobile} />
          </div>
        )}

        {/* Portfolio mode: the whole nav column is the preset rail. */}
        {isPortfolioMode ? (
          <nav
            className="flex-1 overflow-y-auto p-3"
            aria-label={t("sidebar.portfolioNav")}
          >
            <div className="flex items-center gap-2 px-1 pb-2">
              <Briefcase className="h-3.5 w-3.5 text-primary shrink-0" />
              <p className="metric-label flex-1 truncate">{t("sidebar.portfolios")}</p>
            </div>
            <PortfoliosRail onSelect={closeMobile} />
          </nav>
        ) : (
          <nav className="flex-1 overflow-y-auto p-3 space-y-1">
            <p className="metric-label px-3 pb-1.5">{t("sidebar.ticker")}</p>
            {TICKER_NAV.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {t(item.labelKey)}
                </Link>
              );
            })}

            {/* Personal / user-owned surfaces. Deliberately sits BETWEEN
                the per-ticker analysis pages and the market-wide
                indicators — the reading order goes "this ticker →
                your stuff → the whole market", which mirrors how
                users typically drill in and out of a decision. */}
            <p className="metric-label px-3 pt-3 pb-1.5">{t("sidebar.personal")}</p>
            {PERSONAL_NAV.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {t(item.labelKey)}
                </Link>
              );
            })}

            {/* Market-wide indicators live in their own section — they
                don't depend on the currently-selected ticker. Rendered
                flat: every entry sits at the same indent as the ticker
                nav above, so users don't have to parse a hierarchy. */}
            <p className="metric-label px-3 pt-3 pb-1.5">{t("sidebar.market")}</p>
            {MARKET_NAV.map((item) => {
              const Icon = item.icon;
              const active = item.matchPrefix
                ? pathname === item.href || pathname.startsWith(`${item.href}/`)
                : pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {t(item.labelKey)}
                </Link>
              );
            })}
          </nav>
        )}

        <div className="border-t border-border">
          {/* Disclosure header — visible on ALL breakpoints. Preferences
              (view / theme / experience / language) live in the sidebar
              footer and stay collapsed by default so the nav column
              doesn't compete with them for attention. Users who want to
              tweak a setting open the panel with one tap; users who
              never touch them (the common case) see a cleaner sidebar. */}
          <button
            type="button"
            onClick={() => setPrefsOpen((v) => !v)}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            aria-expanded={prefsOpen}
            aria-controls="sidebar-preferences"
            aria-label={t("sidebar.togglePreferences")}
          >
            <Settings className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">{t("sidebar.preferences")}</span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 transition-transform",
                prefsOpen && "rotate-180",
              )}
              aria-hidden
            />
          </button>

          <div
            id="sidebar-preferences"
            className={cn(
              "px-4 space-y-3",
              prefsOpen ? "block pb-4" : "hidden",
            )}
          >
            <div className="space-y-1.5">
              <p className="metric-label">{t("sidebar.view")}</p>
              <ModeToggle className="w-full" />
            </div>
            <div className="space-y-1.5">
              <p className="metric-label">{t("sidebar.appearance")}</p>
              <ThemeToggle className="w-full" />
            </div>
            <div className="space-y-1.5">
              <p className="metric-label">{t("sidebar.experience")}</p>
              <LevelToggle className="w-full" />
            </div>
            <div className="space-y-1.5">
              <p className="metric-label">{t("sidebar.language")}</p>
              <LocaleToggle className="w-full" />
            </div>
            {/* Renders only when APP_TOKEN mode is active AND the user
                has a live session. Silent otherwise. */}
            <AuthStatus />
          </div>
        </div>
      </aside>

      {/* Mobile scrim. Sits at z-20 — below the aside (z-40) and the
          floating hamburger (z-50) so both the "close" (X) tap and any
          tap on the drawer's content are unaffected. Tapping the
          darkened area outside the drawer closes it. */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="lg:hidden fixed inset-0 z-20 bg-black/40 backdrop-blur-sm"
          aria-hidden
        />
      )}
    </>
  );
}
