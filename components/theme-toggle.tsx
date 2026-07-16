"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

/**
 * Compact segmented control for dark/light. Uses `next-themes` so the
 * initial state is drawn from localStorage (no hydration flash).
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // Guard against SSR-time reads: `theme` may be undefined until mount.
  const active = mounted ? theme ?? "dark" : "dark";

  return (
    <div
      className={cn(
        "inline-flex rounded-lg glass p-1 gap-1",
        className,
      )}
      role="group"
      aria-label="Theme"
    >
      <Button
        variant={active === "dark" ? "default" : "ghost"}
        size="sm"
        onClick={() => setTheme("dark")}
        className="gap-1.5"
        aria-pressed={active === "dark"}
      >
        <Moon className="h-3.5 w-3.5" /> Dark
      </Button>
      <Button
        variant={active === "light" ? "default" : "ghost"}
        size="sm"
        onClick={() => setTheme("light")}
        className="gap-1.5"
        aria-pressed={active === "light"}
      >
        <Sun className="h-3.5 w-3.5" /> Light
      </Button>
    </div>
  );
}
