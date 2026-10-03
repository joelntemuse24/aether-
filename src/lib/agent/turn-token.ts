/**
 * Short-lived turn token. Vercel mints it; the VM agent server verifies it.
 * Claims are user, conversation, allowed tool names, approval mode, and request id.
 * No OAuth tokens and no API keys. The HMAC key is SHA-256 of the shared bearer
 * so any non-empty AETHER_TRUEFORGE_TOKEN works. The raw bearer is still the
 * HTTP Authorization header; it is not this JWT.
 */

import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { ToolApprovalMode } from "@/lib/hermes/tool-approval";

export const TURN_TOKEN_PURPOSE = "aether-agent-turn";
export const TURN_TOKEN_TTL_SECONDS = 10 * 60;

export type TurnClaims = {
  sub: string;
  conversationId: string;
  tools: string[];
  approvalMode: ToolApprovalMode;
  requestId: string;
};

function signingKey(secret: string): Uint8Array {
  return createHash("sha256").update(secret, "utf8").digest();
}

export async function mintTurnToken(
  claims: TurnClaims,
  secret: string,
  options?: { expiresAt?: Date; now?: Date },
): Promise<string> {
  const keyMaterial = secret.trim();
  if (!keyMaterial) throw new Error("Turn token secret is empty.");
  if (!claims.sub || !claims.requestId) throw new Error("Turn token claims are incomplete.");
  if (claims.approvalMode !== "ask" && claims.approvalMode !== "auto") {
    throw new Error("Turn token approval mode is invalid.");
  }
  const now = options?.now ?? new Date();
  const exp = options?.expiresAt ?? new Date(now.getTime() + TURN_TOKEN_TTL_SECONDS * 1000);
  return new SignJWT({
    purpose: TURN_TOKEN_PURPOSE,
    conversationId: claims.conversationId,
    tools: [...claims.tools],
    approvalMode: claims.approvalMode,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setJti(claims.requestId)
    .setIssuer("aether")
    .setAudience("aether-agent")
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(signingKey(keyMaterial));
}

export async function verifyTurnToken(token: string, secret: string): Promise<TurnClaims | null> {
  const keyMaterial = secret.trim();
  if (!token.trim() || !keyMaterial) return null;
  try {
    const { payload } = await jwtVerify(token, signingKey(keyMaterial), {
      issuer: "aether",
      audience: "aether-agent",
    });
    if (payload.purpose !== TURN_TOKEN_PURPOSE) return null;
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    if (typeof payload.jti !== "string" || !payload.jti) return null;
    if (payload.approvalMode !== "ask" && payload.approvalMode !== "auto") return null;
    if (typeof payload.conversationId !== "string") return null;
    if (!Array.isArray(payload.tools) || payload.tools.some((name) => typeof name !== "string")) {
      return null;
    }
    return {
      sub: payload.sub,
      conversationId: payload.conversationId,
      tools: payload.tools as string[],
      approvalMode: payload.approvalMode,
      requestId: payload.jti,
    };
  } catch {
    return null;
  }
}
