"use client";

import { GraduationCap, Sparkles } from "lucide-react";
import { Button } from "./ui/button";
import { useUi } from "@/lib/state";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Beginner / Advanced pill. Reads and writes zustand — no per-widget
 * dance with dynamic keys (which is what crashed Streamlit).
 */
export function LevelToggle({ className }: { className?: string }) {
  const level = useUi((s) => s.level);
  const setLevel = useUi((s) => s.setLevel);
  const t = useT();

  return (
    <div
      className={cn("inline-flex rounded-lg glass p-1 gap-1", className)}
      role="group"
      aria-label={t("level.ariaLabel")}
    >
      <Button
        variant={level === "beginner" ? "default" : "ghost"}
        size="sm"
        onClick={() => setLevel("beginner")}
        className="gap-1.5 flex-1"
        aria-pressed={level === "beginner"}
      >
        <GraduationCap className="h-3.5 w-3.5" /> {t("level.beginner")}
      </Button>
      <Button
        variant={level === "advanced" ? "default" : "ghost"}
        size="sm"
        onClick={() => setLevel("advanced")}
        className="gap-1.5 flex-1"
        aria-pressed={level === "advanced"}
      >
        <Sparkles className="h-3.5 w-3.5" /> {t("level.advanced")}
      </Button>
    </div>
  );
}
