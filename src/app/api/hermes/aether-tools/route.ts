import { NextResponse } from "next/server";
import { executeAetherTool, isAetherOwnedToolName } from "@/lib/hermes/aether-tools";
import {
  getAetherToolSession,
  parseUserIdFromSessionKey,
} from "@/lib/hermes/tool-session";
import { parseToolApprovalMode } from "@/lib/hermes/tool-approval";
import { isCloudDbConfigured } from "@/lib/db";
import { ensureConfirmationRepository } from "@/lib/harness/confirmation-store";
import { resolveToolCallbackAuth } from "@/lib/trigger/tool-callback-auth";
import { driveAccessFromAgentContext } from "@/lib/trigger/connector-from-context";

export const runtime = "nodejs";

/**
 * Remote-host callback: execute an Aether-owned tool with the user's
 * session. The browser never calls this. Durable agents send a signed
 * context JWT; Drive/GitHub cookies stay on this server.
 */
export async function POST(req: Request) {
  ensureConfirmationRepository();
  const authz = await resolveToolCallbackAuth(req.headers);
  if (!authz.ok) {
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

  if (authz.kind === "jwt") {
    const driveAccessToken = await driveAccessFromAgentContext(authz.ctx);
    const result = await executeAetherTool({
      name,
      args: body.arguments ?? body.args ?? {},
      ctx: {
        userId: authz.ctx.userId,
        conversationId: authz.ctx.conversationId,
        projectId: authz.ctx.projectId ?? null,
        runId: authz.ctx.runId ?? null,
        approvalMode: authz.ctx.approvalMode,
        hasMemory: authz.ctx.hasMemory,
        hasDrive: authz.ctx.hasDrive,
        hasGitHub: authz.ctx.hasGitHub,
        driveAccessToken,
        githubAccessToken: authz.ctx.githubAccessToken,
      },
    });
    return NextResponse.json(result);
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
