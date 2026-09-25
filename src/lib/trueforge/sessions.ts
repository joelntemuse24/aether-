import { TrueForge } from "@truefoundry/trueforge-sdk";
import { trueforgeAuthHeaders, trueforgeOrigin, trueforgeToken } from "./config";
import {
  aetherMcpServerName,
  aetherMcpSpec,
  cachedToolContextToken,
  ensureAetherMcpServer,
} from "./mcp-register";
import {
  AETHER_EXPERT_MODEL_FQN,
  AETHER_OPENROUTER_EXPERT_FQN,
  preferAetherExpertModel,
} from "./providers";
import type { TrueForgeToolContext } from "./tool-context";

type CachedSession = {
  id: string;
  model: string;
  instructions?: string;
  mcpKey?: string;
};

export type TrueForgeSessionInput = {
  conversationId: string;
  modelName: string;
  instructions: string;
  toolContext?: Omit<TrueForgeToolContext, "exp"> | null;
};

const sessions = new Map<string, CachedSession>();
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
  if (cached) return cached;
  const page = await client().sessions.list({
    metadata: { aetherConversationId: conversationId },
    limit: 1,
  });
  for await (const row of page) {
    const found = { id: row.id, model: "" };
    sessions.set(conversationId, found);
    return found;
  }
  return null;
}

function agentSpec(modelName: string, instructions: string, mcpName: string | null) {
  return {
    spec: {
      model: { name: modelName, params: { reasoningEffort: "none" } },
      instructions,
      ...(mcpName ? { mcpServers: [aetherMcpSpec(mcpName)] } : {}),
    },
  };
}

async function attachTools(
  conversationId: string,
  toolContext: Omit<TrueForgeToolContext, "exp"> | null | undefined,
): Promise<{ name: string; token: string } | null> {
  if (!toolContext) return null;
  return ensureAetherMcpServer({
    client: client(),
    conversationId,
    context: toolContext,
  });
}

/** One TrueForge session per Aether conversation id. Skips update when nothing changed. */
export async function trueforgeSessionId(input: TrueForgeSessionInput): Promise<CachedSession> {
  const secret = trueforgeToken();
  const token =
    input.toolContext && secret
      ? cachedToolContextToken(input.conversationId, input.toolContext, secret)
      : "";
  const plannedName = token ? aetherMcpServerName(input.conversationId) : "";
  const plannedKey = token ? `${plannedName}:${token}` : "";
  const existing = await findSession(input.conversationId);
  if (
    existing?.model &&
    existing.instructions === input.instructions &&
    existing.mcpKey === plannedKey
  ) {
    return existing;
  }
  const mcp = plannedName ? await attachTools(input.conversationId, input.toolContext) : null;
  const mcpKey = mcp ? `${mcp.name}:${mcp.token}` : "";
  if (existing) {
    const model = existing.model || input.modelName;
    existing.model = model;
    existing.instructions = input.instructions;
    existing.mcpKey = mcpKey;
    await client().sessions.update(existing.id, {
      agent: agentSpec(model, input.instructions, mcp?.name ?? null),
    });
    return existing;
  }
  const created = await client().sessions.create({
    agent: agentSpec(input.modelName, input.instructions, mcp?.name ?? null),
    metadata: { aetherConversationId: input.conversationId },
  });
  const row: CachedSession = {
    id: created.data.id,
    model: input.modelName,
    instructions: input.instructions,
    mcpKey,
  };
  sessions.set(input.conversationId, row);
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
    agent: agentSpec(input.modelName, input.instructions, input.mcpName ?? null),
  });
  const cached = sessions.get(input.conversationId);
  if (cached) {
    cached.model = input.modelName;
    cached.instructions = input.instructions;
  } else {
    sessions.set(input.conversationId, { id: input.sessionId, model: input.modelName });
  }
}

export function trueforgeClient() {
  return client();
}
