import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
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

function keyFromSecret(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

/** AES-GCM blob. The sidecar stores this header and must not see tokens. */
export function signTrueForgeToolContext(
  input: Omit<TrueForgeToolContext, "exp">,
  secret: string,
  now = Date.now(),
): string {
  const payload: TrueForgeToolContext = { ...input, exp: now + TTL_MS };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${Buffer.concat([iv, body, tag]).toString("base64url")}`;
}

export function readTrueForgeToolContext(
  token: string | null | undefined,
  secret: string,
  now = Date.now(),
): TrueForgeToolContext | null {
  if (!token || !secret || !token.startsWith("v1.")) return null;
  const raw = Buffer.from(token.slice(3), "base64url");
  if (raw.length < 12 + 16) return null;
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const data = raw.subarray(12, raw.length - 16);
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(secret), iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(json) as TrueForgeToolContext;
    if (!parsed.exp || parsed.exp < now) return null;
    if (parsed.approvalMode !== "ask" && parsed.approvalMode !== "auto") return null;
    return parsed;
  } catch {
    return null;
  }
}
