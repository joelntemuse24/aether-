/**
 * Durable chat.agent — hosted Cloud and BYOK turns.
 * Idle sessions suspend. Aether-owned tools callback into the Next app.
 */

import { chat } from "@trigger.dev/sdk/ai";
import { z } from "zod";
import { runLegacyLocalChat } from "@/lib/harness/legacy-local-stream";
import { buildToolRegistry } from "@/lib/harness/tool-registry";
import { CHAT_AGENT_TASK_ID } from "@/lib/trigger/config";
import { executeAetherToolViaCallback } from "@/lib/trigger/aether-tool-callback";
import {
  persistableChatClientData,
  redactChatClientData,
  type ChatClientData,
} from "@/lib/trigger/client-data";
import { prepareDurableChatTurn } from "@/lib/trigger/prepare-turn";
import { aetherAppOrigin } from "@/lib/trigger/app-url";
import { isHostedChatAvailable } from "@/lib/hosted/availability";
import { isHostedConfigured } from "@/lib/hosted/config";
import {
  enrichModelMessagesWithAttachments,
  lastUserTextFromModelMessages,
} from "@/lib/chat-turn";

const clientDataSchema = z
  .object({
    accessMode: z.enum(["hosted", "byok"]),
    model: z.string().min(1),
    toolsEnabled: z.boolean().optional(),
    approvalMode: z.enum(["ask", "auto"]).optional(),
    provider: z.enum(["openrouter", "openai", "anthropic", "custom"]).optional(),
    apiKey: z.string().optional(),
    baseURL: z.string().optional(),
    origin: z.string().optional(),
    system: z.string().optional(),
    harness: z.unknown().optional(),
    memoryContext: z.string().optional(),
    projectId: z.string().optional(),
    conversationId: z.string().optional(),
    continueSegment: z.boolean().optional(),
    attachments: z
      .array(
        z.object({
          name: z.string(),
          mime: z.string(),
          dataUrl: z.string(),
        }),
      )
      .optional(),
    textPrefix: z.string().optional(),
    contextToken: z.string().optional(),
    userId: z.string().nullable().optional(),
    hasDrive: z.boolean().optional(),
    hasGitHub: z.boolean().optional(),
    hasMemory: z.boolean().optional(),
  })
  .passthrough();

type SessionCtx = {
  contextToken: string;
  userId: string | null;
  hasDrive: boolean;
  hasGitHub: boolean;
  hasMemory: boolean;
};

const sessionCtx = chat.local<SessionCtx>({ id: "aetherSessionCtx" });

function readSessionCtx(): SessionCtx {
  try {
    return sessionCtx.get();
  } catch {
    return {
      contextToken: "",
      userId: null,
      hasDrive: false,
      hasGitHub: false,
      hasMemory: false,
    };
  }
}

function hydrateSessionCtx(data: ChatClientData | undefined) {
  const prev = readSessionCtx();
  const next: SessionCtx = {
    contextToken: data?.contextToken?.trim() || prev.contextToken,
    userId: data?.userId !== undefined ? data.userId : prev.userId,
    hasDrive: data?.hasDrive === true || prev.hasDrive,
    hasGitHub: data?.hasGitHub === true || prev.hasGitHub,
    hasMemory: data?.hasMemory === true || prev.hasMemory,
  };
  try {
    sessionCtx.get();
    sessionCtx.contextToken = next.contextToken;
    sessionCtx.userId = next.userId;
    sessionCtx.hasDrive = next.hasDrive;
    sessionCtx.hasGitHub = next.hasGitHub;
    sessionCtx.hasMemory = next.hasMemory;
  } catch {
    sessionCtx.init(next);
  }
}

export const chatAgent = chat.agent({
  id: CHAT_AGENT_TASK_ID,
  // Idle chats suspend (default 30s) and cost nothing. No short HTTP wall clock.
  idleTimeoutInSeconds: 30,
  maxTurns: 10_000,
  turnTimeout: "365d",
  clientDataSchema,
  onBoot: ({ clientData }) => {
    hydrateSessionCtx(clientData as ChatClientData | undefined);
  },
  onPreload: ({ clientData }) => {
    hydrateSessionCtx(clientData as ChatClientData | undefined);
  },
  onChatResume: ({ clientData }) => {
    hydrateSessionCtx(clientData as ChatClientData | undefined);
  },
  onTurnStart: ({ clientData, chatId }) => {
    const data = clientData as ChatClientData | undefined;
    hydrateSessionCtx(data);
    console.info(
      "[chat.agent] turn",
      redactChatClientData({
        chatId,
        ...persistableChatClientData(data ?? { accessMode: "hosted", model: "unknown" }),
      }),
    );
  },
  prepareMessages: ({ messages, clientData, reason }) => {
    if (reason !== "run") return messages;
    const data = clientData as ChatClientData | undefined;
    if (!data) return messages;
    return enrichModelMessagesWithAttachments(
      messages,
      data.attachments ?? [],
      data.textPrefix,
    );
  },
  tools: async ({ clientData }) => {
    const data = clientData as z.infer<typeof clientDataSchema> | undefined;
    const stored = readSessionCtx();
    const contextToken = data?.contextToken?.trim() || stored.contextToken;
    const userId = data?.userId !== undefined ? data.userId : stored.userId;
    return buildToolRegistry({
      userId,
      conversationId: data?.conversationId ?? null,
      projectId: data?.projectId ?? null,
      hasDrive: data?.hasDrive === true || stored.hasDrive,
      hasGitHub: data?.hasGitHub === true || stored.hasGitHub,
      hasMemory: data?.hasMemory === true || stored.hasMemory,
      approvalMode: data?.approvalMode === "auto" ? "auto" : "ask",
      executeAetherOwned: (name, args) =>
        contextToken
          ? executeAetherToolViaCallback({
              name,
              args,
              contextToken,
              origin: aetherAppOrigin(),
            })
          : Promise.resolve({
              ok: false,
              error: "This action isn't available right now.",
            }),
    });
  },
  run: async ({ messages, tools, signal, clientData, chatId }) => {
    const data = clientData as z.infer<typeof clientDataSchema>;
    hydrateSessionCtx(data as ChatClientData);
    if (data.accessMode !== "byok") {
      if (!isHostedChatAvailable(process.env, isHostedConfigured())) {
        throw new Error(
          "Aether Cloud is not configured on this server. Switch to Bring your own key in Settings.",
        );
      }
    } else if (!data.apiKey?.trim()) {
      throw new Error(
        "Missing API key. Open Settings and add an OpenRouter (or other provider) key.",
      );
    }

    const prepared = await prepareDurableChatTurn({
      clientData: data as ChatClientData,
      chatId,
      userText: lastUserTextFromModelMessages(messages),
    });

    const result = await runLegacyLocalChat({
      hosted: prepared.hosted,
      requestedModel: prepared.requestedModel,
      provider: prepared.provider,
      apiKey: prepared.apiKey,
      baseURL: prepared.baseURL,
      origin: prepared.origin,
      messages: [],
      enrichedMessages: [],
      modelMessages: messages,
      system: prepared.system,
      toolsEnabled: prepared.toolsEnabled,
      userId: prepared.userId,
      conversationId: prepared.conversationId,
      projectId: prepared.projectId,
      hasDrive: prepared.hasDrive,
      hasGitHub: prepared.hasGitHub,
      harnessDepth: prepared.harnessDepth,
      harnessIntent: prepared.harnessIntent,
      harnessRunId: prepared.harnessRunId,
      maxSteps: prepared.maxSteps,
      maxWebSearches: prepared.maxWebSearches,
      abortSignal: signal,
      approvalMode: prepared.approvalMode,
      tools,
      extraStreamTextOptions: chat.toStreamTextOptions({ tools }),
      asStreamResult: true,
    });

    if (result instanceof Response) {
      const body = await result.text();
      throw new Error(body.slice(0, 400) || "Chat failed.");
    }
    return result;
  },
});
