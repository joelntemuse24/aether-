/**
 * Authorize the durable agent calling back into Vercel Aether tools.
 * Prefer a signed context JWT (no Drive cookies on the worker). Fall back to
 * the existing shared callback secret used by the unused Hermes seam.
 */

import { authorizeAetherToolsCallback } from "@/lib/hermes/callback-auth";
import { getAuthSecretString } from "@/lib/auth-secret";
import {
  verifyAgentContextToken,
  type AgentContextPayload,
} from "./context-token";

export type ToolCallbackAuth =
  | { ok: true; kind: "jwt"; ctx: AgentContextPayload }
  | { ok: true; kind: "shared" }
  | { ok: false };

function bearerToken(authorization: string | null | undefined): string {
  const match = /^Bearer\s+(.+)$/i.exec(authorization?.trim() || "");
  return match?.[1]?.trim() ?? "";
}

export async function resolveToolCallbackAuth(
  headers: {
    authorization?: string | string[] | null;
    get?: (name: string) => string | null;
  },
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Promise<ToolCallbackAuth> {
  let authorization = "";
  if (typeof headers.get === "function") {
    authorization = headers.get("authorization") ?? "";
  } else {
    const raw = headers.authorization;
    authorization = Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";
  }
  const token = bearerToken(authorization);
  const authSecret =
    (typeof env.AUTH_SECRET === "string" && env.AUTH_SECRET.trim()) ||
    (env === process.env ? getAuthSecretString() : env.AUTH_SECRET) ||
    "";

  if (token && authSecret) {
    const ctx = await verifyAgentContextToken(token, String(authSecret));
    if (ctx) return { ok: true, kind: "jwt", ctx };
  }

  if (authorizeAetherToolsCallback(headers, env)) {
    return { ok: true, kind: "shared" };
  }
  return { ok: false };
}
