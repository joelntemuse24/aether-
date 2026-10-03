import { TrueForge } from "@truefoundry/trueforge-sdk";
import {
  trueforgeAuthHeaders,
  trueforgeOrigin,
  trueforgeSandboxEnabled,
  trueforgeToken,
} from "./config";
import { instructionsForRegisteredTools } from "./instructions";
import {
  aetherMcpServerNames,
  aetherMcpServers,
  cachedToolContextToken,
  ensureAetherMcpServer,
  evictSignedToolTokens,
  needsDeferredAetherTools,
  removeAetherMcpServer,
} from "./mcp-register";
import {
  AETHER_EXPERT_MODEL_FQN,
  AETHER_OPENROUTER_EXPERT_FQN,
  modelProfile,
  preferAetherExpertModel,
} from "./providers";
import type { TrueForgeToolContext } from "./tool-context";

type CachedSession = {
  id: string;
  model: string;
  instructions?: string;
  mcpKey?: string;
  toolsAttached?: boolean;
  at: number;
};

/** After a failed registration, do not call sessions.update on every later turn. */
export function shouldSkipFailedRegistrationUpdate(input: {
  existing: { toolsAttached?: boolean; model: string } | null;
  mcpAttached: boolean;
  modelName: string;
}): boolean {
  return (
    !!input.existing &&
    !input.mcpAttached &&
    input.existing.toolsAttached === false &&
    input.existing.model === input.modelName
  );
}

export const MAX_TRUEFORGE_SESSIONS = 200;
export const TRUEFORGE_SESSION_TTL_MS = 6 * 60 * 60 * 1000;

export type TrueForgeSessionInput = {
  conversationId: string;
  modelName: string;
  instructions: string;
  toolContext?: Omit<TrueForgeToolContext, "exp"> | null;
};

const sessions = new Map<string, CachedSession>();

export function trueforgeSessionCount(): number {
  return sessions.size;
}

export function resetTrueForgeSessionCache(): void {
  sessions.clear();
}

export function rememberTrueForgeSession(
  conversationId: string,
  row: Omit<CachedSession, "at"> & { at?: number },
): void {
  sessions.delete(conversationId);
  sessions.set(conversationId, { ...row, at: row.at ?? Date.now() });
}

/** Drop idle sessions, then the least recently used past the cap. */
export function evictIdleTrueForgeSessions(now = Date.now()): string[] {
  const dropped: string[] = [];
  for (const [id, row] of sessions) {
    if (now - row.at > TRUEFORGE_SESSION_TTL_MS) {
      sessions.delete(id);
      dropped.push(id);
    }
  }
  while (sessions.size > MAX_TRUEFORGE_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (!oldest) break;
    sessions.delete(oldest);
    dropped.push(oldest);
  }
  return dropped;
}

export async function pruneTrueForgeCaches(now = Date.now()): Promise<string[]> {
  const dropped = evictIdleTrueForgeSessions(now);
  evictSignedToolTokens(now);
  for (const conversationId of dropped) {
    await removeAetherMcpServer(aetherMcpServerNames(conversationId).direct);
  }
  return dropped;
}
let modelsLoaded = false;
let primaryModel = AETHER_EXPERT_MODEL_FQN;
let fallbackModel: string | null = null;

function client() {
  const token = trueforgeToken();
  if (trueforgeAuthHeaders().Authorization && token) {
    return new TrueForge({ baseUrl: trueforgeOrigin(), token });
  }
  return new TrueForge({ baseUrl: trueforgeOrigin(), auth: false });
}

export async function trueforgeModelChoice(): Promise<{
  primary: string;
  fallback: string | null;
}> {
  if (modelsLoaded) return { primary: primaryModel, fallback: fallbackModel };
  try {
    const listed = await client().models.list();
    const models = listed.data ?? [];
    const preferred = preferAetherExpertModel(models)?.name;
    primaryModel = preferred || AETHER_EXPERT_MODEL_FQN;
    fallbackModel =
      models.find((model) => model.name === AETHER_OPENROUTER_EXPERT_FQN)?.name ??
      null;
    if (fallbackModel === primaryModel) fallbackModel = null;
  } catch {
    return { primary: AETHER_EXPERT_MODEL_FQN, fallback: null };
  }
  modelsLoaded = true;
  return { primary: primaryModel, fallback: fallbackModel };
}

async function findSession(conversationId: string): Promise<CachedSession | null> {
  const cached = sessions.get(conversationId);
  if (cached) {
    rememberTrueForgeSession(conversationId, cached);
    return sessions.get(conversationId) ?? cached;
  }
  const page = await client().sessions.list({
    metadata: { aetherConversationId: conversationId },
    limit: 1,
  });
  for await (const row of page) {
    rememberTrueForgeSession(conversationId, { id: row.id, model: "" });
    return sessions.get(conversationId) ?? null;
  }
  return null;
}

export function buildTrueForgeAgentSpec(input: {
  modelName: string;
  instructions: string;
  mcp: { direct: string; includeAccountTools: boolean } | null;
  sandboxEnabled: boolean;
}) {
  const reasoningEffort = modelProfile(input.modelName).reasoningEffort;
  return {
    spec: {
      model: {
        name: input.modelName,
        ...(reasoningEffort ? { params: { reasoningEffort } } : {}),
      },
      instructions: input.instructions,
      config: { sandbox: { enabled: input.sandboxEnabled } },
      ...(input.mcp
        ? { mcpServers: aetherMcpServers({ direct: input.mcp.direct }, input.mcp.includeAccountTools) }
        : {}),
    },
  };
}

async function attachTools(
  conversationId: string,
  toolContext: Omit<TrueForgeToolContext, "exp"> | null | undefined,
): Promise<{ direct: string; includeAccountTools: boolean; token: string } | null> {
  if (!toolContext) return null;
  return ensureAetherMcpServer({
    client: client(),
    conversationId,
    context: toolContext,
  });
}

/** One TrueForge session per Aether conversation id. Skips update when nothing changed. */
export async function trueforgeSessionId(input: TrueForgeSessionInput): Promise<CachedSession> {
  await pruneTrueForgeCaches();
  const secret = trueforgeToken();
  const token =
    input.toolContext && secret
      ? cachedToolContextToken(input.conversationId, input.toolContext, secret)
      : "";
  const plannedNames = token ? aetherMcpServerNames(input.conversationId) : null;
  const includeAccountTools = needsDeferredAetherTools(input.toolContext);
  const sandboxEnabled = await trueforgeSandboxEnabled();
  const plannedKey = `${
    plannedNames ? `${plannedNames.direct}:${includeAccountTools ? "all" : "web"}:${token}` : ""
  }:${sandboxEnabled ? "1" : "0"}`;
  const existing = await findSession(input.conversationId);
  if (
    existing?.model === input.modelName &&
    existing.instructions === input.instructions &&
    existing.mcpKey === plannedKey
  ) {
    return existing;
  }
  const mcp = plannedNames ? await attachTools(input.conversationId, input.toolContext) : null;
  if (
    shouldSkipFailedRegistrationUpdate({
      existing,
      mcpAttached: mcp != null,
      modelName: input.modelName,
    })
  ) {
    return existing as CachedSession;
  }
  const instructions = instructionsForRegisteredTools(input.instructions, mcp != null);
  const mcpKey = `${
    mcp ? `${mcp.direct}:${mcp.includeAccountTools ? "all" : "web"}:${mcp.token}` : ""
  }:${sandboxEnabled ? "1" : "0"}`;
  if (existing) {
    const model = input.modelName;
    existing.model = model;
    existing.instructions = instructions;
    existing.mcpKey = mcpKey;
    existing.toolsAttached = mcp != null;
    existing.at = Date.now();
    await client().sessions.update(existing.id, {
      agent: buildTrueForgeAgentSpec({
        modelName: model,
        instructions,
        mcp,
        sandboxEnabled,
      }),
    });
    rememberTrueForgeSession(input.conversationId, existing);
    return existing;
  }
  const created = await client().sessions.create({
    agent: buildTrueForgeAgentSpec({
      modelName: input.modelName,
      instructions,
      mcp,
      sandboxEnabled,
    }),
    metadata: { aetherConversationId: input.conversationId },
  });
  const row: CachedSession = {
    id: created.data.id,
    model: input.modelName,
    instructions,
    mcpKey,
    toolsAttached: mcp != null,
    at: Date.now(),
  };
  rememberTrueForgeSession(input.conversationId, row);
  return row;
}

/** Point later turns at the fallback model after a primary failure. */
export async function switchTrueForgeSessionModel(input: {
  conversationId: string;
  sessionId: string;
  modelName: string;
  instructions: string;
  mcpName?: string | null;
}): Promise<void> {
  await client().sessions.update(input.sessionId, {
    agent: buildTrueForgeAgentSpec({
      modelName: input.modelName,
      instructions: input.instructions,
      mcp: null,
      sandboxEnabled: await trueforgeSandboxEnabled(),
    }),
  });
  const cached = sessions.get(input.conversationId);
  if (cached) {
    cached.model = input.modelName;
    cached.instructions = input.instructions;
    rememberTrueForgeSession(input.conversationId, cached);
  } else {
    rememberTrueForgeSession(input.conversationId, { id: input.sessionId, model: input.modelName });
  }
}

export function trueforgeClient() {
  return client();
}
