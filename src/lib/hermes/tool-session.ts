/**
 * Short-lived Aether tool session for one hosted chat turn.
 * Holds user identity + connector tokens in memory so a remote-host
 * callback can execute tools without receiving those tokens.
 */

import type { ToolApprovalMode } from "./tool-approval";

export type AetherToolSession = {
  sessionKey: string;
  userId: string | null;
  conversationId: string | null;
  projectId: string | null;
  runId: string | null;
  approvalMode: ToolApprovalMode;
  hasMemory: boolean;
  hasDrive: boolean;
  hasGitHub: boolean;
  driveAccessToken?: string;
  githubAccessToken?: string;
  createdAt: number;
};

const TTL_MS = 20 * 60 * 1000;
const sessions = new Map<string, AetherToolSession>();

function gc() {
  const now = Date.now();
  for (const [key, row] of sessions) {
    if (now - row.createdAt > TTL_MS) sessions.delete(key);
  }
}

export function registerAetherToolSession(
  session: Omit<AetherToolSession, "createdAt">,
): AetherToolSession {
  gc();
  const row: AetherToolSession = { ...session, createdAt: Date.now() };
  sessions.set(session.sessionKey, row);
  return row;
}

export function getAetherToolSession(
  sessionKey: string | null | undefined,
): AetherToolSession | null {
  if (!sessionKey) return null;
  gc();
  return sessions.get(sessionKey) ?? null;
}

export function parseUserIdFromSessionKey(sessionKey: string): string | null {
  const match = /^aether:user:(.+)$/.exec(sessionKey.trim());
  return match?.[1] || null;
}

export function forgetAetherToolSession(sessionKey: string): void {
  sessions.delete(sessionKey);
}
