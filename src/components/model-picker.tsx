"use client";

import { CheckIcon } from "lucide-react";
import { useSettings } from "@/providers/settings-provider";
import { cn } from "@/lib/utils";

const TIERS: Array<{
  id: AppSettings["speedTier"];
  hint: string;
}> = [
  {
    id: "fast",
    hint: "Quick replies",
  },
  {
    id: "expert",
    hint: "Deeper reasoning",
  },
];

export function ModelPicker({ className }: { className?: string }) {
  void className;
  const { settings, updateSettings } = useSettings();
  const tier = settings.speedTier === "expert" ? "expert" : "fast";

  return (
    <div
      className={cn("flex items-center gap-0.5 rounded-md bg-[var(--surface)] p-0.5", className)}
      role="radiogroup"
      aria-label="Response speed"
    >
      {TIERS.map((t) => {
        const selected = tier === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={selected}
            title={t.hint}
            onClick={() => updateSettings({ speedTier: t.id })}
            className={cn(
              "flex h-7 items-center gap-1 rounded-[5px] px-2.5 text-xs font-medium transition-colors",
              selected
                ? "bg-[var(--accent-muted)] text-[var(--text)]"
                : "text-[var(--muted)] hover:text-[var(--text)]",
            )}
          >
            {selected ? (
              <CheckIcon className="size-3 shrink-0 text-[var(--accent)]" />
            ) : null}
            <span className="capitalize">{t.id === "fast" ? "Fast" : "Expert"}</span>
          </button>
        );
      })}
    </div>
  );
}
