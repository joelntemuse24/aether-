"use client";

import { useMemo, useRef, type ReactNode } from "react";
import {
  AssistantRuntimeProvider,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import {
  AssistantChatTransport,
  useAISDKRuntime,
} from "@assistant-ui/react-ai-sdk";
import { useChat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { createAetherThreadListAdapter } from "@/lib/local-thread-adapter";
import { useSettings } from "./settings-provider";
import { useAttachments } from "./attachments-provider";
import { buildTextAttachmentPrefix } from "@/lib/attachments";
import { runPython } from "@/lib/pyodide";
import { TOOL_NAMES, type ExecutePythonInput } from "@/lib/tools";

type AddToolResult = (result: {
  tool: string;
  toolCallId: string;
  output: unknown;
}) => void;

function useChatThreadRuntime() {
  const { chatHeaders, activeModel, hasKey } = useSettings();
  const { attachments, clearAttachments } = useAttachments();

  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        api: "/api/chat",
        headers: () => chatHeaders,
        body: () => {
          // Send all attachments that have usable content
          const fileAttachments = attachments
            .filter((a) => (a.kind === "image" || (a.kind === "file" && a.dataUrl)) && a.dataUrl)
            .map((a) => ({
              name: a.name,
              mime: a.mime,
              dataUrl: a.dataUrl!,
            }));

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

  // Ref lets onToolCall reach the latest addToolResult without stale closures.
  const addToolResultRef = useRef<AddToolResult | null>(null);

  const chat = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: async ({ toolCall }) => {
      // Only execute_python runs client-side; server tools resolve themselves.
      if (toolCall.toolName !== TOOL_NAMES.executePython) return;
      const add = addToolResultRef.current;
      if (!add) return;

      const { code } = toolCall.input as ExecutePythonInput;
      // runPython never rejects — it resolves with { ok:false, error } on failure.
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
      // Clear attachments after the message is successfully sent
      clearAttachments();
    },
  });

  addToolResultRef.current = chat.addToolResult as unknown as AddToolResult;

  return useAISDKRuntime(chat, {
    isDisabled: !hasKey,
  });
}

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const adapter = useMemo(() => createAetherThreadListAdapter(), []);

  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useChatThreadRuntime,
    adapter,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
