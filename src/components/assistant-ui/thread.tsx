"use client";

import Image from "next/image";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FC,
} from "react";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { ToolCallPart, type ToolPartLike } from "@/components/assistant-ui/tool-ui";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { ThreadHeader } from "@/components/assistant-ui/thread-header";
import { AgentStatusStrip } from "@/components/assistant-ui/agent-status-strip";
import { ModelPicker } from "@/components/model-picker";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSettings } from "@/providers/settings-provider";
import { useAttachments } from "@/providers/attachments-provider";
import { useDrive } from "@/providers/drive-provider";
import {
  ActionBarPrimitive,
  AuiIf,
  type AssistantState,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  ExportedMessageRepository,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useComposerRuntime,
  useThreadRuntime,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  FileIcon,
  ImageIcon,
  Loader2Icon,
  MicIcon,
  PaperclipIcon,
  PencilIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { ClarifyCard } from "@/components/assistant-ui/clarify-card";
import { useHarness } from "@/providers/harness-provider";
import { useGitHub } from "@/providers/github-provider";
import type { HarnessClassification } from "@/lib/harness/types";
import {
  heuristicClassify,
  shouldSkipModelClassify,
} from "@/lib/harness/heuristic";
import { readThreadIdFromLocation } from "@/lib/thread-url";
import {
  speechRecognitionSupported,
  startSpeechSession,
  type MicState,
  type SpeechSession,
} from "@/lib/speech";

const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  (!s.thread.isLoading || s.threads.isLoading);

export const Thread: FC = () => {
  const isEmpty = useAuiState(isNewChatView);

  // Empty layout mirrors Figma Make ThreadViewport:
  // one column with justify-center so Welcome + Composer sit together mid-screen.
  return (
    <ThreadPrimitive.Root
      className="flex h-full flex-col bg-[var(--canvas)]"
      style={{
        ["--thread-max-width" as string]: "48rem",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        className="relative flex flex-1 flex-col overflow-x-hidden overflow-y-auto scroll-smooth"
      >
        {!isEmpty && <ThreadHeader />}
        <div
          className={cn(
            "mx-auto flex w-full max-w-[var(--thread-max-width)] flex-1 flex-col px-4 sm:px-6",
            isEmpty ? "justify-center py-12" : "pt-2 sm:pt-4",
          )}
        >
          {isEmpty ? <ThreadWelcome /> : null}

          {!isEmpty && (
            <div className="mb-16 flex flex-col gap-y-8 empty:hidden">
              <ThreadPrimitive.Messages>
                {() => <ThreadMessage />}
              </ThreadPrimitive.Messages>
            </div>
          )}

          <div
            className={cn(
              "flex flex-col gap-2 pb-4 md:pb-6",
              !isEmpty && "sticky bottom-0 mt-auto",
            )}
          >
            {!isEmpty && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 -top-12 h-12 bg-gradient-to-b from-transparent to-[var(--canvas)]"
              />
            )}
            {!isEmpty && <ThreadScrollToBottom />}
            <Composer />
          </div>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);

  if (isEditing) return <EditComposer />;
  if (role === "user") return <UserMessage />;
  return <AssistantMessage />;
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="absolute -top-12 z-10 self-center rounded-full border border-[var(--border)] bg-[var(--surface)] p-2 disabled:invisible"
      >
        <ArrowDownIcon className="size-4" />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

function getWelcomePhrase() {
  const hour = new Date().getHours();
  if (hour < 12) return "Howzit?";
  if (hour < 17) return "we uup";
  return "in the trenches?";
}

const ThreadWelcome: FC = () => {
  const phrase = getWelcomePhrase();

  // Exact structure from Figma Make WelcomeState.
  return (
    <div className="flex w-full flex-col">
      <div className="mb-4 flex size-11 self-center items-center justify-center rounded-full border border-[var(--border)] bg-[var(--elevated)]">
        <Image
          src="/logo.jpg"
          alt="Aether"
          width={36}
          height={36}
          className="size-9 rounded-full object-cover"
        />
      </div>
      <h1
        className="mb-3 font-[family-name:var(--font-serif)] text-[var(--text)]"
        style={{
          fontSize: "clamp(0.95rem, 2.25vw, 1.2rem)",
          fontWeight: 400,
          fontStyle: "italic",
          letterSpacing: "-0.015em",
          lineHeight: 1.18,
          maxWidth: "28rem",
        }}
      >
        {phrase}
      </h1>
    </div>
  );
};

/* ─── Attachment chips ─── */

function AttachmentChips() {
  const { attachments, removeAttachment } = useAttachments();
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-2.5 pb-1">
      {attachments.map((a) => {
        const readable =
          a.kind === "text"
            ? !!a.text
            : !!(a.dataUrl || a.hasPayload);
        return (
          <div
            key={a.id}
            title={
              readable
                ? a.name
                : `${a.name} — attached by name only; model cannot read the content`
            }
            className={cn(
              "group flex max-w-[14rem] items-center gap-1.5 rounded-lg border px-2 py-1 text-xs",
              readable
                ? "border-[var(--border)] bg-[var(--elevated)] text-[var(--text-secondary)]"
                : "border-[var(--error-border)] bg-[var(--error-bg)] text-[var(--error-text)]",
            )}
          >
            {a.kind === "image" ? (
              <ImageIcon className="size-3.5 shrink-0 opacity-70" />
            ) : (
              <FileIcon className="size-3.5 shrink-0 opacity-70" />
            )}
            <span className="truncate">{a.name}</span>
            {!readable && (
              <span className="shrink-0 text-[10px] opacity-80">name only</span>
            )}
            <button
              type="button"
              onClick={() => removeAttachment(a.id)}
              className="ml-0.5 rounded p-0.5 opacity-60 transition-opacity hover:bg-[var(--hover-overlay)] hover:opacity-100"
              aria-label={`Remove ${a.name}`}
            >
              <XIcon className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Composer ─── */

const Composer: FC = () => {
  const { hasKey, setOpenSettings, openConnectedAccounts, chatHeaders } =
    useSettings();
  const { addFiles } = useAttachments();
  const {
    connected: driveConnected,
    authenticated: driveAuthed,
    email: driveEmail,
    setBrowserOpen,
  } = useDrive();
  const {
    pending,
    setPending,
    armChatContext,
    classifying,
    setClassifying,
    setLastPlanSteps,
  } = useHarness();
  const composerRuntime = useComposerRuntime();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [resumeBusy, setResumeBusy] = useState(false);
  const isRunning = useAuiState((s) => s.thread.isRunning);

  // Reset transient state when thread stops running (after send/stop/error)
  useEffect(() => {
    if (!isRunning) {
      const t = setTimeout(() => setErrors([]), 100);
      return () => clearTimeout(t);
    }
  }, [isRunning]);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const errs = await addFiles(files);
    setErrors(errs);
    e.target.value = "";
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!e.dataTransfer.files?.length) return;
    const errs = await addFiles(e.dataTransfer.files);
    setErrors(errs);
  };

  const sendWithHarness = async (opts?: {
    text?: string;
    classification?: HarnessClassification;
    runId?: string;
    clarifications?: Record<string, string>;
    skipClassify?: boolean;
  }) => {
    if (!hasKey || isRunning || classifying || resumeBusy) return;
    const state = composerRuntime.getState();
    const text = (opts?.text ?? state.text).trim();
    if (!text && !state.attachments?.length) return;

    let classification = opts?.classification;
    let runId = opts?.runId;

    if (!opts?.skipClassify && !classification) {
      // Heuristics-first: skip the BYOK model call for cheap shallow turns.
      const heuristic = text ? heuristicClassify(text) : undefined;
      if (heuristic && shouldSkipModelClassify(heuristic)) {
        classification = heuristic;
        runId = crypto.randomUUID();
      } else {
        setClassifying(true);
        try {
          const res = await fetch("/api/harness/classify", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...chatHeaders,
            },
            body: JSON.stringify({
              message: text,
              conversationId: readThreadIdFromLocation() ?? undefined,
            }),
          });
          if (res.ok) {
            const data = (await res.json()) as {
              runId?: string;
              classification?: HarnessClassification;
            };
            classification = data.classification ?? heuristic;
            runId = data.runId;
          } else if (heuristic) {
            classification = heuristic;
            runId = crypto.randomUUID();
          }
        } catch {
          // Fall through with heuristic if available.
          if (heuristic) {
            classification = heuristic;
            runId = crypto.randomUUID();
          }
        } finally {
          setClassifying(false);
        }
      }
    }

    if (
      classification?.needsClarify &&
      (classification.questions?.length ?? 0) > 0 &&
      !opts?.clarifications
    ) {
      setLastPlanSteps(classification.planSteps);
      setPending({
        text,
        runId: runId || crypto.randomUUID(),
        classification,
      });
      return;
    }

    armChatContext({
      intent: classification?.intent ?? "chat",
      depth: classification?.depth ?? "standard",
      runId,
      clarifications: opts?.clarifications,
      planSteps: classification?.planSteps,
    });
    setLastPlanSteps(classification?.planSteps);
    setPending(null);

    if (opts?.text != null) {
      composerRuntime.setText(opts.text);
    }
    if (composerRuntime.getState().canSend) {
      composerRuntime.send();
    }
  };

  const onClarifySubmit = (answers: Record<string, string>) => {
    if (!pending) return;
    setResumeBusy(true);
    void sendWithHarness({
      text: pending.text,
      classification: pending.classification,
      runId: pending.runId,
      clarifications: answers,
      skipClassify: true,
    }).finally(() => setResumeBusy(false));
  };

  const onClarifySkip = () => {
    if (!pending) return;
    setResumeBusy(true);
    void sendWithHarness({
      text: pending.text,
      classification: {
        ...pending.classification,
        needsClarify: false,
        questions: [],
      },
      runId: pending.runId,
      skipClassify: true,
    }).finally(() => setResumeBusy(false));
  };

  const [micState, setMicState] = useState<MicState>("idle");
  const speechRef = useRef<SpeechSession | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const {
    connected: githubConnected,
    connect: connectGitHub,
    githubConfigured,
  } = useGitHub();

  useEffect(() => {
    return () => {
      speechRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!attachOpen) return;
    const close = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest("[data-attach-menu]")) {
        setAttachOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [attachOpen]);

  const handleMic = () => {
    if (micState !== "idle") {
      // stop() finalizes transcript via onFinal/onEnd — don't clear state here.
      speechRef.current?.stop();
      return;
    }
    if (!speechRecognitionSupported()) {
      window.dispatchEvent(
        new CustomEvent("aether:notice", {
          detail: "Speech input isn’t available in this browser.",
        }),
      );
      return;
    }
    // Freeze composer prefix so live partials replace cleanly while listening.
    const prefix = (composerRuntime.getState().text ?? "").trimEnd();
    const applyLive = (spoken: string) => {
      const next = prefix
        ? spoken
          ? `${prefix} ${spoken}`
          : prefix
        : spoken;
      composerRuntime.setText(next);
    };

    setMicState("listening");
    const session = startSpeechSession({
      onPartial: (text) => {
        applyLive(text);
      },
      onFinal: (text) => {
        setMicState("transcribing");
        applyLive(text);
        window.setTimeout(() => setMicState("idle"), 200);
      },
      onError: (message) => {
        window.dispatchEvent(
          new CustomEvent("aether:notice", { detail: message }),
        );
        setMicState("idle");
      },
      onEnd: () => {
        speechRef.current = null;
        setMicState((s) => (s === "listening" || s === "transcribing" ? "idle" : s));
      },
    });
    speechRef.current = session;
  };

  const micPlaceholder =
    micState === "listening"
      ? "Listening…"
      : micState === "transcribing"
        ? "Transcribing…"
        : "How can I help you today?";

  return (
    <ComposerPrimitive.Root className="relative flex w-full flex-col border-0 bg-transparent">
      {!hasKey && (
        <button
          type="button"
          onClick={() => setOpenSettings(true)}
          className="mb-1.5 px-2.5 text-left text-[12px] text-[var(--muted)] hover:text-[var(--text)]"
        >
          Chat isn’t ready yet — open Preferences.
        </button>
      )}

      <AgentStatusStrip />

      {pending && (
        <ClarifyCard
          classification={pending.classification}
          busy={resumeBusy || isRunning}
          onSubmit={onClarifySubmit}
          onSkip={onClarifySkip}
        />
      )}

      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragging(false);
        }}
        onDrop={(e) => void onDrop(e)}
        className={cn(
          "flex w-full flex-col gap-1 rounded-2xl border bg-[var(--elevated)] p-2 transition-colors",
          dragging
            ? "border-[var(--accent)]/50 bg-[var(--accent-muted)]"
            : "border-[var(--border)]",
        )}
      >
        <AttachmentChips />

        {errors.length > 0 && (
          <div className="px-2.5 pb-1 text-xs text-[var(--error-text)]">
            {errors.map((err) => (
              <div key={err}>{err}</div>
            ))}
          </div>
        )}

        <ComposerPrimitive.Input
          placeholder={micPlaceholder}
          className="max-h-40 min-h-[44px] w-full resize-none border-0 bg-transparent px-2.5 py-2 text-[15px] leading-relaxed text-[var(--text)] outline-none placeholder:text-[var(--muted-soft)]"
          rows={1}
          autoFocus
          aria-label="Message input"
          submitMode="none"
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              !classifying &&
              !pending &&
              !isRunning
            ) {
              e.preventDefault();
              void sendWithHarness();
            }
          }}
        />

        <ComposerAction
          onAttachClick={() => fileInputRef.current?.click()}
          attachOpen={attachOpen}
          onAttachMenuToggle={() => setAttachOpen((v) => !v)}
          onDriveClick={() => {
            setAttachOpen(false);
            if (driveConnected) {
              setBrowserOpen(true);
              return;
            }
            openConnectedAccounts();
          }}
          onGitHubClick={() => {
            setAttachOpen(false);
            if (githubConnected) {
              window.dispatchEvent(
                new CustomEvent("aether:notice", {
                  detail: "GitHub is connected.",
                }),
              );
              return;
            }
            if (githubConfigured) connectGitHub();
            else openConnectedAccounts();
          }}
          driveConnected={driveConnected}
          driveAvailable={driveAuthed || driveConnected}
          driveEmail={driveEmail}
          githubConnected={githubConnected}
          githubAvailable={githubConfigured || githubConnected}
          classifying={classifying}
          harnessBlocked={!!pending}
          micState={micState}
          onMicToggle={handleMic}
          onHarnessSend={() => void sendWithHarness()}
        />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.txt,.md,.markdown,.csv,.json,.js,.jsx,.ts,.tsx,.py,.html,.css,.xml,.yaml,.yml,.toml,.sh,.sql,.rs,.go"
        className="hidden"
        onChange={handleFileChange}
      />
    </ComposerPrimitive.Root>
  );
};

const GoogleDriveIcon: FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9.3 2L14.7 2L22 15.5L19.3 20.5L12.7 20.5L9.3 2Z" fill="#0F9D58"/>
    <path d="M9.3 2L2 15.5L4.7 20.5L12 7L9.3 2Z" fill="#4285F4"/>
    <path d="M14.7 2L9.3 2L2 15.5L7.3 15.5L14.7 2Z" fill="#0F9D58"/>
    <path d="M12 7L7.3 15.5L12 15.5L16.7 15.5L12 7Z" fill="#FFC107"/>
    <path d="M12 7L16.7 15.5L22 15.5L12 7Z" fill="#FFC107"/>
  </svg>
);

const GitHubGlyph: FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
  </svg>
);

const ComposerAction: FC<{
  onAttachClick: () => void;
  attachOpen: boolean;
  onAttachMenuToggle: () => void;
  onDriveClick: () => void;
  onGitHubClick: () => void;
  driveConnected: boolean;
  driveAvailable: boolean;
  driveEmail?: string | null;
  githubConnected: boolean;
  githubAvailable: boolean;
  classifying?: boolean;
  harnessBlocked?: boolean;
  micState: MicState;
  onMicToggle: () => void;
  onHarnessSend: () => void;
}> = ({
  onAttachClick,
  attachOpen,
  onAttachMenuToggle,
  onDriveClick,
  onGitHubClick,
  driveConnected,
  driveAvailable,
  driveEmail,
  githubConnected,
  githubAvailable,
  classifying,
  harnessBlocked,
  micState,
  onMicToggle,
  onHarnessSend,
}) => {
  const micLabel =
    micState === "idle"
      ? "Speak"
      : micState === "listening"
        ? "Stop listening"
        : "Transcribing…";

  return (
    <div className="flex items-center justify-between gap-2 px-0.5">
      <div className="flex items-center gap-1">
        <div className="relative" data-attach-menu>
          <TooltipIconButton
            tooltip="Attach"
            onClick={onAttachMenuToggle}
            className="size-7"
            aria-haspopup="menu"
            aria-expanded={attachOpen}
          >
            <PaperclipIcon className="size-4" />
          </TooltipIconButton>
          {attachOpen && (
            <div
              className="absolute bottom-full left-0 z-50 mb-2 w-52 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--elevated-deep)] p-1 shadow-lg animate-[fadeIn_140ms_ease-out]"
              role="menu"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onAttachClick();
                  onAttachMenuToggle();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--hover-overlay)]"
              >
                <FileIcon className="size-4 text-[var(--muted)]" />
                Upload files
              </button>
              {(driveAvailable || githubAvailable) && (
                <div className="px-2 pb-1.5 pt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted-soft)]">
                  {driveConnected || githubConnected
                    ? "Add from"
                    : "Connect"}
                </div>
              )}
              {driveAvailable && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={onDriveClick}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--hover-overlay)]"
                >
                  <GoogleDriveIcon className="size-4" />
                  <span className="flex-1 text-[12px] font-medium text-[var(--text)]">
                    Google Drive
                  </span>
                  {driveConnected ? (
                    <CheckIcon className="size-3.5 text-[var(--muted)]" />
                  ) : (
                    <span className="text-[10px] text-[var(--muted-soft)]">
                      Connect
                    </span>
                  )}
                </button>
              )}
              {githubAvailable && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={onGitHubClick}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--hover-overlay)]"
                >
                  <GitHubGlyph className="size-4 text-[var(--muted)]" />
                  <span className="flex-1 text-[12px] font-medium text-[var(--text)]">
                    GitHub
                  </span>
                  {githubConnected ? (
                    <CheckIcon className="size-3.5 text-[var(--muted)]" />
                  ) : (
                    <span className="text-[10px] text-[var(--muted-soft)]">
                      Connect
                    </span>
                  )}
                </button>
              )}
              {driveConnected && driveEmail ? (
                <div className="truncate px-2.5 pb-1.5 pt-0.5 text-[10px] text-[var(--muted-soft)]">
                  {driveEmail}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <ModelPicker />
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onMicToggle}
          aria-label={micLabel}
          title={micLabel}
          className={cn(
            "relative flex size-8 items-center justify-center rounded-full transition-colors",
            micState !== "idle"
              ? "bg-[var(--accent)] text-white"
              : "text-[var(--muted)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text)]",
          )}
        >
          {micState === "transcribing" ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <MicIcon className="size-4" />
          )}
          {micState === "listening" && (
            <span className="absolute inset-0 animate-ping rounded-full bg-[var(--accent)] opacity-35" />
          )}
        </button>

        <AuiIf condition={(s) => !s.thread.isRunning}>
          <button
            type="button"
            onClick={onHarnessSend}
            disabled={!!classifying || !!harnessBlocked}
            className="flex size-8 items-center justify-center rounded-full bg-[var(--accent)] text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40"
            aria-label={classifying ? "Planning…" : "Send message"}
            title={classifying ? "Planning…" : "Send"}
          >
            {classifying ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <ArrowUpIcon className="size-4" strokeWidth={2.5} />
            )}
          </button>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <button
              type="button"
              className="flex h-8 items-center gap-2 rounded-full bg-[var(--text)] px-3 text-[var(--canvas)] transition-opacity hover:opacity-80"
              aria-label="Stop generating"
            >
              <SquareIcon className="size-3 fill-current" />
              <span className="text-[13px] font-medium">Stop</span>
            </button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="mt-2 rounded-xl border border-[var(--error-border)] bg-[var(--error-bg)] p-3 text-sm text-[var(--error-text)]">
        <ErrorPrimitive.Message className="line-clamp-3" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-role="assistant"
      className="group/message relative animate-[fadeIn_150ms_ease-out]"
    >
      <div
        className={cn(
          "px-1 text-[var(--text)]",
          "font-[family-name:var(--font-serif)] text-[19px] leading-[1.72] tracking-[-0.01em]",
          "[&_.prose-aether]:font-[family-name:var(--font-serif)]",
        )}
      >
        <MessagePrimitive.Parts>
          {({ part }) => {
            if (part.type === "text") return <MarkdownText />;
            if (part.type === "tool-call")
              return <ToolCallPart part={part as unknown as ToolPartLike} />;
            return null;
          }}
        </MessagePrimitive.Parts>
        <AuiIf
          condition={(s) =>
            s.message.status?.type === "running" && s.message.parts.length === 0
          }
        >
          <span
            className="inline-block size-2 animate-pulse rounded-full bg-[var(--accent)]"
            aria-label="Generating"
          />
        </AuiIf>
        <MessageError />
      </div>

      <div className="mt-1.5 flex min-h-8 items-center gap-1 opacity-100 transition-opacity duration-150 md:opacity-0 md:group-hover/message:opacity-100 md:focus-within:opacity-100 data-[running=true]:opacity-0">
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="flex items-center gap-0.5 text-[var(--muted)]"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon className="size-3.5 text-emerald-600" />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon className="size-3.5" />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Retry">
          <RefreshCwIcon className="size-3.5" />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <RestoreToHereButton />
    </ActionBarPrimitive.Root>
  );
};

const RestoreToHereButton: FC = () => {
  const threadRuntime = useThreadRuntime();
  const messageId = useAuiState((s) => s.message.id);
  const msgsAfter = useAuiState((s) => {
    const messages = s.thread.messages;
    const idx = messages.findIndex((m) => m.id === s.message.id);
    if (idx < 0) return 0;
    return messages.length - idx - 1;
  });
  const [confirm, setConfirm] = useState(false);

  if (msgsAfter <= 0) return null;

  if (confirm) {
    return (
      <div className="ml-1 flex items-center gap-2 rounded-lg bg-[var(--surface)] px-2.5 py-1.5 text-[12px] text-[var(--muted)]">
        <span>
          Remove {msgsAfter} message{msgsAfter > 1 ? "s" : ""} after this?
        </span>
        <button
          type="button"
          onClick={() => setConfirm(false)}
          className="rounded-md px-1.5 py-0.5 hover:text-[var(--text)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            const messages = threadRuntime.getState().messages;
            const idx = messages.findIndex((m) => m.id === messageId);
            if (idx < 0) {
              setConfirm(false);
              return;
            }
            const kept = messages.slice(0, idx + 1);
            threadRuntime.import(ExportedMessageRepository.fromArray(kept));
            setConfirm(false);
            window.dispatchEvent(
              new CustomEvent("aether:notice", { detail: "Reverted." }),
            );
          }}
          className="rounded-md bg-[var(--danger)] px-1.5 py-0.5 font-medium text-white"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <TooltipIconButton
      tooltip="Restore to here"
      onClick={() => setConfirm(true)}
    >
      <RotateCcwIcon className="size-3.5" />
    </TooltipIconButton>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-role="user"
      className="group/message flex animate-[fadeIn_150ms_ease-out] flex-col items-end gap-1"
    >
      <div className="relative max-w-[85%] sm:max-w-[80%]">
        <div className="rounded-2xl rounded-br-md bg-[var(--elevated-deep)] px-4 py-2.5 text-[15px] leading-relaxed text-[var(--text)] wrap-break-word">
          <MessagePrimitive.Parts />
        </div>
        <div className="absolute -left-16 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-100 transition-opacity max-sm:static max-sm:mt-1 max-sm:translate-y-0 md:opacity-0 md:group-hover/message:opacity-100">
          <UserActionBar />
        </div>
      </div>
      <BranchPicker className="justify-end" />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="flex items-center"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon className="size-3.5 text-emerald-600" />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon className="size-3.5" />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit & resend">
          <PencilIcon className="size-3.5" />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
      <RestoreToHereButton />
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root className="flex flex-col items-end">
      <ComposerPrimitive.Root className="flex w-full max-w-[85%] flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] sm:max-w-[80%]">
        <ComposerPrimitive.Input
          className="min-h-14 w-full resize-none border-0 bg-transparent px-4 pb-1 pt-3 text-[15px] text-[var(--text)] outline-none"
          autoFocus
        />
        <div className="mb-2.5 me-2.5 flex items-center gap-1.5 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm" className="h-8 rounded-full px-3.5">
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm" className="h-8 rounded-full px-3.5">
              Resend
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "inline-flex items-center text-xs text-[var(--muted)]",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous" className="size-6">
          <ChevronLeftIcon className="size-3.5" />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="px-0.5 font-medium tabular-nums">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next" className="size-6">
          <ChevronRightIcon className="size-3.5" />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
