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
import { STARTER_PROMPTS } from "@/lib/voice";
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
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useComposerRuntime,
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
  PaperclipIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  XIcon,
} from "lucide-react";
import { ClarifyCard } from "@/components/assistant-ui/clarify-card";
import { useHarness } from "@/providers/harness-provider";
import type { HarnessClassification } from "@/lib/harness/types";
import {
  heuristicClassify,
  shouldSkipModelClassify,
} from "@/lib/harness/heuristic";
import { readThreadIdFromLocation } from "@/lib/thread-url";

const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  (!s.thread.isLoading || s.threads.isLoading);

export const Thread: FC = () => {
  const isEmpty = useAuiState(isNewChatView);

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
        <ThreadHeader />
        <div
          className={cn(
            "mx-auto flex w-full max-w-[var(--thread-max-width)] flex-1 flex-col px-4 pt-2 sm:px-6 sm:pt-4",
            isEmpty && "justify-center pt-6",
          )}
        >
          <AuiIf condition={isNewChatView}>
            <ThreadWelcome />
          </AuiIf>

          <div className="mb-16 flex flex-col gap-y-8 empty:hidden">
            <ThreadPrimitive.Messages>
              {() => <ThreadMessage />}
            </ThreadPrimitive.Messages>
          </div>

          <ThreadPrimitive.ViewportFooter
            className={cn(
              "flex flex-col gap-3 overflow-visible pb-4 md:pb-6",
              !isEmpty && "sticky bottom-0 mt-auto",
            )}
          >
            {!isEmpty && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 -top-12 h-12 bg-gradient-to-b from-transparent to-[var(--canvas)]"
              />
            )}
            <ThreadScrollToBottom />
            <Composer />
          </ThreadPrimitive.ViewportFooter>
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

const ThreadWelcome: FC = () => {
  return (
    <div className="mb-8 flex flex-col items-center px-2 text-center sm:mb-10">
      <Image
        src="/logo.jpg"
        alt="Aether"
        width={56}
        height={56}
        className="mb-5 rounded-full object-cover shadow-[0_0_0_1px_var(--border)]"
      />
      <h1
        className="font-[family-name:var(--font-serif)] text-[var(--text)]"
        style={{
          fontSize: "clamp(1.85rem, 4vw, 2.35rem)",
          fontWeight: 400,
          fontStyle: "italic",
          letterSpacing: "-0.015em",
          lineHeight: 1.2,
          maxWidth: "28rem",
        }}
      >
        Think with me.
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-[var(--muted)]">
        Essays, close readings, research, and living documents — with tools when
        the work needs them.
      </p>

      <div className="mt-8 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
        {STARTER_PROMPTS.map((starter) => (
          <ThreadPrimitive.Suggestion
            key={starter.id}
            prompt={starter.prompt}
            send
            className="group flex flex-col items-start gap-1 rounded-xl border border-[var(--border)] bg-[var(--elevated)]/60 px-3.5 py-3 text-left transition-colors hover:border-[var(--accent)]/35 hover:bg-[var(--accent-muted)]"
          >
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--muted-soft)]">
              {starter.category}
            </span>
            <span className="text-[13px] leading-snug text-[var(--text-secondary)] group-hover:text-[var(--text)]">
              {starter.label}
            </span>
          </ThreadPrimitive.Suggestion>
        ))}
      </div>

      <p className="mt-5 text-[11px] tracking-wide text-[var(--muted-soft)]">
        <kbd className="rounded border border-[var(--border)] bg-[var(--elevated)] px-1 py-0.5 font-[family-name:var(--font-mono)] text-[10px]">
          ⌘N
        </kbd>{" "}
        new ·{" "}
        <kbd className="rounded border border-[var(--border)] bg-[var(--elevated)] px-1 py-0.5 font-[family-name:var(--font-mono)] text-[10px]">
          ⌘K
        </kbd>{" "}
        focus ·{" "}
        <kbd className="rounded border border-[var(--border)] bg-[var(--elevated)] px-1 py-0.5 font-[family-name:var(--font-mono)] text-[10px]">
          ⌘,
        </kbd>{" "}
        settings
      </p>
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

  return (
    <ComposerPrimitive.Root className="relative flex w-full flex-col border-0 bg-transparent">
      {!hasKey && (
        <button
          type="button"
          onClick={() => setOpenSettings(true)}
          className="mb-2 rounded-xl border border-[var(--border)] bg-[var(--elevated)] px-3 py-2 text-left text-xs text-[var(--muted)] hover:bg-[var(--elevated-deep)]"
        >
          Open Settings to enable Aether Cloud or add your own API key →
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
          placeholder="How can I help you today?"
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
          onDriveClick={() => {
            if (driveConnected) {
              setBrowserOpen(true);
              return;
            }
            openConnectedAccounts();
          }}
          driveConnected={driveConnected}
          driveAvailable={driveAuthed || driveConnected}
          driveEmail={driveEmail}
          classifying={classifying}
          harnessBlocked={!!pending}
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

const ComposerAction: FC<{
  onAttachClick: () => void;
  onDriveClick: () => void;
  driveConnected: boolean;
  driveAvailable: boolean;
  driveEmail?: string | null;
  classifying?: boolean;
  harnessBlocked?: boolean;
  onHarnessSend: () => void;
}> = ({
  onAttachClick,
  onDriveClick,
  driveConnected,
  driveAvailable,
  driveEmail,
  classifying,
  harnessBlocked,
  onHarnessSend,
}) => {
  return (
    <div className="flex items-center justify-between gap-2 px-0.5">
      <div className="flex items-center gap-1">
        <TooltipIconButton
          tooltip="Attach files"
          onClick={onAttachClick}
          className="size-7"
        >
          <PaperclipIcon className="size-3.5" />
        </TooltipIconButton>

        {driveConnected ? (
          <TooltipIconButton
            tooltip={
              driveEmail ? `Google Drive · ${driveEmail}` : "Google Drive"
            }
            onClick={onDriveClick}
            className="size-7"
          >
            <GoogleDriveIcon className="size-4" />
          </TooltipIconButton>
        ) : driveAvailable ? (
          <TooltipIconButton
            tooltip="Connect Google Drive in Settings"
            onClick={onDriveClick}
            className="size-7 opacity-70"
          >
            <GoogleDriveIcon className="size-4 grayscale" />
          </TooltipIconButton>
        ) : null}

        <ModelPicker />
      </div>

      <div className="flex items-center gap-1">
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
              className="flex size-8 items-center justify-center rounded-full bg-[var(--text)] text-white transition-opacity hover:opacity-90"
              aria-label="Stop generating"
            >
              <SquareIcon className="size-3 fill-current" />
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
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);

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
        <TooltipIconButton tooltip="Regenerate">
          <RefreshCwIcon className="size-3.5" />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <TooltipIconButton
        tooltip={feedback === "up" ? "Thanks" : "Good response"}
        onClick={() => {
          setFeedback("up");
          window.dispatchEvent(
            new CustomEvent("aether:notice", {
              detail: "Thanks — noted for this response.",
            }),
          );
        }}
        className={feedback === "up" ? "text-[var(--accent)]" : undefined}
      >
        <ThumbsUpIcon className="size-3.5" />
      </TooltipIconButton>
      <TooltipIconButton
        tooltip={feedback === "down" ? "Noted" : "Bad response"}
        onClick={() => {
          setFeedback("down");
          window.dispatchEvent(
            new CustomEvent("aether:notice", {
              detail: "Thanks — we'll use that to improve.",
            }),
          );
        }}
        className={feedback === "down" ? "text-[var(--accent)]" : undefined}
      >
        <ThumbsDownIcon className="size-3.5" />
      </TooltipIconButton>
    </ActionBarPrimitive.Root>
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
        <TooltipIconButton tooltip="Edit">
          <PencilIcon className="size-3.5" />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
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
              Update
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
