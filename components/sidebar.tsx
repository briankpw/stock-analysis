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
import { TickerPicker } from "./ticker-picker";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

/** Ticker-agnostic pages shown above the ticker picker. */
const GLOBAL_NAV = [
  { href: "/portfolios",  label: "Portfolios",           icon: Briefcase },
] as const;

/** Pages that operate on the currently selected ticker. */
const NAV = [
  { href: "/overview",    label: "Overview",             icon: Home },
  { href: "/ratios",      label: "Ratios",               icon: BarChart3 },
  { href: "/charts",      label: "Price & Volume",       icon: LineChart },
  { href: "/indicators",  label: "Technical Indicators", icon: Activity },
  { href: "/news",        label: "News",                 icon: Newspaper },
  { href: "/holders",     label: "Holders",              icon: Users },
  { href: "/paper",       label: "Paper Trading",        icon: Wallet },
  { href: "/bot",         label: "Alert Bot",            icon: Bot },
  { href: "/raw",         label: "Raw Data",             icon: ChartBar },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  // Auto-close on route change (mobile).
  React.useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between h-14 px-4 border-b border-border bg-background/80 backdrop-blur-md">
        <Link href="/overview" className="flex items-center gap-2 font-semibold">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary/20 text-primary">
            <BarChart3 className="h-4 w-4" />
          </span>
          <span>Key Stock</span>
        </Link>
        <Button variant="ghost" size="icon" onClick={() => setMobileOpen((v) => !v)} aria-label="Toggle menu">
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
        aria-label="Primary navigation"
      >
        <div className="hidden lg:flex px-5 pt-6 pb-4 items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 text-primary">
            <BarChart3 className="h-4 w-4" />
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-semibold leading-tight">Key Stock</span>
            <span className="text-[0.7rem] uppercase tracking-wider text-muted-foreground leading-tight">
              Analysis Dashboard
            </span>
          </div>
        </div>

        <nav className="p-3 space-y-1 border-b border-border">
          <p className="metric-label px-3 pb-1.5">Global</p>
          {GLOBAL_NAV.map((item) => {
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
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-5 py-4 space-y-4 border-b border-border">
          <TickerPicker />
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          <p className="metric-label px-3 pb-1.5">Ticker</p>
          {NAV.map((item) => {
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
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border px-4 py-4 space-y-3">
          <div className="space-y-1.5">
            <p className="metric-label">Appearance</p>
            <ThemeToggle className="w-full" />
          </div>
          <div className="space-y-1.5">
            <p className="metric-label">Experience</p>
            <LevelToggle className="w-full" />
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
