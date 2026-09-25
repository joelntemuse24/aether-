import type { TrueForge } from "@truefoundry/trueforge-sdk";
import { trueforgeToken } from "./config";
import { AETHER_MCP_DEFERRED, AETHER_MCP_DIRECT } from "./mcp-http";
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
  return aetherMcpServerNames(conversationId).direct;
}

export function aetherMcpServerNames(conversationId: string): { direct: string; deferred: string } {
  const clean = conversationId.toLowerCase().replace(/[^a-z0-9]/g, "");
  const suffix = (clean || "chat").slice(0, 32);
  return { direct: `aether-${suffix}`, deferred: `aetherx-${suffix}` };
}

/** Memory, Drive, GitHub, and project search are the only tools beyond the preloaded web set. */
export function needsDeferredAetherTools(
  context: Pick<TrueForgeToolContext, "hasMemory" | "hasDrive" | "hasGitHub" | "projectId"> | null | undefined,
): boolean {
  if (!context) return false;
  return !!(context.hasMemory || context.hasDrive || context.hasGitHub || context.projectId);
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

async function upsertMcp(input: {
  client: TrueForge;
  name: string;
  description: string;
  origin: string;
  secret: string;
  token: string;
}) {
  await input.client.settings.mcpServers.createOrUpdate({
    manifest: {
      type: "remote",
      name: input.name,
      description: input.description,
      url: `${input.origin}/api/trueforge/mcp`,
      auth: {
        type: "header",
        headers: {
          Authorization: `Bearer ${input.secret}`,
          "X-Aether-Tool-Context": input.token,
        },
      },
    },
  });
}

export async function ensureAetherMcpServer(input: {
  client: TrueForge;
  conversationId: string;
  context: Omit<TrueForgeToolContext, "exp">;
}): Promise<{ direct: string; includeAccountTools: boolean; token: string } | null> {
  const secret = trueforgeToken();
  const origin = aetherPublicOrigin();
  if (!secret || !origin) return null;
  const names = aetherMcpServerNames(input.conversationId);
  const includeAccountTools = needsDeferredAetherTools(input.context);
  const token = cachedToolContextToken(input.conversationId, input.context, secret);
  try {
    await upsertMcp({
      client: input.client,
      name: names.direct,
      description: includeAccountTools
        ? "Aether web, clock, memory, artifacts, Drive, and GitHub."
        : "Aether web search, fetch, browse, and clock.",
      origin,
      secret,
      token,
    });
    return { direct: names.direct, includeAccountTools, token };
  } catch (error) {
    console.warn(
      "[trueforge] MCP register failed",
      error instanceof Error ? error.message : "unavailable",
    );
    return null;
  }
}

/**
 * One preloaded server. A second server with preload false makes TrueForge tell
 * the model to discover every tool, including web_search.
 */
export function aetherMcpServers(names: { direct: string }, includeAccountTools = false) {
  return [
    {
      name: names.direct,
      preload: true,
      enableTools: includeAccountTools
        ? [...AETHER_MCP_DIRECT, ...AETHER_MCP_DEFERRED]
        : [...AETHER_MCP_DIRECT],
    },
  ];
}
