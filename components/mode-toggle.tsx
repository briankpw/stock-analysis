"use client";

import { Briefcase, LineChart } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "./ui/button";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Sidebar "View" pill: Stock ↔ Portfolio.
 *
 * Mode is derived from the URL so deep-links stay honest — hitting
 * `/portfolios` directly still shows the Portfolio side of the sidebar
 * with this pill on the Portfolio position.
 */
export function ModeToggle({ className }: { className?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useT();
  const isPortfolio =
    pathname === "/portfolios" || pathname.startsWith("/portfolios/");

  return (
    <div
      className={cn("inline-flex rounded-lg glass p-1 gap-1", className)}
      role="group"
      aria-label={t("mode.ariaLabel")}
    >
      <Button
        variant={!isPortfolio ? "default" : "ghost"}
        size="sm"
        onClick={() => {
          if (isPortfolio) router.push("/overview");
        }}
        className="gap-1.5 flex-1"
        aria-pressed={!isPortfolio}
      >
        <LineChart className="h-3.5 w-3.5" /> {t("mode.stock")}
      </Button>
      <Button
        variant={isPortfolio ? "default" : "ghost"}
        size="sm"
        onClick={() => {
          if (!isPortfolio) router.push("/portfolios");
        }}
        className="gap-1.5 flex-1"
        aria-pressed={isPortfolio}
      >
        <Briefcase className="h-3.5 w-3.5" /> {t("mode.portfolio")}
      </Button>
    </div>
  );
}
