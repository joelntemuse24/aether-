"use client";

import Image from "next/image";
import { useCallback, useRef, useState, type FC } from "react";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { ModelPicker } from "@/components/model-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useSettings } from "@/providers/settings-provider";
import { useAttachments } from "@/providers/attachments-provider";
import type { PendingAttachment } from "@/lib/attachments";
import {
  loadGoogleApis,
  requestAccessToken,
  openPicker,
  downloadDriveFile,
} from "@/lib/google-drive";
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
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  FileIcon,
  HardDriveIcon,
  ImageIcon,
  PaperclipIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  XIcon,
} from "lucide-react";

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
        <div
          className={cn(
            "mx-auto flex w-full max-w-[var(--thread-max-width)] flex-1 flex-col px-4 pt-6 sm:px-6",
            isEmpty && "justify-center",
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
    <div className="mb-10 flex flex-col items-center px-4 text-center">
      <Image
        src="/logo.jpg"
        alt="Aether"
        width={56}
        height={56}
        className="mb-6 rounded-full object-cover"
      />
      <h1
        className="font-[family-name:var(--font-serif)] text-[var(--text)]"
        style={{
          fontSize: "clamp(1.9rem, 4vw, 2.4rem)",
          fontWeight: 400,
          fontStyle: "italic",
          letterSpacing: "-0.015em",
          lineHeight: 1.2,
          maxWidth: "26rem",
        }}
      >
        How can I help you today?
      </h1>
      <div className="mt-3">
        <Label>Ask anything</Label>
      </div>
    </div>
  );
};

/* ─── Attachment chips ─── */

function AttachmentChips() {
  const { attachments, removeAttachment } = useAttachments();
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-2.5 pb-1">
      {attachments.map((a) => (
        <div
          key={a.id}
          className="group flex max-w-[14rem] items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--elevated)] px-2 py-1 text-xs text-[var(--text-secondary)]"
        >
          {a.kind === "image" ? (
            <ImageIcon className="size-3.5 shrink-0 text-[var(--muted)]" />
          ) : (
            <FileIcon className="size-3.5 shrink-0 text-[var(--muted)]" />
          )}
          <span className="truncate">{a.name}</span>
          <button
            type="button"
            onClick={() => removeAttachment(a.id)}
            className="ml-0.5 rounded p-0.5 text-[var(--muted)] opacity-60 transition-opacity hover:bg-[var(--hover-overlay)] hover:opacity-100"
            aria-label={`Remove ${a.name}`}
          >
            <XIcon className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

/* ─── Composer ─── */

const Composer: FC = () => {
  const { hasKey, setOpenSettings, settings } = useSettings();
  const { addFiles, clearAttachments } = useAttachments();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const errs = await addFiles(files);
    setErrors(errs);
    e.target.value = "";
  };

  const handleDriveClick = useCallback(async () => {
    const clientId = settings.googleClientId?.trim();
    if (!clientId) {
      setErrors(["Add a Google Client ID in Settings to use Drive."]);
      setOpenSettings(true);
      return;
    }

    if (driveLoading) return;
    setDriveLoading(true);
    setErrors([]);

    const safetyTimer = window.setTimeout(() => {
      setDriveLoading(false);
    }, 30_000);

    const finish = () => {
      window.clearTimeout(safetyTimer);
      setDriveLoading(false);
    };

    try {
      await loadGoogleApis();

      requestAccessToken(clientId, (accessToken) => {
        openPicker(
          accessToken,
          async (docs) => {
            try {
              if (!docs.length) {
                finish();
                return;
              }

              const newAttachments: PendingAttachment[] = [];
              const downloadErrors: string[] = [];

              for (const doc of docs) {
                const result = await downloadDriveFile(
                  doc.id,
                  doc.name,
                  doc.mimeType,
                  accessToken,
                );
                if (result.attachment) {
                  newAttachments.push(result.attachment);
                }
                if (result.error) {
                  downloadErrors.push(result.error);
                }
              }

              if (newAttachments.length > 0) {
                window.dispatchEvent(
                  new CustomEvent("aether:add-attachments", {
                    detail: newAttachments,
                  }),
                );
              }

              if (downloadErrors.length > 0) {
                setErrors(downloadErrors);
              } else if (newAttachments.length === 0) {
                setErrors([
                  "Could not download the selected file(s). Check the browser console for details.",
                ]);
              }
            } catch (err) {
              console.error("[drive] download", err);
              setErrors([
                err instanceof Error
                  ? err.message
                  : "Failed to download files from Drive.",
              ]);
            } finally {
              finish();
            }
          },
          () => {
            finish();
          },
        );
      });
    } catch (err) {
      console.error("[drive]", err);
      setErrors([
        "Could not open Google Drive. Check your Client ID and try again.",
      ]);
      finish();
    }
  }, [settings.googleClientId, setOpenSettings, driveLoading]);

  return (
    <ComposerPrimitive.Root className="relative flex w-full flex-col border-0 bg-transparent">
      {!hasKey && (
        <button
          type="button"
          onClick={() => setOpenSettings(true)}
          className="mb-2 rounded-xl border border-[var(--border)] bg-[var(--elevated)] px-3 py-2 text-left text-xs text-[var(--muted)] hover:bg-[var(--elevated-deep)]"
        >
          Add an API key in Settings to start chatting →
        </button>
      )}

      <div className="flex w-full flex-col gap-1 border-0 bg-transparent p-2">
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
        />

        <ComposerAction
          onAttachClick={() => fileInputRef.current?.click()}
          onDriveClick={handleDriveClick}
          driveLoading={driveLoading}
          onBeforeSend={() => {
            setTimeout(() => clearAttachments(), 400);
            setErrors([]);
          }}
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

const ComposerAction: FC<{
  onAttachClick: () => void;
  onDriveClick: () => void;
  driveLoading: boolean;
  onBeforeSend: () => void;
}> = ({ onAttachClick, onDriveClick, driveLoading, onBeforeSend }) => {
  return (
    <div className="flex items-center justify-between gap-2 px-0.5">
      <div className="flex items-center gap-0.5">
        <TooltipIconButton
          tooltip="Attach files"
          onClick={onAttachClick}
          className="size-7"
        >
          <PaperclipIcon className="size-3.5" />
        </TooltipIconButton>
        <TooltipIconButton
          tooltip={driveLoading ? "Opening Drive…" : "Google Drive"}
          onClick={onDriveClick}
          disabled={driveLoading}
          className="size-7"
        >
          <HardDriveIcon
            className={cn("size-3.5", driveLoading && "animate-pulse")}
          />
        </TooltipIconButton>
        <ModelPicker />
      </div>

      <div className="flex items-center gap-1">
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <button
              type="button"
              onClick={onBeforeSend}
              className="flex size-8 items-center justify-center rounded-full bg-[var(--accent)] text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-40"
              aria-label="Send message"
            >
              <ArrowUpIcon className="size-4" strokeWidth={2.5} />
            </button>
          </ComposerPrimitive.Send>
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

      <div className="mt-1.5 flex min-h-8 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/message:opacity-100 focus-within:opacity-100 data-[running=true]:opacity-0">
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
        <TooltipIconButton tooltip="Regenerate">
          <RefreshCwIcon className="size-3.5" />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <ActionBarPrimitive.FeedbackPositive asChild>
        <TooltipIconButton tooltip="Good response">
          <ThumbsUpIcon className="size-3.5" />
        </TooltipIconButton>
      </ActionBarPrimitive.FeedbackPositive>
      <ActionBarPrimitive.FeedbackNegative asChild>
        <TooltipIconButton tooltip="Bad response">
          <ThumbsDownIcon className="size-3.5" />
        </TooltipIconButton>
      </ActionBarPrimitive.FeedbackNegative>
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
        <div className="absolute -left-9 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/message:opacity-100">
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
