import { TrueForge } from "@truefoundry/trueforge-sdk";
import { trueforgeOrigin } from "./config";
import {
  AETHER_EXPERT_MODEL_FQN,
  preferAetherExpertModel,
} from "./providers";

const sessions = new Map<string, string>();
let modelName: string | null = null;

function client() {
  return new TrueForge({ baseUrl: trueforgeOrigin(), auth: false });
}

async function expertModelName(): Promise<string> {
  if (modelName) return modelName;
  try {
    const listed = await client().models.list();
    const models = listed.data ?? [];
    modelName = preferAetherExpertModel(models)?.name || AETHER_EXPERT_MODEL_FQN;
  } catch {
    modelName = AETHER_EXPERT_MODEL_FQN;
  }
  return modelName;
}

/** One TrueForge session per Aether conversation id. */
export async function trueforgeSessionId(conversationId: string): Promise<string> {
  const existing = sessions.get(conversationId);
  if (existing) return existing;
  const model = await expertModelName();
  const created = await client().sessions.create({
    agent: {
      spec: {
        model: { name: model, params: { reasoningEffort: "low" } },
        instructions:
          "You are Aether. Answer in the same voice as a calm expert assistant. Use tools when they help.",
      },
    },
    metadata: { aetherConversationId: conversationId },
  });
  const id = created.data.id;
  sessions.set(conversationId, id);
  return id;
}

export function trueforgeClient() {
  return client();
}
