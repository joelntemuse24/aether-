"use client";

import { useEffect, useState, type FC } from "react";
import { useAuiState } from "@assistant-ui/react";
import { useHarness } from "@/providers/harness-provider";
import { MAX_AUTO_CONTINUES } from "@/lib/chat-continue";

type ToolishPart = {
  type?: string;
  toolName?: string;
  result?: unknown;
  status?: { type?: string };
};

type ContinueStatusDetail = {
  phase: "idle" | "continuing";
  segment?: number;
  max?: number;
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
 * duplicate “Searching…” labels. Also surfaces continue-segment progress.
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
  const [continueStatus, setContinueStatus] = useState<ContinueStatusDetail>({
    phase: "idle",
  });

  useEffect(() => {
    const onStatus = (e: Event) => {
      const detail = (e as CustomEvent<ContinueStatusDetail>).detail;
      if (!detail || typeof detail.phase !== "string") return;
      setContinueStatus(detail);
    };
    window.addEventListener("aether:continue-status", onStatus);
    return () => window.removeEventListener("aether:continue-status", onStatus);
  }, []);

  useEffect(() => {
    if (
      !isRunning ||
      toolsVisible ||
      classifying ||
      continueStatus.phase === "continuing"
    ) {
      return;
    }
    setPhraseIndex(0);
    const timer = window.setInterval(() => {
      setPhraseIndex((i) => (i + 1) % THINKING_PHRASES.length);
    }, 2800);
    return () => window.clearInterval(timer);
  }, [isRunning, toolsVisible, classifying, continueStatus.phase]);

  if (
    continueStatus.phase === "continuing" &&
    typeof continueStatus.segment === "number"
  ) {
    const max = continueStatus.max ?? MAX_AUTO_CONTINUES;
    return (
      <div
        className="mb-1 px-2.5 text-[12px] tracking-wide text-[var(--muted)] transition-opacity duration-300"
        role="status"
        aria-live="polite"
      >
        Continuing… {continueStatus.segment}/{max}
      </div>
    );
  }

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
