import { AsyncLocalStorage } from "node:async_hooks";
import { NextResponse } from "next/server";
import { chat } from "@trigger.dev/sdk/chat-server";
import { streamText } from "ai";
import { isHostedChatAvailable } from "@/lib/hosted/availability";
import { isHostedConfigured } from "@/lib/hosted/config";
import { CHAT_AGENT_TASK_ID, isTriggerChatConfigured } from "@/lib/trigger/config";
import {
  parseChatClientData,
  redactChatClientData,
  sessionSafeChatClientData,
  type ChatClientData,
} from "@/lib/trigger/client-data";
import { attachAgentContextToClientData } from "@/lib/trigger/session-context";
import { prepareDurableChatTurn } from "@/lib/trigger/prepare-turn";
import {
  applyHeadStartWireMetadata,
  HEAD_START_MAX_DURATION_SECONDS,
  splitHeadStartClientData,
} from "@/lib/trigger/head-start";
import { buildHeadStartToolSchemas } from "@/lib/harness/tool-schemas";
import { resolveTurnLanguageModel } from "@/lib/chat-language-model";
import { enrichModelMessagesWithAttachments } from "@/lib/chat-turn";

export const runtime = "nodejs";
export const maxDuration = HEAD_START_MAX_DURATION_SECONDS;

const turnStore = new AsyncLocalStorage<ChatClientData>();

const headStartHandler = chat.headStart({
  agentId: CHAT_AGENT_TASK_ID,
  idleTimeoutInSeconds: 60,
  run: async ({ chat: helper, messages }) => {
    const clientData = turnStore.getStore();
    if (!clientData) {
      throw new Error("Could not start chat.");
    }
    const prepared = await prepareDurableChatTurn({
      clientData,
      chatId: helper.session.chatId,
      uiMessages: messages,
    });
    const model = resolveTurnLanguageModel({
      hosted: prepared.hosted,
      provider: prepared.provider,
      apiKey: prepared.apiKey,
      baseURL: prepared.baseURL,
      modelId: prepared.requestedModel,
      origin: prepared.origin,
    });
    if (!model) {
      throw new Error(
        prepared.hosted
          ? "Aether Cloud is not configured on this server. Switch to Bring your own key in Settings."
          : "Missing API key. Open Settings and add an OpenRouter (or other provider) key.",
      );
    }
    const tools = buildHeadStartToolSchemas({
      toolsEnabled: prepared.toolsEnabled,
      hasDrive: prepared.hasDrive,
      hasGitHub: prepared.hasGitHub,
      hasMemory: prepared.hasMemory,
    });
    const streamOpts = helper.toStreamTextOptions({ tools });
    const modelMessages = enrichModelMessagesWithAttachments(
      streamOpts.messages,
      clientData.attachments ?? [],
      clientData.textPrefix,
    );
    return streamText({
      ...streamOpts,
      messages: modelMessages,
      model,
      system: prepared.system,
    });
  },
});

/**
 * First durable turn: run step 1 on this warm process while the agent boots.
 * Tool execution and later turns stay on the durable agent.
 */
export async function POST(req: Request) {
  if (!isTriggerChatConfigured()) {
    return NextResponse.json(
      { error: "Durable chat is not configured." },
      { status: 503 },
    );
  }

  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "chatId is required." }, { status: 400 });
  }
  const chatId = typeof raw.chatId === "string" ? raw.chatId.trim() : "";
  if (!chatId) {
    return NextResponse.json({ error: "chatId is required." }, { status: 400 });
  }

  const parsed = parseChatClientData(raw.metadata ?? {});
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const hosted = parsed.data.accessMode !== "byok";
  if (hosted) {
    if (!isHostedChatAvailable(process.env, isHostedConfigured())) {
      return NextResponse.json(
        {
          error:
            "Aether Cloud is not configured on this server. Switch to Bring your own key in Settings.",
        },
        { status: 503 },
      );
    }
  } else if (!parsed.data.apiKey?.trim()) {
    return NextResponse.json(
      {
        error:
          "Missing API key. Open Settings and add an OpenRouter (or other provider) key.",
      },
      { status: 401 },
    );
  }

  const merged = await attachAgentContextToClientData({
    chatId,
    clientData: parsed.data,
  });
  const { turnClientData, sessionMetadata } = splitHeadStartClientData(merged);

  console.info(
    "[chat/head-start]",
    redactChatClientData({
      chatId,
      accessMode: turnClientData.accessMode,
      model: turnClientData.model,
      provider: turnClientData.provider,
      apiKey: turnClientData.apiKey,
      contextToken: turnClientData.contextToken,
    }),
  );

  const rewritten = applyHeadStartWireMetadata(raw, sessionSafeChatClientData(sessionMetadata));
  const next = new Request(req.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(rewritten),
    signal: req.signal,
  });

  return turnStore.run(turnClientData, () => headStartHandler(next));
}
