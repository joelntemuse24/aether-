import { createHmac, timingSafeEqual } from "node:crypto";
import type { ToolApprovalMode } from "@/lib/hermes/tool-approval";

export type TrueForgeToolContext = {
  userId?: string | null;
  conversationId?: string | null;
  projectId?: string | null;
  runId?: string | null;
  approvalMode: ToolApprovalMode;
  hasMemory?: boolean;
  hasDrive?: boolean;
  hasGitHub?: boolean;
  driveAccessToken?: string;
  githubAccessToken?: string;
  exp: number;
};

const TTL_MS = 2 * 60 * 60 * 1000;

export function signTrueForgeToolContext(
  input: Omit<TrueForgeToolContext, "exp">,
  secret: string,
  now = Date.now(),
): string {
  const payload: TrueForgeToolContext = { ...input, exp: now + TTL_MS };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readTrueForgeToolContext(
  token: string | null | undefined,
  secret: string,
  now = Date.now(),
): TrueForgeToolContext | null {
  if (!token || !secret) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const got = Buffer.from(sig);
  const want = Buffer.from(expected);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TrueForgeToolContext;
    if (!parsed.exp || parsed.exp < now) return null;
    if (parsed.approvalMode !== "ask" && parsed.approvalMode !== "auto") return null;
    return parsed;
  } catch {
    return null;
  }
}
