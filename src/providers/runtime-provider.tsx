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
} from "@/lib/local-thread-adapter";
import { useSettings } from "./settings-provider";
import { useAttachments } from "./attachments-provider";
import { buildTextAttachmentPrefix } from "@/lib/attachments";
import { getAttachmentPayload } from "@/lib/attachment-payloads";
import { runPython } from "@/lib/pyodide";
import { TOOL_NAMES, type ExecutePythonInput } from "@/lib/tools";

function loadActiveThreadId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(ACTIVE_THREAD_KEY);
    return raw?.trim() || undefined;
  } catch {
    return undefined;
  }
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
  const { chatHeaders, activeModel, hasKey } = useSettings();
  const { attachments, clearAttachments } = useAttachments();
  const aui = useAui();

  // Each remote-thread runtime instance mounts for one thread. Seed that
  // thread's useChat from localStorage so refresh/switch don't depend on
  // assistant-ui's one-shot useExternalHistory (which often skips load).
  const [seedMessages] = useState<UIMessage[]>(() => {
    const key = readThreadStorageKey(aui);
    return key ? loadThreadUIMessages(key) : [];
  });

  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        api: "/api/chat",
        headers: () => chatHeaders,
        body: () => {
          // Resolve image dataUrls from state; file binaries (Drive PDFs) from
          // the off-React payload store so composer re-renders stay cheap.
          const fileAttachments = attachments
            .map((a) => {
              const dataUrl =
                a.dataUrl ??
                (a.kind === "file" || a.hasPayload
                  ? getAttachmentPayload(a.id)
                  : undefined);
              if (!dataUrl) return null;
              if (a.kind !== "image" && a.kind !== "file") return null;
              return { name: a.name, mime: a.mime, dataUrl };
            })
            .filter((a): a is { name: string; mime: string; dataUrl: string } =>
              a !== null,
            );

          const textPrefix = buildTextAttachmentPrefix(attachments);

          return {
            model: activeModel,
            attachments: fileAttachments,
            textPrefix: textPrefix || undefined,
          };
        },
      }),
    [chatHeaders, activeModel, attachments],
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
    },
    onFinish: () => {
      clearAttachments();
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
    const stored = loadThreadUIMessages(key);
    if (stored.length === 0) return;
    loadedKeyRef.current = key;
    setMessages(stored);
  }, [aui, messages.length, setMessages]);

  return useAISDKRuntime(chat, {
    isDisabled: !hasKey,
  });
}

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const adapter = useMemo(() => createAetherThreadListAdapter(), []);
  const [initialThreadId] = useState(() => loadActiveThreadId());
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
  // Re-apply the saved thread after the list is ready (and once more on a tick).
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
        // Beat a late switchToNewThread completion from the constructor.
        await new Promise((r) => setTimeout(r, 0));
        if (cancelled) return;
        await runtime.threads.switchToThread(saved);
      } catch {
        // Thread may have been deleted — stay on new chat.
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
