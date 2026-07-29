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

function loadInitialThreadIdFromUrl(): string | undefined {
  // Only the URL selects the chat on boot. Bare `/` is always a new conversation.
  return readThreadIdFromLocation();
}

function saveActiveThreadId(threadId: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ACTIVE_THREAD_KEY, threadId);
    window.dispatchEvent(new CustomEvent("aether:thread-switched"));
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
  const { peekChatContext, clearChatContext } = useHarness();
  const { activeProjectId } = useProjects();
  const aui = useAui();
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const voiceRef = useRef(settings.voice);
  voiceRef.current = settings.voice;
  const peekHarnessRef = useRef(peekChatContext);
  peekHarnessRef.current = peekChatContext;
  const projectIdRef = useRef(activeProjectId);
  projectIdRef.current = activeProjectId;
  const threadIdRef = useRef<string | undefined>(undefined);
  threadIdRef.current = readThreadStorageKey(aui) ?? readThreadIdFromLocation();

  // Each remote-thread runtime instance mounts for one thread. Seed that
  // thread's useChat from localStorage so refresh/switch don't depend on
  // assistant-ui's one-shot useExternalHistory (which often skips load).
  const [seedMessages] = useState<UIMessage[]>(() => {
    const key = readThreadStorageKey(aui);
    return key ? loadThreadUIMessages(key) : [];
  });

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
          const memoryContext = localMemoryContextForChat();

          return {
            model: activeModel,
            attachments: fileAttachments,
            textPrefix: textPrefix || undefined,
            system: resolveVoicePrompt(voiceRef.current),
            harness: harness ?? undefined,
            memoryContext: memoryContext || undefined,
            projectId: projectIdRef.current ?? undefined,
            conversationId: threadIdRef.current ?? undefined,
          };
        },
      }),
    [chatHeaders, activeModel],
  );

  const addToolResultRef = useRef<AddToolResult | null>(null);

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
      clearChatContext();
    },
    onFinish: () => {
      clearAttachments();
      clearChatContext();
    },
  });

  addToolResultRef.current = chat.addToolResult as unknown as AddToolResult;

  const { messages, setMessages } = chat;
  const loadedKeyRef = useRef<string | null>(
    seedMessages.length > 0 ? (readThreadStorageKey(aui) ?? null) : null,
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
  // Re-apply the URL thread after the list is ready (and once more on a tick).
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
        await new Promise((r) => setTimeout(r, 0));
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
