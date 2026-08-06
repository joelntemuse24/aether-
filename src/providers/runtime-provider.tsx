"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AssistantRuntimeProvider,
  useAui,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import {
  AssistantChatTransport,
  useAISDKRuntime,
} from "@assistant-ui/react-ai-sdk";
import { useChat, type UIMessage } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import {
  createAetherThreadListAdapter,
  ACTIVE_THREAD_KEY,
  loadThreadUIMessages,
  loadThreadUIMessagesAsync,
  persistThreadUIMessages,
  announceThreadSwitch,
} from "@/lib/local-thread-adapter";
import { readThreadIdFromLocation } from "@/lib/thread-url";
import { useSettings } from "./settings-provider";
import { useAttachments } from "./attachments-provider";
import { buildTextAttachmentPrefix } from "@/lib/attachments";
import { getAttachmentPayload } from "@/lib/attachment-payloads";
import { resolveVoicePrompt } from "@/lib/voice";
import { runPython } from "@/lib/pyodide";
import { TOOL_NAMES, type ExecutePythonInput } from "@/lib/tools";
import { useHarness } from "./harness-provider";
import { useProjects } from "./projects-provider";
import { localMemoryContextForChat } from "@/lib/memory/local";
import {
  CONTINUE_USER_TEXT,
  MAX_AUTO_CONTINUES,
  hasContinuableAssistant,
  isServerTimeoutError,
  shouldAutoContinue,
} from "@/lib/chat-continue";
import type { HarnessChatContext } from "@/lib/harness/types";

function loadInitialThreadIdFromUrl(): string | undefined {
  // Only the URL selects the chat on boot. Bare `/` is always a new conversation.
  return readThreadIdFromLocation();
}

function saveActiveThreadId(threadId: string) {
  if (typeof window === "undefined") return;
  try {
    const prev = localStorage.getItem(ACTIVE_THREAD_KEY);
    if (prev === threadId) return;
    localStorage.setItem(ACTIVE_THREAD_KEY, threadId);
    // Only a real leave A→B (sidebar / deep link). First id on a blank chat
    // has no prev (cleared by beginNewChatSession) and must not wipe attaches.
    if (prev && prev !== threadId) {
      announceThreadSwitch();
    }
  } catch {
    // ignore quota / private mode
  }
}

function readThreadStorageKey(aui: ReturnType<typeof useAui>): string | undefined {
  if (!aui.threadListItem.source) return undefined;
  const state = aui.threadListItem().getState();
  if (state.remoteId) return state.remoteId;
  if (state.status !== "new") return state.id;
  return undefined;
}

type AddToolResult = (result: {
  tool: string;
  toolCallId: string;
  output: unknown;
}) => void;

function useChatThreadRuntime() {
  const { chatHeaders, activeModel, hasKey, settings } = useSettings();
  const { attachments, clearAttachments } = useAttachments();
  const { peekChatContext, clearChatContext, armChatContext } = useHarness();
  const { activeProjectId } = useProjects();
  const aui = useAui();
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const voiceRef = useRef(settings.voice);
  voiceRef.current = settings.voice;
  const peekHarnessRef = useRef(peekChatContext);
  peekHarnessRef.current = peekChatContext;
  const armHarnessRef = useRef(armChatContext);
  armHarnessRef.current = armChatContext;
  const projectIdRef = useRef(activeProjectId);
  projectIdRef.current = activeProjectId;
  const threadIdRef = useRef<string | undefined>(undefined);
  threadIdRef.current = readThreadStorageKey(aui) ?? readThreadIdFromLocation();

  // Each remote-thread runtime instance mounts for one thread. Seed that
  // thread's useChat from localStorage so refresh/switch don't depend on
  // assistant-ui's one-shot useExternalHistory (which often skips load).
  // Prefer URL id when the list item isn't bound yet — cuts empty-frame flash.
  const [seedMessages] = useState<UIMessage[]>(() => {
    const key =
      readThreadStorageKey(aui) ?? readThreadIdFromLocation() ?? undefined;
    return key ? loadThreadUIMessages(key) : [];
  });

  const continueSegmentRef = useRef(false);
  const continueCountRef = useRef(0);
  const continueScheduledRef = useRef(false);
  /** User should see Continue — set when auto-continue budget is exhausted or skipped. */
  const needsContinueRef = useRef(false);
  const lastHarnessRef = useRef<HarnessChatContext | null>(null);
  const runStartedAtRef = useRef<number | null>(null);

  // Rebuild transport only when provider/model headers change — not on every
  // attach. body() reads the latest attachments via ref at send time.
  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        api: "/api/chat",
        headers: () => chatHeaders,
        body: () => {
          const current = attachmentsRef.current;
          const fileAttachments = current
            .map((a) => {
              const dataUrl =
                a.dataUrl ??
                (a.hasPayload || a.kind === "image" || a.kind === "file"
                  ? getAttachmentPayload(a.id)
                  : undefined);
              if (!dataUrl) return null;
              if (a.kind !== "image" && a.kind !== "file") return null;
              return { name: a.name, mime: a.mime, dataUrl };
            })
            .filter((a): a is { name: string; mime: string; dataUrl: string } =>
              a !== null,
            );

          const textPrefix = buildTextAttachmentPrefix(current);
          const harness = peekHarnessRef.current();
          if (harness) lastHarnessRef.current = harness;
          const memoryContext = localMemoryContextForChat();
          const continueSegment = continueSegmentRef.current;

          return {
            model: activeModel,
            attachments: fileAttachments,
            textPrefix: textPrefix || undefined,
            system: resolveVoicePrompt(voiceRef.current),
            harness: harness ?? lastHarnessRef.current ?? undefined,
            memoryContext: memoryContext || undefined,
            projectId: projectIdRef.current ?? undefined,
            conversationId: threadIdRef.current ?? undefined,
            continueSegment: continueSegment || undefined,
          };
        },
      }),
    [chatHeaders, activeModel],
  );

  const addToolResultRef = useRef<AddToolResult | null>(null);
  const messagesRef = useRef<UIMessage[]>(seedMessages);
  const statusRef = useRef<string>("ready");
  const errorRef = useRef<Error | undefined>(undefined);
  const chatApiRef = useRef<{
    sendMessage: (msg: { text: string }) => Promise<void>;
    regenerate?: () => Promise<void>;
    clearError?: () => void;
  } | null>(null);

  const emitContinueStatus = useCallback(
    (detail: {
      phase: "idle" | "continuing" | "needs-continue";
      segment?: number;
      max?: number;
      reason?: string;
    }) => {
      needsContinueRef.current = detail.phase === "needs-continue";
      window.dispatchEvent(
        new CustomEvent("aether:continue-status", { detail }),
      );
    },
    [],
  );

  const scheduleAutoContinue = useCallback((reason: string) => {
    if (continueScheduledRef.current) return false;
    if (continueCountRef.current >= MAX_AUTO_CONTINUES) return false;

    continueScheduledRef.current = true;
    continueCountRef.current += 1;
    const segment = continueCountRef.current;

    // Quiet status lives in AgentStatusStrip ("Continuing… n/max") — no toast pile.
    emitContinueStatus({
      phase: "continuing",
      segment,
      max: MAX_AUTO_CONTINUES,
    });
    console.info("[chat] auto-continue scheduled", { reason, segment });

    window.setTimeout(() => {
      const api = chatApiRef.current;
      if (!api) {
        continueScheduledRef.current = false;
        emitContinueStatus({ phase: "idle" });
        return;
      }
      continueSegmentRef.current = true;
      if (lastHarnessRef.current) {
        armHarnessRef.current(lastHarnessRef.current);
      }
      try {
        api.clearError?.();
      } catch {
        // ignore
      }
      void api
        .sendMessage({ text: CONTINUE_USER_TEXT })
        .catch((err) => {
          console.error("[chat] auto-continue failed", err);
          continueSegmentRef.current = false;
          continueScheduledRef.current = false;
          emitContinueStatus({ phase: "idle" });
          window.dispatchEvent(
            new CustomEvent("aether:notice", {
              detail:
                "Could not auto-continue. Click Continue on the message to resume.",
            }),
          );
        });
    }, 280);

    return true;
  }, [emitContinueStatus]);

  const chat = useChat({
    messages: seedMessages,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: async ({ toolCall }) => {
      if (toolCall.toolName !== TOOL_NAMES.executePython) return;
      const add = addToolResultRef.current;
      if (!add) return;

      const { code } = toolCall.input as ExecutePythonInput;
      const output = await runPython(code);
      add({
        tool: TOOL_NAMES.executePython,
        toolCallId: toolCall.toolCallId,
        output,
      });
    },
    onError: (error) => {
      console.error("[chat]", error);
      const key = threadIdRef.current;
      if (key && messagesRef.current.length > 0) {
        persistThreadUIMessages(key, messagesRef.current);
      }

      const runDurationMs =
        runStartedAtRef.current != null
          ? Date.now() - runStartedAtRef.current
          : 0;
      const continuing =
        continueScheduledRef.current ||
        (shouldAutoContinue({
          isAbort: false,
          isDisconnect: false,
          isError: true,
          error,
          messages: messagesRef.current,
          runDurationMs,
          continueCount: continueCountRef.current,
        }) &&
          scheduleAutoContinue("onError"));
      if (continuing) return;

      const timeoutish = shouldAutoContinue({
        isAbort: false,
        isDisconnect: false,
        isError: true,
        error,
        messages: messagesRef.current,
        runDurationMs,
        // Probe as if we still had budget — surfaces the Continue CTA.
        continueCount: 0,
      });
      emitContinueStatus(
        timeoutish || isServerTimeoutError(error)
          ? {
              phase: "needs-continue",
              reason: "timeout",
              segment: continueCountRef.current,
              max: MAX_AUTO_CONTINUES,
            }
          : { phase: "idle" },
      );
      clearChatContext();
      // Timeouts surface Continue in-thread — skip toast pile for those.
      if (timeoutish || isServerTimeoutError(error)) return;
      void import("@/lib/chat-errors").then(({ friendlyChatError }) => {
        const detail = friendlyChatError(error);
        if (!detail) return;
        window.dispatchEvent(
          new CustomEvent("aether:notice", {
            detail,
          }),
        );
      });
    },
    onFinish: ({ isAbort, isDisconnect, isError }) => {
      const key = threadIdRef.current;
      if (key && messagesRef.current.length > 0) {
        persistThreadUIMessages(key, messagesRef.current);
      }

      const runDurationMs =
        runStartedAtRef.current != null
          ? Date.now() - runStartedAtRef.current
          : 0;

      // End of this segment — next sendMessage sets the flag again if needed.
      continueSegmentRef.current = false;

      const continuing =
        continueScheduledRef.current ||
        (shouldAutoContinue({
          isAbort,
          isDisconnect,
          isError,
          error: errorRef.current,
          messages: messagesRef.current,
          runDurationMs,
          continueCount: continueCountRef.current,
        }) &&
          scheduleAutoContinue(
            isDisconnect ? "onFinish:disconnect" : "onFinish:error",
          ));
      if (continuing) return;

      // Only offer Continue when the run actually failed/cut off — not after
      // a successful long reply (runDuration alone is not a signal).
      const offerContinue =
        !isAbort &&
        hasContinuableAssistant(messagesRef.current) &&
        (isDisconnect ||
          isError ||
          isServerTimeoutError(errorRef.current));
      emitContinueStatus(
        offerContinue
          ? {
              phase: "needs-continue",
              reason: isDisconnect ? "disconnect" : "timeout",
              segment: continueCountRef.current,
              max: MAX_AUTO_CONTINUES,
            }
          : { phase: "idle" },
      );

      if (!isAbort && !isDisconnect && !isError) {
        continueCountRef.current = 0;
        lastHarnessRef.current = null;
      }
      if (isAbort) {
        continueCountRef.current = 0;
      }

      clearAttachments();
      clearChatContext();
      runStartedAtRef.current = null;
    },
  });

  addToolResultRef.current = chat.addToolResult as unknown as AddToolResult;
  chatApiRef.current = {
    sendMessage: (msg) => chat.sendMessage(msg),
    regenerate: () => chat.regenerate(),
    clearError: () => {
      const withClear = chat as typeof chat & { clearError?: () => void };
      withClear.clearError?.();
    },
  };

  const { messages, setMessages, status, error } = chat;
  messagesRef.current = messages;
  statusRef.current = status;
  errorRef.current = error;

  const loadedKeyRef = useRef<string | null>(
    seedMessages.length > 0
      ? (readThreadStorageKey(aui) ?? readThreadIdFromLocation() ?? null)
      : null,
  );

  // Late remoteId (after initialize): pull history once.
  useEffect(() => {
    const key = readThreadStorageKey(aui);
    if (!key || loadedKeyRef.current === key) return;
    if (messages.length > 0) {
      loadedKeyRef.current = key;
      return;
    }
    let cancelled = false;
    void loadThreadUIMessagesAsync(key).then((stored) => {
      if (cancelled || stored.length === 0) return;
      loadedKeyRef.current = key;
      setMessages(stored);
    });
    return () => {
      cancelled = true;
    };
  }, [aui, messages.length, setMessages]);

  // Track per-segment run start; unlock further continues once a segment is live.
  useEffect(() => {
    if (status === "submitted") {
      runStartedAtRef.current = Date.now();
      continueScheduledRef.current = false;
      return;
    }
    if (status === "streaming") {
      continueScheduledRef.current = false;
      if (runStartedAtRef.current == null) {
        runStartedAtRef.current = Date.now();
      }
    }
  }, [status]);

  // Assign a durable thread id as soon as a turn starts so /c/<id> + drafts work
  // before assistant-ui's end-of-run history flush.
  useEffect(() => {
    if (status !== "submitted" && status !== "streaming") return;
    let cancelled = false;
    void (async () => {
      try {
        const state = aui.threadListItem().getState();
        if (!state.remoteId) {
          await aui.threadListItem().initialize();
        }
        if (!cancelled) {
          threadIdRef.current =
            readThreadStorageKey(aui) ?? readThreadIdFromLocation();
        }
      } catch {
        // ignore — drafts fall back to whatever id we already have
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, aui]);

  // Debounced draft persistence while the model is still working.
  useEffect(() => {
    if (status !== "submitted" && status !== "streaming") return;
    const key = threadIdRef.current ?? readThreadStorageKey(aui);
    if (!key || messages.length === 0) return;
    const timer = window.setTimeout(() => {
      persistThreadUIMessages(key, messages);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [messages, status, aui]);

  // Flush on tab close / refresh so the last streamed tokens aren't lost to the debounce.
  useEffect(() => {
    const flush = () => {
      const key = threadIdRef.current ?? readThreadStorageKey(aui);
      if (!key || messagesRef.current.length === 0) return;
      const s = statusRef.current;
      if (s === "submitted" || s === "streaming" || s === "ready") {
        persistThreadUIMessages(key, messagesRef.current);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [aui]);

  // Distinct actions: Continue keeps partial work; Retry regenerates.
  useEffect(() => {
    const runContinue = () => {
      if (statusRef.current === "submitted" || statusRef.current === "streaming") {
        return;
      }
      const api = chatApiRef.current;
      if (!api) return;
      if (!hasContinuableAssistant(messagesRef.current)) {
        // Nothing to resume — fall back to regenerate.
        void api.regenerate?.().catch((err) => {
          console.error("[chat] regenerate fallback failed", err);
        });
        return;
      }

      continueSegmentRef.current = true;
      if (continueCountRef.current < MAX_AUTO_CONTINUES) {
        continueCountRef.current += 1;
      }
      const segment = Math.max(1, continueCountRef.current);
      emitContinueStatus({
        phase: "continuing",
        segment,
        max: MAX_AUTO_CONTINUES,
      });
      if (lastHarnessRef.current) {
        armHarnessRef.current(lastHarnessRef.current);
      }
      try {
        api.clearError?.();
      } catch {
        // ignore
      }
      void api.sendMessage({ text: CONTINUE_USER_TEXT }).catch((err) => {
        console.error("[chat] manual continue failed", err);
        continueSegmentRef.current = false;
        emitContinueStatus({ phase: "idle" });
        window.dispatchEvent(
          new CustomEvent("aether:notice", {
            detail: "Could not continue. Try sending a short “continue” message.",
          }),
        );
      });
    };

    const runRetry = () => {
      if (statusRef.current === "submitted" || statusRef.current === "streaming") {
        return;
      }
      const api = chatApiRef.current;
      if (!api) return;
      needsContinueRef.current = false;
      emitContinueStatus({ phase: "idle" });
      try {
        api.clearError?.();
      } catch {
        // ignore
      }
      void api.regenerate?.().catch((err) => {
        console.error("[chat] regenerate failed", err);
      });
    };

    const onContinue = () => runContinue();
    const onRetry = () => runRetry();
    // Legacy dual event: prefer continue when partial work exists.
    const onContinueOrRetry = () => {
      const preferContinue =
        needsContinueRef.current ||
        !!errorRef.current ||
        statusRef.current === "error" ||
        (hasContinuableAssistant(messagesRef.current) &&
          continueCountRef.current > 0);
      if (preferContinue && hasContinuableAssistant(messagesRef.current)) {
        runContinue();
      } else {
        runRetry();
      }
    };

    window.addEventListener("aether:continue", onContinue);
    window.addEventListener("aether:retry", onRetry);
    window.addEventListener("aether:continue-or-retry", onContinueOrRetry);
    return () => {
      window.removeEventListener("aether:continue", onContinue);
      window.removeEventListener("aether:retry", onRetry);
      window.removeEventListener("aether:continue-or-retry", onContinueOrRetry);
    };
  }, [emitContinueStatus]);

  return useAISDKRuntime(chat, {
    isDisabled: !hasKey,
  });
}

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const adapter = useMemo(() => createAetherThreadListAdapter(), []);
  // `/c/<id>` deep links win; bare `/` starts a new chat.
  const [initialThreadId] = useState(() => loadInitialThreadIdFromUrl());
  const restoredRef = useRef(false);

  const onThreadIdChange = useCallback((threadId: string | undefined) => {
    if (threadId) saveActiveThreadId(threadId);
  }, []);

  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useChatThreadRuntime,
    adapter,
    onThreadIdChange,
    initialThreadId,
  });

  // Constructor always switchToNewThread(); initialThreadId races it and can lose.
  // Re-apply the URL thread once after the list is ready (avoid double-switch thrash).
  useEffect(() => {
    if (restoredRef.current) return;
    const saved = initialThreadId;
    if (!saved) {
      restoredRef.current = true;
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        await runtime.threads.getLoadThreadsPromise();
        if (cancelled) return;
        await runtime.threads.switchToThread(saved);
      } catch {
        // Thread may have been deleted — ThreadUrlSync sends the user to `/`.
      } finally {
        restoredRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [runtime, initialThreadId]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
