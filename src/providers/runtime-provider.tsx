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

function useChatThreadRuntime() {
  const { chatHeaders, activeModel, hasKey } = useSettings();

  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        api: "/api/chat",
        headers: () => chatHeaders,
        body: () => ({
          model: activeModel,
        }),
      }),
    [chatHeaders, activeModel],
  );

  const chat = useChat({
    transport,
    onError: (error) => {
      console.error("[chat]", error);
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
