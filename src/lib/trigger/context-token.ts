/**
 * Signed user/conversation context for the durable agent → Vercel tool callback.
 * The worker holds this JWT as an opaque string; Drive/GitHub cookies never leave Vercel.
 */

import { SignJWT, jwtVerify } from "jose";
import type { ToolApprovalMode } from "@/lib/hermes/tool-approval";
import { parseToolApprovalMode } from "@/lib/hermes/tool-approval";

export const AGENT_CONTEXT_PURPOSE = "aether-agent-context";
const DEFAULT_TTL = "24h";

export type AgentContextPayload = {
  purpose: typeof AGENT_CONTEXT_PURPOSE;
  userId: string | null;
  conversationId: string | null;
  projectId?: string | null;
  runId?: string | null;
  approvalMode: ToolApprovalMode;
  hasMemory: boolean;
  hasDrive: boolean;
  hasGitHub: boolean;
  driveAccessToken?: string;
  driveRefreshToken?: string;
  driveExpiresAt?: number;
  githubAccessToken?: string;
};

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAgentContextToken(
  payload: Omit<AgentContextPayload, "purpose">,
  secret: string,
  ttl: string = DEFAULT_TTL,
): Promise<string> {
  return new SignJWT({
    ...payload,
    purpose: AGENT_CONTEXT_PURPOSE,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secretKey(secret));
}

export async function verifyAgentContextToken(
  token: string,
  secret: string,
): Promise<AgentContextPayload | null> {
  if (!token.trim() || !secret.trim()) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(secret));
    if (payload.purpose !== AGENT_CONTEXT_PURPOSE) return null;
    const userId =
      typeof payload.userId === "string"
        ? payload.userId
        : payload.userId === null
          ? null
          : null;
    return {
      purpose: AGENT_CONTEXT_PURPOSE,
      userId,
      conversationId:
        typeof payload.conversationId === "string"
          ? payload.conversationId
          : null,
      projectId:
        typeof payload.projectId === "string" ? payload.projectId : null,
      runId: typeof payload.runId === "string" ? payload.runId : null,
      approvalMode: parseToolApprovalMode(payload.approvalMode),
      hasMemory: payload.hasMemory === true,
      hasDrive: payload.hasDrive === true,
      hasGitHub: payload.hasGitHub === true,
      driveAccessToken:
        typeof payload.driveAccessToken === "string"
          ? payload.driveAccessToken
          : undefined,
      driveRefreshToken:
        typeof payload.driveRefreshToken === "string"
          ? payload.driveRefreshToken
          : undefined,
      driveExpiresAt:
        typeof payload.driveExpiresAt === "number"
          ? payload.driveExpiresAt
          : undefined,
      githubAccessToken:
        typeof payload.githubAccessToken === "string"
          ? payload.githubAccessToken
          : undefined,
    };
  } catch {
    return null;
  }
}
