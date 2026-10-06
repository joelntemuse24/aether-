"use client";

import { useEffect, useId, useRef, useState, type FC } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "lucide-react";
import { ChevronDownIcon } from "lucide-react";
import { useAuiState } from "@assistant-ui/react";
import { useHarness } from "@/providers/harness-provider";
import { MAX_AUTO_CONTINUES } from "@/lib/chat-continue";
import {
  THINKING_WORD,
  closeActivityClock,
  collectWebSearchHits,
  compactLiveSteps,
  deriveAgentActivity,
  formatActivityElapsed,
  activityClockShouldRun,
  liveReasoningDisclosure,
  liveWorkOneLiner,
  recalledActivityElapsed,
  shouldRevealActivityElapsed,
  shouldShowComposerActivity,
  sourceChipLabel,
  shouldShowMessageSourceCards,
  sourcePagesLabel,
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
        const recalled = recalledActivityElapsed(messageId);
        setElapsed(recalled > 0 ? recalled : closeActivityClock(messageId));
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

function StatusGlyph() {
  return (
    <svg
      className="aether-activity__glyph"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M8 0.75 9.05 6.95 15.25 8 9.05 9.05 8 15.25 6.95 9.05 0.75 8 6.95 6.95Z"
      />
    </svg>
  );
}

function LiveActivity({
  view,
  className,
}: {
  view: ActivityView;
  className?: string;
}) {
  const toolLine = liveWorkOneLiner(view);
  const liveSteps = compactLiveSteps(view);
  const label = toolLine ?? liveSteps[0]?.label ?? view.liveLine ?? "Thinking";
  const showElapsed = shouldRevealActivityElapsed(view.elapsedSeconds);
  const liveReasoning = liveReasoningDisclosure(view);
  const [open, setOpen] = useState(false);
  const reasoningId = useId();
  return (
    <div
      className={cn(
        "aether-activity aether-activity--enter aether-activity--live",
        className,
      )}
      data-activity-mode={view.mode}
    >
      <div className="aether-activity__line">
        <StatusGlyph />
        <span
          key={view.lineKey ?? label}
          className="aether-activity__label"
          role="status"
          aria-live="polite"
        >
          {label}
        </span>
        {showElapsed ? (
          <span className="aether-activity__elapsed">
            {formatActivityElapsed(view.elapsedSeconds)}
          </span>
        ) : null}
      </div>
      {liveReasoning ? (
        <>
          <button
            type="button"
            className="aether-activity__summary-btn"
            aria-expanded={open}
            aria-controls={reasoningId}
            onClick={() => setOpen((v) => !v)}
          >
            <span>{THINKING_WORD}</span>
            <ChevronDownIcon className="aether-activity__caret" aria-hidden />
          </button>
          {open ? (
            <div id={reasoningId} className="aether-activity__detail">
              <p className="aether-activity__reasoning">{liveReasoning}</p>
            </div>
          ) : null}
        </>
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
  const stepsId = useId();

  if (!view.visible) return null;

  if (view.mode === "collapsed") {
    const canExpand = view.steps.length > 0 || !!view.reasoning;
    return (
      <div
        className={cn("aether-activity aether-activity--enter", className)}
        data-activity-mode="collapsed"
      >
        {canExpand ? (
          <button
            type="button"
            className="aether-activity__summary-btn"
            aria-expanded={open}
            aria-controls={stepsId}
            onClick={() => setOpen((v) => !v)}
          >
            <span role="status" aria-live="polite">
              {view.summaryLabel}
            </span>
            <ChevronDownIcon className="aether-activity__caret" aria-hidden />
          </button>
        ) : (
          <span className="aether-activity__summary-btn" role="status" aria-live="polite">
            {view.summaryLabel}
          </span>
        )}
        {open && canExpand ? (
          <div id={stepsId} className="aether-activity__detail">
            {view.reasoning ? (
              <p className="aether-activity__reasoning">{view.reasoning}</p>
            ) : null}
            {view.steps.length > 0 ? (
              <ol className="aether-activity__steps" aria-label="Work in this turn">
                {view.steps.map((step) => (
                  <li key={step.id} className="aether-activity__step">
                    <span>{step.label}</span>
                    {step.query ? (
                      <span className="aether-activity__chip">{step.query}</span>
                    ) : null}
                    {step.site ? (
                      <span className="aether-activity__chip">{step.site}</span>
                    ) : null}
                    {step.code ? (
                      <pre className="aether-activity__code">{step.code}</pre>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return <LiveActivity view={view} className={className} />;
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
    const messages = Array.isArray(s.thread?.messages) ? s.thread.messages : [];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "assistant") return messages[i]!.id;
    }
    return undefined;
  });
  const hasLiveAssistant = useAuiState((s) => {
    const messages = Array.isArray(s.thread?.messages) ? s.thread.messages : [];
    const last = messages[messages.length - 1];
    return !!last && last.role === "assistant";
  });
  const messages = useAuiState((s) =>
    threadMessagesFromState(
      Array.isArray(s.thread?.messages) ? s.thread.messages : [],
    ),
  );
  const continueStatus = useContinueStatus();
  const elapsed = useThreadActivityElapsed(
    activityClockShouldRun({
      isRunning,
      continuePhase: continueStatus.phase,
      messages,
    }),
    lastAssistantId,
  );

  const view = deriveAgentActivity({
    messages,
    isRunning,
    elapsedSeconds: elapsed,
    classifying,
    continuePhase: continueStatus.phase,
    continueSegment: continueStatus.segment,
    continueMax: continueStatus.max ?? MAX_AUTO_CONTINUES,
  });

  if (
    !shouldShowComposerActivity({
      hasAssistantMessage: hasLiveAssistant,
      visible: view.visible,
      mode: view.mode,
    })
  ) {
    return null;
  }

  return (
    <div data-activity-slot="pending">
      <AgentActivityPanel
        view={view}
        className="aether-activity--pending px-1"
      />
    </div>
  );
};

function hostLabel(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function faviconSrc(url?: string): string | null {
  const host = hostLabel(url);
  if (!host) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

const SourceFavicon: FC<{ url?: string; title: string }> = ({ url, title }) => {
  const src = faviconSrc(url);
  const [failed, setFailed] = useState(false);
  const letter = (hostLabel(url) || title || "?").slice(0, 1).toUpperCase();
  if (!src || failed) {
    return <span className="aether-pages-pill__letter">{letter}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="aether-pages-pill__favicon"
      onError={() => setFailed(true)}
    />
  );
};

export const MessageSourceCards: FC = () => {
  const parts = useAuiState((s) => s.message?.parts);
  const statusType = useAuiState((s) => s.message?.status?.type);
  const hits = collectWebSearchHits(parts);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!shouldShowMessageSourceCards(statusType) || hits.length === 0) {
    return null;
  }
  const faces = hits.slice(0, 3);

  return (
    <section className="aether-source-tray" aria-label="Sources">
      <button
        type="button"
        className="aether-pages-pill aether-source-tray__pill"
        aria-expanded={open}
        aria-controls={titleId}
        onClick={() => setOpen(true)}
      >
        <span className="aether-pages-pill__faces" aria-hidden>
          {faces.map((hit, i) => (
            <SourceFavicon
              key={`${hit.url ?? hit.title}:${i}`}
              url={hit.url}
              title={hit.title}
            />
          ))}
        </span>
        {sourcePagesLabel(hits.length)}
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
        <div className="aether-web-results__layer">
          <button
            type="button"
            className="aether-web-results__backdrop"
            aria-label="Close sources"
            onClick={() => setOpen(false)}
          />
          <div
            className="aether-web-results"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <header className="aether-web-results__header">
              <h2 id={titleId} className="aether-web-results__title">
                Sources <span className="tabular-nums text-[var(--muted-soft)]">{hits.length}</span>
              </h2>
              <button
                ref={closeRef}
                type="button"
                className="aether-web-results__close"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                <XIcon className="size-4" />
              </button>
            </header>
            <ul className="aether-source-tray__hosts aether-inline-sources">
              {hits.map((hit, i) => {
                const host = sourceChipLabel(hit) || hostLabel(hit.url);
                const body = (
                  <>
                    <span className="aether-inline-source__title">{hit.title}</span>
                    {hit.snippet ? (
                      <span className="aether-web-result__snippet">{hit.snippet}</span>
                    ) : null}
                    <span className="aether-web-result__meta">
                      <SourceFavicon url={hit.url} title={hit.title} />
                      {host ? (
                        <span className="aether-inline-source__host">{host}</span>
                      ) : null}
                    </span>
                  </>
                );
                return (
                  <li key={`${hit.url ?? hit.title}:${i}`}>
                    {hit.url ? (
                      <a
                        href={hit.url}
                        target="_blank"
                        rel="noreferrer"
                        className="aether-inline-source aether-web-result"
                      >
                        {body}
                      </a>
                    ) : (
                      <span className="aether-inline-source aether-web-result">{body}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>,
        document.body,
      ) : null}
    </section>
  );
};

export const MessageAgentActivity: FC = () => {
  const isRunning = useAuiState((s) => s.message?.status?.type === "running");
  const messageId = useAuiState((s) => s.message?.id);
  const parts = useAuiState((s) => s.message?.parts);
  const continueStatus = useContinueStatus();
  const elapsed = useThreadActivityElapsed(
    activityClockShouldRun({
      isRunning,
      continuePhase: continueStatus.phase,
      messages: [{ id: messageId, role: "assistant", parts }],
    }),
    messageId,
  );

  const view = deriveAgentActivity({
    messages: [{ id: messageId, role: "assistant", parts }],
    isRunning,
    elapsedSeconds: isRunning
      ? elapsed
      : elapsed || recalledActivityElapsed(messageId),
    continuePhase: continueStatus.phase,
    continueSegment: continueStatus.segment,
    continueMax: continueStatus.max ?? MAX_AUTO_CONTINUES,
  });

  if (!view.visible) return null;

  return (
    <div data-activity-slot="message">
      <AgentActivityPanel
        view={view}
        className="aether-activity--message mb-2 font-[family-name:var(--font-sans)]"
      />
    </div>
  );
};
