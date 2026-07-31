"use client";

import { useEffect, useState, type FC } from "react";
import { useAuiState } from "@assistant-ui/react";
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

function hasVisibleToolCall(
  messages: Array<{ role: string; parts?: ToolishPart[] }>,
): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    for (const part of m.parts ?? []) {
      if (part.type === "tool-call" && part.toolName) return true;
    }
    // Only inspect the latest assistant message.
    return false;
  }
  return false;
}

/**
 * Quiet composer-adjacent status while the model is thinking — before tool
 * shells appear in the message. Once tools render inline, hide to avoid
 * duplicate “Searching…” labels.
 */
export const AgentStatusStrip: FC = () => {
  const { classifying } = useHarness();
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const toolsVisible = useAuiState((s) => {
    if (!s.thread.isRunning) return false;
    return hasVisibleToolCall(
      s.thread.messages as unknown as Array<{
        role: string;
        parts?: ToolishPart[];
      }>,
    );
  });

  const [phraseIndex, setPhraseIndex] = useState(0);

  useEffect(() => {
    if (!isRunning || toolsVisible || classifying) return;
    setPhraseIndex(0);
    const timer = window.setInterval(() => {
      setPhraseIndex((i) => (i + 1) % THINKING_PHRASES.length);
    }, 2800);
    return () => window.clearInterval(timer);
  }, [isRunning, toolsVisible, classifying]);

  if (classifying) {
    return (
      <div
        className="mb-1 px-2.5 text-[12px] tracking-wide text-[var(--muted)] transition-opacity duration-300"
        role="status"
        aria-live="polite"
      >
        Gathering threads…
      </div>
    );
  }

  // Tool shells in the transcript carry their own status — don't double up.
  if (!isRunning || toolsVisible) return null;

  return (
    <div
      className="mb-1 px-2.5 text-[12px] tracking-wide text-[var(--muted)] transition-opacity duration-300"
      role="status"
      aria-live="polite"
    >
      {THINKING_PHRASES[phraseIndex]}
    </div>
  );
};
