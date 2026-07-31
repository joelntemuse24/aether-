"use client";

import { useEffect, useState, type FC } from "react";
import { useAuiState } from "@assistant-ui/react";
import { getToolDisplay } from "@/lib/tools";
import { useHarness } from "@/providers/harness-provider";

type ToolishPart = {
  type?: string;
  toolName?: string;
  result?: unknown;
  status?: { type?: string };
};

const THINKING_PHRASES = [
  "Cooking…",
  "Gathering threads…",
  "Building a response…",
  "Checking the shape of it…",
];

function runningToolLabel(
  messages: Array<{ role: string; parts?: ToolishPart[] }>,
): string | null {
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
    return null;
  }
  return null;
}

/**
 * Quiet composer-adjacent status — no bordered strip, editorial pacing.
 */
export const AgentStatusStrip: FC = () => {
  const { classifying } = useHarness();
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const toolLabel = useAuiState((s) => {
    if (!s.thread.isRunning) return null;
    return runningToolLabel(
      s.thread.messages as unknown as Array<{
        role: string;
        parts?: ToolishPart[];
      }>,
    );
  });

  const [phraseIndex, setPhraseIndex] = useState(0);

  useEffect(() => {
    if (!isRunning || toolLabel || classifying) return;
    setPhraseIndex(0);
    const timer = window.setInterval(() => {
      setPhraseIndex((i) => (i + 1) % THINKING_PHRASES.length);
    }, 900);
    return () => window.clearInterval(timer);
  }, [isRunning, toolLabel, classifying]);

  if (classifying) {
    return (
      <div
        className="mb-1 px-2.5 text-[12px] tracking-wide text-[var(--muted)] animate-[fadeIn_150ms_ease-out]"
        role="status"
        aria-live="polite"
      >
        Gathering threads…
      </div>
    );
  }

  if (!isRunning) return null;

  const text = toolLabel ?? THINKING_PHRASES[phraseIndex];

  return (
    <div
      className="mb-1 px-2.5 text-[12px] tracking-wide text-[var(--muted)] animate-[fadeIn_150ms_ease-out]"
      role="status"
      aria-live="polite"
    >
      {text}
    </div>
  );
};
