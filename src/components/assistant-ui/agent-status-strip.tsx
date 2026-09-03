"use client";

import { useEffect, useRef, useState, type FC } from "react";
import { ChevronDownIcon } from "lucide-react";
import { useAuiState } from "@assistant-ui/react";
import { useHarness } from "@/providers/harness-provider";
import { MAX_AUTO_CONTINUES } from "@/lib/chat-continue";
import {
  closeActivityClock,
  collectWebSearchHits,
  deriveAgentActivity,
  formatActivityElapsed,
  recalledActivityElapsed,
  syncActivityClock,
  type ActivityMessage,
  type ActivityView,
  type ContinuePhase,
} from "@/lib/agent-activity";
import { cn } from "@/lib/utils";
import "@/components/assistant-ui/agent-activity.css";

type ContinueStatusDetail = {
  phase: ContinuePhase;
  segment?: number;
  max?: number;
  reason?: string;
};

function useContinueStatus(): ContinueStatusDetail {
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

  return continueStatus;
}

function useThreadActivityElapsed(isRunning: boolean, messageId?: string) {
  const [elapsed, setElapsed] = useState(() =>
    isRunning ? 0 : recalledActivityElapsed(messageId),
  );
  const wasRunningRef = useRef(isRunning);

  useEffect(() => {
    if (!isRunning) {
      if (wasRunningRef.current) {
        setElapsed(closeActivityClock(messageId));
      } else {
        setElapsed(recalledActivityElapsed(messageId));
      }
      wasRunningRef.current = false;
      return;
    }
    wasRunningRef.current = true;
    syncActivityClock(true);
    setElapsed(syncActivityClock(true));
    const timer = window.setInterval(() => {
      setElapsed(syncActivityClock(true));
    }, 250);
    return () => window.clearInterval(timer);
  }, [isRunning, messageId]);

  return elapsed;
}

function ElapsedTicks({
  seconds,
  prefix,
}: {
  seconds: number;
  prefix: "Working for" | "Worked for";
}) {
  if (seconds <= 0) return null;
  return (
    <span>
      {prefix}{" "}
      <span className="tabular-nums">{formatActivityElapsed(seconds)}</span>
    </span>
  );
}

function MutatingLine({
  view,
  className,
}: {
  view: ActivityView;
  className?: string;
}) {
  const working = view.mode === "elapsed";
  const words = working ? "Working" : view.liveLine;

  if (!words) return null;

  const showTicks =
    view.elapsedSeconds > 0 &&
    (view.mode === "live" || view.mode === "elapsed");

  return (
    <div
      className={cn(
        "aether-activity aether-activity--enter aether-activity__line",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <span
        key={view.lineKey ?? words}
        className="aether-activity__words aether-activity--enter"
      >
        {words}
      </span>
      {showTicks ? (
        <span className="aether-activity__ticks">
          {formatActivityElapsed(view.elapsedSeconds)}
        </span>
      ) : null}
    </div>
  );
}

export function AgentActivityPanel({
  view,
  className,
}: {
  view: ActivityView;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!view.visible) return null;

  if (view.mode === "collapsed") {
    return (
      <div
        className={cn("aether-activity aether-activity--enter", className)}
        role="status"
        aria-live="polite"
      >
        <button
          type="button"
          className="aether-activity__summary-btn"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {view.summaryLabel?.startsWith("Worked for ") ? (
            <ElapsedTicks seconds={view.elapsedSeconds} prefix="Worked for" />
          ) : (
            <span>{view.summaryLabel}</span>
          )}
          <ChevronDownIcon className="aether-activity__caret" aria-hidden />
        </button>
        {open ? (
          <ol className="aether-activity__chips" aria-label="Work in this turn">
            {view.steps.map((step) => (
              <li
                key={step.id}
                className="aether-activity__chip"
                title={step.label}
              >
                {step.label}
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    );
  }

  return <MutatingLine view={view} className={className} />;
}

function threadMessagesFromState(messages: unknown): ActivityMessage[] {
  return messages as ActivityMessage[];
}

/**
 * Composer-adjacent live clock before the assistant message mounts.
 * Classifying is not a status line.
 */
export const AgentStatusStrip: FC = () => {
  const { classifying } = useHarness();
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const lastAssistantId = useAuiState((s) => {
    const messages = s.thread.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "assistant") return messages[i]!.id;
    }
    return undefined;
  });
  const hasLiveAssistant = useAuiState((s) => {
    if (!s.thread.isRunning) return false;
    const last = s.thread.messages[s.thread.messages.length - 1];
    return !!last && last.role === "assistant";
  });
  const messages = useAuiState((s) =>
    threadMessagesFromState(s.thread.messages),
  );
  const continueStatus = useContinueStatus();
  const elapsed = useThreadActivityElapsed(isRunning, lastAssistantId);

  const view = deriveAgentActivity({
    messages,
    isRunning,
    elapsedSeconds: elapsed,
    classifying,
    continuePhase: continueStatus.phase,
    continueSegment: continueStatus.segment,
    continueMax: continueStatus.max ?? MAX_AUTO_CONTINUES,
  });

  if (hasLiveAssistant) return null;
  if (view.mode === "collapsed") return null;

  return <AgentActivityPanel view={view} className="mb-1.5 px-2.5" />;
};

function hostLabel(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export const MessageSourceCards: FC = () => {
  const parts = useAuiState((s) => s.message.parts as ActivityMessage["parts"]);
  const hits = collectWebSearchHits(parts);
  if (hits.length === 0) return null;

  return (
    <ul className="aether-inline-sources" aria-label="Sources">
      {hits.map((hit, i) => {
        const host = hostLabel(hit.url);
        const inner = (
          <>
            <span className="aether-inline-source__title">{hit.title}</span>
            {host ? (
              <span className="aether-inline-source__host">{host}</span>
            ) : null}
          </>
        );
        return (
          <li key={`${hit.url ?? hit.title}:${i}`}>
            {hit.url ? (
              <a
                href={hit.url}
                target="_blank"
                rel="noreferrer"
                className="aether-inline-source"
              >
                {inner}
              </a>
            ) : (
              <span className="aether-inline-source">{inner}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
};

export const MessageAgentActivity: FC = () => {
  const isRunning = useAuiState((s) => s.message.status?.type === "running");
  const messageId = useAuiState((s) => s.message.id);
  const parts = useAuiState((s) => s.message.parts as ActivityMessage["parts"]);
  const elapsed = useThreadActivityElapsed(isRunning, messageId);
  const continueStatus = useContinueStatus();

  const view = deriveAgentActivity({
    messages: [{ id: messageId, role: "assistant", parts }],
    isRunning,
    elapsedSeconds: isRunning
      ? elapsed
      : elapsed || recalledActivityElapsed(messageId),
    continuePhase: isRunning ? continueStatus.phase : "idle",
    continueSegment: continueStatus.segment,
    continueMax: continueStatus.max ?? MAX_AUTO_CONTINUES,
  });

  if (!view.visible) return null;

  return (
    <AgentActivityPanel
      view={view}
      className="mb-2 font-[family-name:var(--font-sans)]"
    />
  );
};
