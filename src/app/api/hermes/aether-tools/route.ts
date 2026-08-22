import { NextResponse } from "next/server";
import { authorizeAetherToolsCallback } from "@/lib/hermes/callback-auth";
import { executeAetherTool, isAetherOwnedToolName } from "@/lib/hermes/aether-tools";
import {
  getAetherToolSession,
  parseUserIdFromSessionKey,
} from "@/lib/hermes/tool-session";
import { parseToolApprovalMode } from "@/lib/hermes/tool-approval";
import { isCloudDbConfigured } from "@/lib/db";
import { ensureConfirmationRepository } from "@/lib/harness/confirmation-store";

export const runtime = "nodejs";

/**
 * Remote-host callback: execute an Aether-owned tool with the user's
 * session. The browser never calls this; the host never receives Drive/GitHub
 * tokens — those stay in the short-lived Aether session registered by /api/chat.
 */
export async function POST(req: Request) {
  ensureConfirmationRepository();
  if (!authorizeAetherToolsCallback(req.headers)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    tool?: string;
    arguments?: unknown;
    args?: unknown;
    sessionKey?: string;
    session_key?: string;
  };
  const name = (body.name || body.tool || "").trim();
  if (!name || !isAetherOwnedToolName(name)) {
    return NextResponse.json(
      { error: "Unknown Aether tool." },
      { status: 400 },
    );
  }

  const sessionKey =
    req.headers.get("x-hermes-session-key")?.trim() ||
    body.sessionKey ||
    body.session_key ||
    "";
  const session = getAetherToolSession(sessionKey);
  const userId = session?.userId || parseUserIdFromSessionKey(sessionKey);

  const result = await executeAetherTool({
    name,
    args: body.arguments ?? body.args ?? {},
    ctx: {
      userId,
      conversationId: session?.conversationId ?? null,
      projectId: session?.projectId ?? null,
      runId: session?.runId ?? null,
      approvalMode: session?.approvalMode ?? parseToolApprovalMode("ask"),
      hasMemory: session?.hasMemory ?? !!(userId && isCloudDbConfigured()),
      hasDrive: session?.hasDrive ?? false,
      hasGitHub: session?.hasGitHub ?? false,
      driveAccessToken: session?.driveAccessToken,
      githubAccessToken: session?.githubAccessToken,
    },
  });

  return NextResponse.json(result);
}
