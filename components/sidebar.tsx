"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3, LineChart, Newspaper, Wallet, Bot, Activity,
  Home, ChartBar, Menu, X, Users, Briefcase,
} from "lucide-react";
import { ThemeToggle } from "./theme-toggle";
import { LevelToggle } from "./level-toggle";
import { LocaleToggle } from "./locale-toggle";
import { ModeToggle } from "./mode-toggle";
import { TickerPicker } from "./ticker-picker";
import { PortfoliosRail } from "./portfolios-rail";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

/**
 * Pages that operate on the currently selected ticker. The `labelKey`
 * points into the i18n dictionary so the sidebar re-labels when the
 * user flips the language toggle.
 */
const TICKER_NAV = [
  { href: "/overview",    labelKey: "nav.overview",   icon: Home },
  { href: "/ratios",      labelKey: "nav.ratios",     icon: BarChart3 },
  { href: "/charts",      labelKey: "nav.charts",     icon: LineChart },
  { href: "/indicators",  labelKey: "nav.indicators", icon: Activity },
  { href: "/news",        labelKey: "nav.news",       icon: Newspaper },
  { href: "/holders",     labelKey: "nav.holders",    icon: Users },
  { href: "/paper",       labelKey: "nav.paper",      icon: Wallet },
  { href: "/bot",         labelKey: "nav.bot",        icon: Bot },
  { href: "/raw",         labelKey: "nav.raw",        icon: ChartBar },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const t = useT();

  // Auto-close on route change (mobile).
  React.useEffect(() => setMobileOpen(false), [pathname]);

  const isPortfolioMode =
    pathname === "/portfolios" || pathname.startsWith("/portfolios/");

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between h-14 px-4 border-b border-border bg-background/80 backdrop-blur-md">
        <Link href="/overview" className="flex items-center gap-2 font-semibold">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary/20 text-primary">
            <BarChart3 className="h-4 w-4" />
          </span>
          <span>{t("brand.name")}</span>
        </Link>
        <Button variant="ghost" size="icon" onClick={() => setMobileOpen((v) => !v)} aria-label={t("sidebar.toggleMenu")}>
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed lg:sticky top-0 z-40 lg:z-10 h-screen lg:h-screen w-72",
          "bg-background/95 lg:bg-background/60 backdrop-blur-xl border-r border-border",
          "flex flex-col transition-transform lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
        aria-label={t("sidebar.primaryNav")}
      >
        <div className="hidden lg:flex px-5 pt-6 pb-4 items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 text-primary">
            <BarChart3 className="h-4 w-4" />
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-semibold leading-tight">{t("brand.name")}</span>
            <span className="text-[0.7rem] uppercase tracking-wider text-muted-foreground leading-tight">
              {t("brand.subtitle")}
            </span>
          </div>
        </div>

        {/* Ticker picker only makes sense when in Stock mode. */}
        {!isPortfolioMode && (
          <div className="px-5 py-4 space-y-4 border-y border-border">
            <TickerPicker />
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
            <PortfoliosRail />
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
          </nav>
        )}

        <div className="border-t border-border px-4 py-4 space-y-3">
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
        </div>
      </aside>

      {/* Mobile scrim */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="lg:hidden fixed inset-0 z-30 bg-black/40 backdrop-blur-sm"
          aria-hidden
        />
      )}
    </>
  );
}
