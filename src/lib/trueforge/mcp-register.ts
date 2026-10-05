import type { TrueForge } from "@truefoundry/trueforge-sdk";
import { trueforgeOrigin, trueforgeToken } from "./config";
import { AETHER_MCP_DEFERRED, AETHER_MCP_DIRECT } from "./mcp-http";
import { signTrueForgeToolContext, toolContextKey, type TrueForgeToolContext } from "./tool-context";

const signedTokens = new Map<string, { token: string; key: string; exp: number }>();
export const MAX_SIGNED_TOOL_TOKENS = 200;
let loggedMissingOrigin = false;
let mcpDeleteUnsupported = false;

/** Fixed pool of MCP server names. The sidecar inventory never exceeds this many aether rows. */
export const MAX_AETHER_MCP_SLOTS = 48;
/** A lease idle this long is free for another conversation. */
export const AETHER_MCP_SLOT_IDLE_TTL_MS = 30 * 60 * 1000;
const slotLeases = new Map<string, { slot: number; at: number }>();

export function resetAetherMcpRegisterState(): void {
  signedTokens.clear();
  slotLeases.clear();
  loggedMissingOrigin = false;
  mcpDeleteUnsupported = false;
}

/**
 * Origin the VM sidecar calls back to. Prefer `AETHER_APP_URL` (the public
 * production domain). `VERCEL_URL` is a deployment URL and Deployment
 * Protection answers it with 401, so it is not a fallback.
 */
export function aetherPublicOrigin(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const explicit = (env.AETHER_APP_URL || env.AUTH_URL || "").trim().replace(/\/$/, "");
  if (explicit) return explicit;
  if (env.NODE_ENV !== "production") return "http://127.0.0.1:3000";
  if (!loggedMissingOrigin) {
    loggedMissingOrigin = true;
    console.error(
      "[trueforge] AETHER_APP_URL is not set. Tool registration is skipped. VERCEL_URL is not used because Deployment Protection rejects VM callbacks.",
    );
  }
  return null;
}

export function aetherMcpServerName(conversationId: string, now = Date.now()): string {
  return aetherMcpServerNames(conversationId, now).direct;
}

function slotLabel(slot: number): string {
  return `s${String(slot).padStart(2, "0")}`;
}

/** Stable starting slot so separate app instances rarely pick the same free slot. */
function preferredSlot(conversationId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < conversationId.length; i++) {
    hash = Math.imul(hash ^ conversationId.charCodeAt(i), 16777619) >>> 0;
  }
  return (hash % MAX_AETHER_MCP_SLOTS) + 1;
}

export function aetherMcpSlotLeaseCount(): number {
  return slotLeases.size;
}

/** Slot currently leased to a conversation, without creating or touching a lease. */
export function leasedAetherMcpSlotName(conversationId: string): string | null {
  const lease = slotLeases.get(conversationId);
  return lease ? `aether-${slotLabel(lease.slot)}` : null;
}

/**
 * Free a conversation's slot and return its server name (null when it holds none),
 * so the caller can try a DELETE. Slot names are pooled, so a name must not be
 * deleted for a conversation that no longer holds it.
 */
export function releaseAetherMcpSlot(conversationId: string): string | null {
  const name = leasedAetherMcpSlotName(conversationId);
  slotLeases.delete(conversationId);
  return name;
}

function leaseSlot(conversationId: string, now: number): number {
  const held = slotLeases.get(conversationId);
  if (held) {
    // Re-insert so Map order tracks recency.
    slotLeases.delete(conversationId);
    slotLeases.set(conversationId, { slot: held.slot, at: now });
    return held.slot;
  }
  const taken = new Map<number, { id: string; at: number }>();
  for (const [id, lease] of slotLeases) taken.set(lease.slot, { id, at: lease.at });
  const start = preferredSlot(conversationId);
  let slot = 0;
  for (let i = 0; i < MAX_AETHER_MCP_SLOTS && !slot; i++) {
    const candidate = ((start - 1 + i) % MAX_AETHER_MCP_SLOTS) + 1;
    const owner = taken.get(candidate);
    if (!owner || now - owner.at > AETHER_MCP_SLOT_IDLE_TTL_MS) slot = candidate;
  }
  if (!slot) {
    // Pool is full of live leases: take the least recently used one.
    let oldest: { slot: number; at: number } | null = null;
    for (const [candidate, owner] of taken) {
      if (!oldest || owner.at < oldest.at) oldest = { slot: candidate, at: owner.at };
    }
    slot = oldest?.slot ?? start;
  }
  const previous = taken.get(slot);
  if (previous) slotLeases.delete(previous.id);
  slotLeases.set(conversationId, { slot, at: now });
  return slot;
}

/**
 * Pooled MCP server names (`aether-s01`). Standalone TrueForge does not forward
 * per-turn headers to MCP (`gatewayTurnHeaders` is empty unless TrueFoundry gateway
 * mode is on), so each conversation leases a slot and the upsert sets that slot's
 * auth headers. The sidecar cannot DELETE rows, so names are reused, never grown.
 */
export function aetherMcpServerNames(
  conversationId: string,
  now = Date.now(),
): { direct: string; deferred: string } {
  const label = slotLabel(leaseSlot(conversationId, now));
  return { direct: `aether-${label}`, deferred: `aetherx-${label}` };
}

/** Fields safe to seal. Connector tokens are resolved on the tool call. */
export function sealableToolContext(
  input: Omit<TrueForgeToolContext, "exp">,
): Omit<TrueForgeToolContext, "exp"> {
  return {
    userId: input.userId,
    conversationId: input.conversationId,
    projectId: input.projectId,
    runId: input.runId,
    approvalMode: input.approvalMode,
    hasMemory: input.hasMemory,
    hasDrive: input.hasDrive,
    hasGitHub: input.hasGitHub,
  };
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

export function signedToolTokenCount(): number {
  return signedTokens.size;
}

/** Drop expired signed contexts, then the oldest entries past the cap. */
export function evictSignedToolTokens(now = Date.now()): string[] {
  const dropped: string[] = [];
  for (const [id, row] of signedTokens) {
    if (row.exp <= now) {
      signedTokens.delete(id);
      dropped.push(id);
    }
  }
  while (signedTokens.size > MAX_SIGNED_TOOL_TOKENS) {
    const oldest = signedTokens.keys().next().value;
    if (!oldest) break;
    signedTokens.delete(oldest);
    dropped.push(oldest);
  }
  return dropped;
}

/**
 * TrueForge 0.2.1 has no MCP delete method. Try DELETE once; a 405 means this
 * sidecar cannot remove the row, so later evictions only drop the local cache.
 */
export async function removeAetherMcpServer(name: string): Promise<boolean> {
  if (mcpDeleteUnsupported || !name) return false;
  const token = trueforgeToken();
  if (!token) return false;
  try {
    const response = await fetch(
      `${trueforgeOrigin()}/api/v1/settings/mcp-servers/${encodeURIComponent(name)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(2_000),
      },
    );
    if (response.status === 405 || response.status === 501) {
      mcpDeleteUnsupported = true;
      console.warn("[trueforge] Sidecar cannot delete MCP servers (HTTP " + response.status + ").");
      return false;
    }
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}

/** Reuse a signed context until it is close to expiry so later turns skip the upsert. */
export function cachedToolContextToken(
  conversationId: string,
  input: Omit<TrueForgeToolContext, "exp">,
  secret: string,
  now = Date.now(),
): string {
  evictSignedToolTokens(now);
  const safe = sealableToolContext(input);
  const key = contextKey(safe);
  const hit = signedTokens.get(conversationId);
  if (hit && hit.key === key && hit.exp - now > 30 * 60 * 1000) {
    signedTokens.delete(conversationId);
    signedTokens.set(conversationId, hit);
    return hit.token;
  }
  const token = signTrueForgeToolContext(safe, secret, now);
  signedTokens.delete(conversationId);
  signedTokens.set(conversationId, { token, key, exp: now + 2 * 60 * 60 * 1000 });
  evictSignedToolTokens(now);
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
  const transport = trueforgeToken();
  const contextSecret = toolContextKey();
  const origin = aetherPublicOrigin();
  if (!transport || !contextSecret || !origin) return null;
  const names = aetherMcpServerNames(input.conversationId);
  const includeAccountTools = needsDeferredAetherTools(input.context);
  const token = cachedToolContextToken(input.conversationId, input.context, contextSecret);
  try {
    await upsertMcp({
      client: input.client,
      name: names.direct,
      description: includeAccountTools
        ? "Aether web, clock, memory, artifacts, Drive, and GitHub."
        : "Aether web search, fetch, browse, and clock.",
      origin,
      secret: transport,
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
