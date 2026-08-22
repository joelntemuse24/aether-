"use client";

import { useSettings } from "@/providers/settings-provider";
import { cn } from "@/lib/utils";
import type { ToolApprovalMode } from "@/lib/hermes/tool-approval";

const OPTIONS: Array<{ id: ToolApprovalMode; label: string }> = [
  { id: "ask", label: "Ask" },
  { id: "auto", label: "Auto" },
];

export function ToolApprovalToggle({
  compact = true,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { settings, updateSettings } = useSettings();
  const mode = settings.toolApprovalMode === "auto" ? "auto" : "ask";

  return (
    <div
      role="group"
      aria-label="Tool approval"
      title="Ask confirms changes. Auto runs routine tools; destructive actions still ask."
      className={cn(
        "inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--canvas)] p-0.5",
        className,
      )}
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          aria-pressed={mode === opt.id}
          onClick={() => updateSettings({ toolApprovalMode: opt.id })}
          className={cn(
            "rounded-full font-medium transition-colors",
            compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-[12px]",
            mode === opt.id
              ? "bg-[var(--elevated)] text-[var(--text)] shadow-sm"
              : "text-[var(--muted)] hover:text-[var(--text)]",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
