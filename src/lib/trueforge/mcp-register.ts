import type { TrueForge } from "@truefoundry/trueforge-sdk";
import { trueforgeToken } from "./config";
import { AETHER_MCP_PRELOAD, AETHER_MCP_TOOL_NAMES } from "./mcp-http";
import { signTrueForgeToolContext, type TrueForgeToolContext } from "./tool-context";

const signedTokens = new Map<string, { token: string; key: string; exp: number }>();

export function aetherPublicOrigin(): string | null {
  const explicit = (process.env.AETHER_APP_URL || process.env.AUTH_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (explicit) return explicit;
  const vercel = (process.env.VERCEL_URL ?? "").trim().replace(/^https?:\/\//, "");
  if (vercel) return `https://${vercel}`;
  if (process.env.NODE_ENV === "production") return null;
  return "http://127.0.0.1:3000";
}

export function aetherMcpServerName(conversationId: string): string {
  const clean = conversationId.toLowerCase().replace(/[^a-z0-9]/g, "");
  const suffix = (clean || "chat").slice(0, 40);
  return `aether-${suffix}`.slice(0, 48);
}

function contextKey(input: Omit<TrueForgeToolContext, "exp">): string {
  return JSON.stringify(input);
}

/** Reuse a signed context until it is close to expiry so later turns skip the upsert. */
export function cachedToolContextToken(
  conversationId: string,
  input: Omit<TrueForgeToolContext, "exp">,
  secret: string,
  now = Date.now(),
): string {
  const key = contextKey(input);
  const hit = signedTokens.get(conversationId);
  if (hit && hit.key === key && hit.exp - now > 30 * 60 * 1000) return hit.token;
  const token = signTrueForgeToolContext(input, secret, now);
  signedTokens.set(conversationId, { token, key, exp: now + 2 * 60 * 60 * 1000 });
  return token;
}

export async function ensureAetherMcpServer(input: {
  client: TrueForge;
  conversationId: string;
  context: Omit<TrueForgeToolContext, "exp">;
}): Promise<{ name: string; token: string } | null> {
  const secret = trueforgeToken();
  const origin = aetherPublicOrigin();
  if (!secret || !origin) return null;
  const name = aetherMcpServerName(input.conversationId);
  const token = cachedToolContextToken(input.conversationId, input.context, secret);
  try {
    await input.client.settings.mcpServers.createOrUpdate({
      manifest: {
        type: "remote",
        name,
        description: "Aether search, fetch, memory, Drive, and GitHub tools.",
        url: `${origin}/api/trueforge/mcp`,
        auth: {
          type: "header",
          headers: {
            Authorization: `Bearer ${secret}`,
            "X-Aether-Tool-Context": token,
          },
        },
      },
    });
    return { name, token };
  } catch (error) {
    console.warn(
      "[trueforge] MCP register failed",
      error instanceof Error ? error.message : "unavailable",
    );
    return null;
  }
}

export function aetherMcpSpec(name: string) {
  return {
    name,
    preload: false as const,
    enableTools: AETHER_MCP_TOOL_NAMES,
    preloadTools: [...AETHER_MCP_PRELOAD],
  };
}
