"use client";

import { type FC } from "react";
import { useAuiState } from "@assistant-ui/react";
import { Loader2Icon } from "lucide-react";
import { getToolDisplay } from "@/lib/tools";

type ToolishPart = {
  type?: string;
  toolName?: string;
  result?: unknown;
  status?: { type?: string };
};

function runningToolLabel(
  messages: Array<{ role: string; parts?: ToolishPart[] }>,
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const parts = m.parts ?? [];
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j];
      if (part.type !== "tool-call" || !part.toolName) continue;
      if (part.result !== undefined) continue;
      if (part.status?.type === "complete") continue;
      return getToolDisplay(part.toolName).runningLabel;
    }
    return "Writing…";
  }
  return "Thinking…";
}

/**
 * Composer-adjacent status while the assistant is running —
 * Claude/ChatGPT-style "Searching…" / "Running Python…" strip.
 */
export const AgentStatusStrip: FC = () => {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const text = useAuiState((s) => {
    if (!s.thread.isRunning) return null;
    return runningToolLabel(
      s.thread.messages as unknown as Array<{
        role: string;
        parts?: ToolishPart[];
      }>,
    );
  });

  if (!isRunning || !text) return null;

  return (
    <div
      className="mb-1.5 flex items-center gap-2 px-2.5 text-[12px] text-[var(--muted)] animate-[fadeIn_150ms_ease-out]"
      role="status"
      aria-live="polite"
    >
      <Loader2Icon className="size-3 animate-spin text-[var(--accent)]" />
      <span className="tracking-wide">{text}</span>
    </div>
  );
};
