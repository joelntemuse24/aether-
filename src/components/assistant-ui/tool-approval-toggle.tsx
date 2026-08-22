"use client";

import { CircleHelpIcon, ZapIcon } from "lucide-react";
import { useSettings } from "@/providers/settings-provider";
import { cn } from "@/lib/utils";
import type { ToolApprovalMode } from "@/lib/hermes/tool-approval";
import "./tool-approval.css";

const OPTIONS: Array<{
  id: ToolApprovalMode;
  label: string;
  ariaLabel: string;
}> = [
  {
    id: "ask",
    label: "Ask",
    ariaLabel: "Ask. Confirm changes before they run.",
  },
  {
    id: "auto",
    label: "Auto",
    ariaLabel: "Auto. Run routine tools without a tap.",
  },
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
      aria-label="Tool approval. Ask confirms changes. Auto runs routine tools."
      className={cn("aether-tool-approval", compact && "is-compact", className)}
    >
      <span className="aether-tool-approval__icon" aria-hidden="true">
        <CircleHelpIcon data-active={mode === "ask"} />
        <ZapIcon data-active={mode === "auto"} />
      </span>
      {OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          aria-pressed={mode === opt.id}
          aria-label={opt.ariaLabel}
          onClick={() => updateSettings({ toolApprovalMode: opt.id })}
          className="aether-tool-approval__option"
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
