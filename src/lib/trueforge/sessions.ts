import { TrueForge } from "@truefoundry/trueforge-sdk";
import { trueforgeOrigin } from "./config";
import {
  AETHER_EXPERT_MODEL_FQN,
  AETHER_OPENROUTER_EXPERT_FQN,
  preferAetherExpertModel,
} from "./providers";

type CachedSession = { id: string; model: string };

const sessions = new Map<string, CachedSession>();
let modelsLoaded = false;
let primaryModel = AETHER_EXPERT_MODEL_FQN;
let fallbackModel: string | null = null;

function client() {
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

function agentSpec(modelName: string, instructions: string) {
  return {
    spec: {
      model: { name: modelName, params: { reasoningEffort: "low" as const } },
      instructions,
    },
  };
}

/** One TrueForge session per Aether conversation id. */
export async function trueforgeSessionId(input: {
  conversationId: string;
  modelName: string;
  instructions: string;
}): Promise<CachedSession> {
  const existing = await findSession(input.conversationId);
  if (existing) {
    const model = existing.model || input.modelName;
    existing.model = model;
    if (input.instructions) {
      await client().sessions.update(existing.id, {
        agent: agentSpec(model, input.instructions),
      });
    }
    return existing;
  }
  const created = await client().sessions.create({
    agent: agentSpec(input.modelName, input.instructions),
    metadata: { aetherConversationId: input.conversationId },
  });
  const row = { id: created.data.id, model: input.modelName };
  sessions.set(input.conversationId, row);
  return row;
}

/** Point later turns at the fallback model after a primary failure. */
export async function switchTrueForgeSessionModel(input: {
  conversationId: string;
  sessionId: string;
  modelName: string;
  instructions: string;
}): Promise<void> {
  await client().sessions.update(input.sessionId, {
    agent: agentSpec(input.modelName, input.instructions),
  });
  const cached = sessions.get(input.conversationId);
  if (cached) cached.model = input.modelName;
  else sessions.set(input.conversationId, { id: input.sessionId, model: input.modelName });
}

export function trueforgeClient() {
  return client();
}
