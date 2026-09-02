import { NextResponse } from "next/server";
import { chat } from "@trigger.dev/sdk/ai";
import { isHostedChatAvailable } from "@/lib/hosted/availability";
import { isHostedConfigured } from "@/lib/hosted/config";
import { CHAT_AGENT_TASK_ID, isTriggerChatConfigured } from "@/lib/trigger/config";
import {
  parseChatClientData,
  redactChatClientData,
  sessionSafeChatClientData,
} from "@/lib/trigger/client-data";
import { attachAgentContextToClientData } from "@/lib/trigger/session-context";
import { parseStartSessionResult } from "@/lib/trigger/session-auth";

export const runtime = "nodejs";

/**
 * Thin: auth + mint a durable chat session token.
 * BYOK keys are validated here then stripped from the sticky session payload.
 * Per-turn transport clientData still carries the key for that turn only.
 * First send uses Head Start and skips this route.
 */
export async function POST(req: Request) {
  if (!isTriggerChatConfigured()) {
    return NextResponse.json(
      { error: "Durable chat is not configured." },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    chatId?: string;
    clientData?: unknown;
  };
  const chatId = typeof body.chatId === "string" ? body.chatId.trim() : "";
  if (!chatId) {
    return NextResponse.json({ error: "chatId is required." }, { status: 400 });
  }

  const parsed = parseChatClientData(body.clientData ?? {});
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

  const clientData = await attachAgentContextToClientData({
    chatId,
    clientData: parsed.data,
  });

  console.info(
    "[chat/start-session]",
    redactChatClientData({
      chatId,
      accessMode: clientData.accessMode,
      model: clientData.model,
      provider: clientData.provider,
      apiKey: clientData.apiKey,
      contextToken: clientData.contextToken,
    }),
  );

  const started = await chat.createStartSessionAction(CHAT_AGENT_TASK_ID)({
    chatId,
    clientData: sessionSafeChatClientData(clientData),
  });
  try {
    const { publicAccessToken } = parseStartSessionResult(started);
    if (started && typeof started === "object") {
      return NextResponse.json({ ...started, publicAccessToken });
    }
    return NextResponse.json({ publicAccessToken });
  } catch {
    return NextResponse.json({ error: "Could not start chat." }, { status: 502 });
  }
}
