"use client";

import { useMemo, type ReactNode } from "react";
import {
  AssistantRuntimeProvider,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import {
  AssistantChatTransport,
  useAISDKRuntime,
} from "@assistant-ui/react-ai-sdk";
import { useChat } from "@ai-sdk/react";
import { createAetherThreadListAdapter } from "@/lib/local-thread-adapter";
import { useSettings } from "./settings-provider";
import { useAttachments } from "./attachments-provider";
import { buildTextAttachmentPrefix } from "@/lib/attachments";

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

  const chat = useChat({
    transport,
    onError: (error) => {
      console.error("[chat]", error);
    },
    onFinish: () => {
      // Clear attachments after the message is successfully sent
      clearAttachments();
    },
  });

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
