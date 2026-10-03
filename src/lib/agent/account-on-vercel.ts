/**
 * Vercel side of the native account-tool callback.
 * Verifies the turn token, then reads Drive and GitHub tokens on this server.
 * The VM never receives those tokens. Do not import this file from src/agent-server.
 */

import { isCloudDbConfigured } from "@/lib/db";
import { executeAetherTool, type AetherToolResult } from "@/lib/hermes/aether-tools";
import { connectorTokensForToolCall } from "@/lib/trueforge/connector-tokens";
import { isNativeAccountTool } from "./catalog";
import { verifyTurnToken } from "./turn-token";

type TokenReader = (userId: string) => Promise<{ accessToken: string } | null>;

async function defaultReadDrive(userId: string): Promise<{ accessToken: string } | null> {
  const { getValidDriveAccessToken } = await import("@/lib/drive-session");
  return getValidDriveAccessToken(userId);
}

async function defaultReadGitHub(userId: string): Promise<{ accessToken: string } | null> {
  const { getValidGitHubAccessToken } = await import("@/lib/github-session");
  return getValidGitHubAccessToken(userId);
}

export type TurnAccountCall =
  | { kind: "not-turn" }
  | { kind: "denied" }
  | { kind: "ok"; body: AetherToolResult };

export async function executeTurnAccountTool(input: {
  authorization: string | null;
  secret: string;
  name: string;
  args: unknown;
  hasMemory?: boolean;
  readDrive?: TokenReader;
  readGitHub?: TokenReader;
  execute?: typeof executeAetherTool;
}): Promise<TurnAccountCall> {
  const match = /^Bearer\s+(.+)$/i.exec(input.authorization?.trim() || "");
  const token = match?.[1]?.trim() ?? "";
  const claims = await verifyTurnToken(token, input.secret);
  if (!claims) return { kind: "not-turn" };
  if (!isNativeAccountTool(input.name) || !claims.tools.includes(input.name)) {
    return { kind: "denied" };
  }

  const tokens = await connectorTokensForToolCall({
    userId: claims.sub,
    hasDrive: true,
    hasGitHub: true,
    readDrive: input.readDrive ?? defaultReadDrive,
    readGitHub: input.readGitHub ?? defaultReadGitHub,
  });
  const execute = input.execute ?? executeAetherTool;
  try {
    const body = await execute({
      name: input.name,
      args: input.args ?? {},
      ctx: {
        userId: claims.sub,
        conversationId: claims.conversationId,
        projectId: claims.projectId ?? null,
        approvalMode: claims.approvalMode,
        hasMemory: input.hasMemory ?? !!(claims.sub && isCloudDbConfigured()),
        hasDrive: !!tokens.driveAccessToken,
        hasGitHub: !!tokens.githubAccessToken,
        driveAccessToken: tokens.driveAccessToken,
        githubAccessToken: tokens.githubAccessToken,
      },
    });
    return { kind: "ok", body };
  } catch {
    return { kind: "ok", body: { ok: false, error: "Account tool failed." } };
  }
}
