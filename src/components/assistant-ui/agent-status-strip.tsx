"use client";

import { useEffect, useState, type FC } from "react";
import { useAuiState } from "@assistant-ui/react";
import { useHarness } from "@/providers/harness-provider";
import { MAX_AUTO_CONTINUES } from "@/lib/chat-continue";
import { getToolDisplay } from "@/lib/tools";

type ToolishPart = {
  type?: string;
  toolName?: string;
  result?: unknown;
  status?: { type?: string };
};

type ContinueStatusDetail = {
  phase: "idle" | "continuing" | "needs-continue";
  segment?: number;
  max?: number;
  reason?: string;
};

const THINKING_PHRASES = [
  "Thinking…",
  "Gathering context…",
  "Working on it…",
  "Shaping a reply…",
];

function toolNameFromPart(part: ToolishPart): string | null {
  if (typeof part.toolName === "string" && part.toolName) return part.toolName;
  if (typeof part.type === "string" && part.type.startsWith("tool-")) {
    const name = part.type.slice("tool-".length);
    return name || null;
  }
  if (part.type === "tool-call" && part.toolName) return part.toolName;
  return null;
}

function partLooksRunning(part: ToolishPart): boolean {
  if (part.result !== undefined) return false;
  const t = part.status?.type;
  return t === "running" || t === "requires-action" || t === undefined;
}

function latestRunningToolLabel(
  messages: Array<{ role: string; parts?: ToolishPart[] }>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    for (let j = (m.parts?.length ?? 0) - 1; j >= 0; j--) {
      const part = m.parts![j]!;
      const name = toolNameFromPart(part);
      if (!name) continue;
      if (partLooksRunning(part)) {
        return getToolDisplay(name).runningLabel;
      }
    }
    // Only inspect latest assistant message.
    break;
  }
  return null;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

/**
 * Calm composer-adjacent status while the model works — elapsed time, active
 * tool label, or a soft thinking phrase. Also surfaces continue-segment progress.
 */
export const AgentStatusStrip: FC = () => {
  const { classifying } = useHarness();
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const activeToolLabel = useAuiState((s) => {
    if (!s.thread.isRunning) return null;
    return latestRunningToolLabel(
      s.thread.messages as unknown as Array<{
        role: string;
        parts?: ToolishPart[];
      }>,
    );
  });
  const isStreamingText = useAuiState((s) => {
    if (!s.thread.isRunning) return false;
    const messages = s.thread.messages;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return false;
    return (last.parts ?? []).some(
      (p) => p.type === "text" && typeof (p as { text?: string }).text === "string",
    );
  });

  const [phraseIndex, setPhraseIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
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
    if (!isRunning) {
      setElapsed(0);
      return;
    }
    setElapsed(0);
    const timer = window.setInterval(() => {
      setElapsed((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  useEffect(() => {
    if (
      !isRunning ||
      classifying ||
      activeToolLabel ||
      isStreamingText ||
      continueStatus.phase === "continuing"
    ) {
      return;
    }
    setPhraseIndex(0);
    const timer = window.setInterval(() => {
      setPhraseIndex((i) => (i + 1) % THINKING_PHRASES.length);
    }, 3200);
    return () => window.clearInterval(timer);
  }, [
    isRunning,
    classifying,
    activeToolLabel,
    isStreamingText,
    continueStatus.phase,
  ]);

  if (
    continueStatus.phase === "continuing" &&
    typeof continueStatus.segment === "number"
  ) {
    const max = continueStatus.max ?? MAX_AUTO_CONTINUES;
    return (
      <StatusRow
        label={`Continuing… ${continueStatus.segment}/${max}`}
        elapsed={null}
        pulse
      />
    );
  }

  if (classifying) {
    return <StatusRow label="Planning the approach…" elapsed={null} pulse />;
  }

  if (!isRunning) return null;

  const label = activeToolLabel
    ? activeToolLabel
    : isStreamingText
      ? "Writing…"
      : THINKING_PHRASES[phraseIndex];

  return <StatusRow label={label} elapsed={elapsed} pulse />;
};

function StatusRow({
  label,
  elapsed,
  pulse,
}: {
  label: string;
  elapsed: number | null;
  pulse?: boolean;
}) {
  return (
    <div
      className="mb-1.5 flex items-center gap-2 px-2.5 text-[12px] tracking-wide text-[var(--muted)] transition-opacity duration-300"
      role="status"
      aria-live="polite"
    >
      <span
        className={
          pulse
            ? "size-1.5 shrink-0 animate-pulse rounded-full bg-[var(--accent)]"
            : "size-1.5 shrink-0 rounded-full bg-[var(--muted-soft)]"
        }
        aria-hidden
      />
      <span className="min-w-0 truncate">{label}</span>
      {elapsed != null && elapsed > 0 ? (
        <span className="ml-auto shrink-0 tabular-nums text-[var(--muted-soft)]">
          {formatElapsed(elapsed)}
        </span>
      ) : null}
    </div>
  );
}
