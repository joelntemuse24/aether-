import { NextResponse } from "next/server";
import { chat } from "@trigger.dev/sdk/ai";
import { auth } from "@/auth";
import { isCloudDbConfigured } from "@/lib/db";
import { getValidDriveAccessToken } from "@/lib/drive-session";
import { getValidGitHubAccessToken } from "@/lib/github-session";
import { readDriveCookie } from "@/lib/drive-session";
import { readGitHubCookie } from "@/lib/github-session";
import { getAuthSecretString } from "@/lib/auth-secret";
import { isHostedChatAvailable } from "@/lib/hosted/availability";
import { isHostedConfigured } from "@/lib/hosted/config";
import { CHAT_AGENT_TASK_ID, isTriggerChatConfigured } from "@/lib/trigger/config";
import {
  parseChatClientData,
  redactChatClientData,
  sessionSafeChatClientData,
} from "@/lib/trigger/client-data";
import { mergeStartSessionClientData } from "@/lib/trigger/start-session";
import { signAgentContextToken } from "@/lib/trigger/context-token";
import { parseToolApprovalMode } from "@/lib/hermes/tool-approval";

export const runtime = "nodejs";

/**
 * Thin: auth + mint a durable chat session token.
 * BYOK keys are validated here then stripped from the sticky session payload.
 * Per-turn transport clientData still carries the key for that turn only.
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

  const session = await auth();
  const userId = session?.user?.id || session?.user?.email || null;
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

  const hasDrive = userId ? !!(await getValidDriveAccessToken(userId)) : false;
  const hasGitHub = userId ? !!(await getValidGitHubAccessToken(userId)) : false;
  const drive = userId ? await readDriveCookie() : null;
  const github = userId ? await readGitHubCookie() : null;
  const contextToken = await signAgentContextToken(
    {
      userId,
      conversationId: parsed.data.conversationId || chatId,
      projectId: parsed.data.projectId ?? null,
      approvalMode: parseToolApprovalMode(parsed.data.approvalMode),
      hasMemory: !!(userId && isCloudDbConfigured()),
      hasDrive,
      hasGitHub,
      driveAccessToken:
        drive && drive.userId === userId ? drive.accessToken : undefined,
      driveRefreshToken:
        drive && drive.userId === userId ? drive.refreshToken : undefined,
      driveExpiresAt:
        drive && drive.userId === userId ? drive.expiresAt : undefined,
      githubAccessToken:
        github && github.userId === userId ? github.accessToken : undefined,
    },
    getAuthSecretString(),
  );

  const clientData = mergeStartSessionClientData({
    clientData: parsed.data,
    userId,
    conversationId: parsed.data.conversationId || chatId,
    contextToken,
    hasDrive,
    hasGitHub,
    hasMemory: !!(userId && isCloudDbConfigured()),
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
  if (typeof started === "string") {
    return NextResponse.json({ publicAccessToken: started });
  }
  return NextResponse.json(started);
}
