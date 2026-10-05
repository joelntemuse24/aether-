import { TrueForge } from "@truefoundry/trueforge-sdk";
import {
  trueforgeAuthHeaders,
  trueforgeOrigin,
  trueforgeSandboxEnabled,
  trueforgeToken,
} from "./config";
import { instructionsForAttachedTools } from "./instructions";
import { toolContextKey } from "./tool-context";
import {
  aetherMcpServerNames,
  aetherMcpServers,
  cachedToolContextToken,
  ensureAetherMcpServer,
  evictSignedToolTokens,
  needsDeferredAetherTools,
  releaseAetherMcpSlot,
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
  /** Signed-in user id or guest cookie id. Sessions are not shared across owners. */
  owner: string;
  modelName: string;
  instructions: string;
  toolContext?: Omit<TrueForgeToolContext, "exp"> | null;
};

export function trueforgeSessionCacheKey(owner: string, conversationId: string): string {
  return `${owner}\n${conversationId}`;
}

export function conversationIdFromSessionCacheKey(key: string): string {
  const split = key.indexOf("\n");
  return split >= 0 ? key.slice(split + 1) : key;
}

let loggedMissingContextKey = false;

/** Production without the Vercel-only key skips tool registration. The chat shows the no-tools notice. */
export function warnMissingToolContextKey(env: NodeJS.ProcessEnv = process.env): boolean {
  const missing = env.NODE_ENV === "production" && !(env.AETHER_TOOL_CONTEXT_KEY ?? "").trim();
  if (missing && !loggedMissingContextKey) {
    loggedMissingContextKey = true;
    console.error(
      "[trueforge] AETHER_TOOL_CONTEXT_KEY is not set. Tools are not registered for this turn. Set it on Vercel only, not on the VM.",
    );
  }
  return missing;
}

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
  for (const key of dropped) {
    const slotName = releaseAetherMcpSlot(conversationIdFromSessionCacheKey(key));
    if (slotName) await removeAetherMcpServer(slotName);
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

async function findSession(owner: string, conversationId: string): Promise<CachedSession | null> {
  const key = trueforgeSessionCacheKey(owner, conversationId);
  const cached = sessions.get(key);
  if (cached) {
    rememberTrueForgeSession(key, cached);
    return sessions.get(key) ?? cached;
  }
  const page = await client().sessions.list({
    metadata: { aetherConversationId: conversationId, aetherOwner: owner },
    limit: 1,
  });
  for await (const row of page) {
    rememberTrueForgeSession(key, { id: row.id, model: "" });
    return sessions.get(key) ?? null;
  }
  return null;
}

/** The question tool never renders. Models assume and state the assumption. */
export const ASK_USER_QUESTIONS_ENABLED = false;

export function hostedRuntimeKey(sandboxEnabled: boolean): string {
  return `${sandboxEnabled ? "1" : "0"}:ask${ASK_USER_QUESTIONS_ENABLED ? "1" : "0"}`;
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
      config: {
        sandbox: { enabled: input.sandboxEnabled },
        dynamic_sub_agents: { enabled: true },
        context_management: { compaction: { enabled: true } },
        ask_user_questions: { enabled: ASK_USER_QUESTIONS_ENABLED },
        generative_ui: { enabled: false },
      },
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

export type TrueForgeSessionResult = CachedSession & {
  /** False when this conversation already had a session. */
  created: boolean;
};

function sessionResult(row: CachedSession, created: boolean): TrueForgeSessionResult {
  return { ...row, created };
}

const UNKNOWN_MODEL_PATTERN = /Unknown model .* not configured/i;
export const UNKNOWN_MODEL_RETRY_MS = 3000;

/** The sidecar answers 422 "Unknown model ... not configured" while it re-seeds after a reload. */
export function isUnknownModelError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = (err as { statusCode?: unknown }).statusCode;
  if (status != null && status !== 422) return false;
  const body = (err as { body?: unknown }).body;
  const text = `${err.message}\n${body == null ? "" : JSON.stringify(body)}`;
  return UNKNOWN_MODEL_PATTERN.test(text);
}

/** Retry once after a short wait when the sidecar has not finished seeding the model. */
export async function retryOnUnknownModel<T>(
  run: () => Promise<T>,
  waitMs = UNKNOWN_MODEL_RETRY_MS,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!isUnknownModelError(err)) throw err;
    console.warn("[trueforge] model not configured yet; retrying once in", waitMs, "ms");
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return run();
  }
}

/** One TrueForge session per Aether conversation id. Skips update when nothing changed. */
export async function trueforgeSessionId(input: TrueForgeSessionInput): Promise<TrueForgeSessionResult> {
  await pruneTrueForgeCaches();
  const secret = toolContextKey();
  if (!secret) warnMissingToolContextKey();
  const token =
    input.toolContext && secret
      ? cachedToolContextToken(input.conversationId, input.toolContext, secret)
      : "";
  const plannedNames = token ? aetherMcpServerNames(input.conversationId) : null;
  const includeAccountTools = needsDeferredAetherTools(input.toolContext);
  const sandboxEnabled = await trueforgeSandboxEnabled();
  const plannedKey = `${
    plannedNames ? `${plannedNames.direct}:${includeAccountTools ? "all" : "web"}:${token}` : ""
  }:${hostedRuntimeKey(sandboxEnabled)}`;
  const existing = await findSession(input.owner, input.conversationId);
  if (
    existing?.model === input.modelName &&
    existing.instructions === input.instructions &&
    existing.mcpKey === plannedKey
  ) {
    return sessionResult(existing, false);
  }
  const mcp = plannedNames ? await attachTools(input.conversationId, input.toolContext) : null;
  if (
    shouldSkipFailedRegistrationUpdate({
      existing,
      mcpAttached: mcp != null,
      modelName: input.modelName,
    })
  ) {
    return sessionResult(existing as CachedSession, false);
  }
  const attached = mcp
    ? [...(aetherMcpServers({ direct: mcp.direct }, mcp.includeAccountTools)[0]?.enableTools ?? [])]
    : [];
  const instructions = instructionsForAttachedTools(input.instructions, attached);
  const mcpKey = `${
    mcp ? `${mcp.direct}:${mcp.includeAccountTools ? "all" : "web"}:${mcp.token}` : ""
  }:${hostedRuntimeKey(sandboxEnabled)}`;
  if (existing) {
    const model = input.modelName;
    existing.model = model;
    existing.instructions = instructions;
    existing.mcpKey = mcpKey;
    existing.toolsAttached = mcp != null;
    existing.at = Date.now();
    await retryOnUnknownModel(() =>
      client().sessions.update(existing.id, {
        agent: buildTrueForgeAgentSpec({
          modelName: model,
          instructions,
          mcp,
          sandboxEnabled,
        }),
      }),
    );
    rememberTrueForgeSession(trueforgeSessionCacheKey(input.owner, input.conversationId), existing);
    return sessionResult(existing, false);
  }
  const created = await retryOnUnknownModel(() =>
    client().sessions.create({
      agent: buildTrueForgeAgentSpec({
        modelName: input.modelName,
        instructions,
        mcp,
        sandboxEnabled,
      }),
      metadata: { aetherConversationId: input.conversationId, aetherOwner: input.owner },
    }),
  );
  const row: CachedSession = {
    id: created.data.id,
    model: input.modelName,
    instructions,
    mcpKey,
    toolsAttached: mcp != null,
    at: Date.now(),
  };
  rememberTrueForgeSession(trueforgeSessionCacheKey(input.owner, input.conversationId), row);
  return sessionResult(row, true);
}

/** Point later turns at the fallback model after a primary failure. */
export async function switchTrueForgeSessionModel(input: {
  conversationId: string;
  owner?: string;
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
  const key = trueforgeSessionCacheKey(input.owner ?? "", input.conversationId);
  const cached = sessions.get(key);
  if (cached) {
    cached.model = input.modelName;
    cached.instructions = input.instructions;
    rememberTrueForgeSession(key, cached);
  } else {
    rememberTrueForgeSession(key, { id: input.sessionId, model: input.modelName });
  }
}

export function trueforgeClient() {
  return client();
}
