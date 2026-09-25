/**
 * Hosted Expert providers for the TrueForge sidecar.
 * Keys stay in server env. This is not a customer BYOK path.
 * GPT models use Buzz's OpenAI-compatible /v1. Claude models use Buzz's Anthropic API.
 */

const KNOWN_CHAT_MODEL_IDS = [
  "claude-sonnet-5",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-6-astra",
  "gpt-6-sol",
];

function chatModelIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (id.startsWith("gpt-image-")) continue;
    if (!id.startsWith("gpt-") && !id.startsWith("claude-")) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export const AETHER_BUZZ_PROVIDER = "buzz";
export const AETHER_OPENROUTER_PROVIDER = "openrouter";
/** Composer FQN. Expert default is GPT-5.6 Luna on Buzz. */
export const AETHER_EXPERT_MODEL_FQN = "buzz/gpt-5-6-luna";
export const AETHER_OPENROUTER_EXPERT_FQN = "openrouter/gpt-5-6-luna";

export const DEFAULT_BUZZ_BASE_URL = "https://api.buzzai.cc/v1";
export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

export type ModelProfile = {
  contextLength: number;
  maxOutputTokens: number;
  reasoningEfforts: ReasoningEffort[];
  /** Sent on the session. Absent means the provider should use its own default. */
  reasoningEffort?: ReasoningEffort;
};

const GPT56_EFFORTS: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh", "max"];
const GPT6_EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];

const UNKNOWN_PROFILE: ModelProfile = {
  contextLength: 200_000,
  maxOutputTokens: 64_000,
  reasoningEfforts: [],
};

function bareModelId(id: string): string {
  return (id.split("/").pop() ?? id).trim().toLowerCase();
}

/** Family defaults. Unknown ids stay conservative so a bad effort cannot 400 the turn. */
export function modelProfile(id: string): ModelProfile {
  const bare = bareModelId(id);
  if (bare.includes("claude")) {
    const haiku = bare.includes("haiku");
    const opus = bare.includes("opus");
    const fable = bare.includes("fable");
    return {
      contextLength: 200_000,
      maxOutputTokens: haiku || (!opus && !fable) ? 64_000 : 128_000,
      reasoningEfforts: [],
    };
  }
  if (bare.includes("gpt-6") || bare.includes("gpt.6")) {
    return {
      contextLength: 1_050_000,
      maxOutputTokens: 128_000,
      reasoningEfforts: GPT6_EFFORTS,
      reasoningEffort: "low",
    };
  }
  if (bare.includes("gpt-5") || bare.includes("gpt.5")) {
    return {
      contextLength: 1_050_000,
      maxOutputTokens: 128_000,
      reasoningEfforts: GPT56_EFFORTS,
      reasoningEffort: "none",
    };
  }
  if (bare.startsWith("gpt")) {
    return {
      contextLength: 1_050_000,
      maxOutputTokens: 128_000,
      reasoningEfforts: GPT6_EFFORTS,
      reasoningEffort: "low",
    };
  }
  return UNKNOWN_PROFILE;
}

export type AetherConfiguredModel = {
  modelId: string;
  name: string;
  properties: {
    contextLength: number;
    maxOutputTokens: number;
    reasoningEfforts: ReasoningEffort[];
  };
};

/** Body for `PUT /api/v1/settings/model-providers` (custom OpenAI-compatible). */
export type AetherProviderManifest =
  | {
      type: "custom";
      name: string;
      baseUrl: string;
      auth: { apiKey: string };
      models: AetherConfiguredModel[];
    }
  | {
      type: "anthropic";
      baseUrl: string;
      auth: { apiKey: string };
      models: AetherConfiguredModel[];
    };

export const BUZZ_ANTHROPIC_BASE_URL = "https://api.buzzai.cc/v1";

function envPlain(env: Record<string, string | undefined>, name: string): string {
  return (env[name] ?? "").trim();
}

/** Keys only. A copied base URL in the key slot is not a credential. */
function envSecret(env: Record<string, string | undefined>, name: string): string {
  const value = envPlain(env, name);
  if (/^https?:\/\//i.test(value)) return "";
  return value;
}

/** Dashboard copies https://api.buzzai.cc; Chat Completions needs /v1. */
export function normalizeBuzzBaseUrl(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/\/$/, "");
  if (
    trimmed === "" ||
    trimmed === "https://api.buzzai.cc" ||
    trimmed === "https://buzzai.cc" ||
    trimmed === "http://api.buzzai.cc" ||
    trimmed === "http://buzzai.cc"
  ) {
    if (
      trimmed === "" ||
      trimmed === "https://api.buzzai.cc" ||
      trimmed === "https://buzzai.cc"
    ) {
      return DEFAULT_BUZZ_BASE_URL;
    }
    return `${trimmed}/v1`;
  }
  return trimmed;
}

function buzzModel(modelId: string, name: string): AetherConfiguredModel {
  const profile = modelProfile(modelId);
  return {
    modelId,
    name,
    properties: {
      contextLength: profile.contextLength,
      maxOutputTokens: profile.maxOutputTokens,
      reasoningEfforts: profile.reasoningEfforts,
    },
  };
}

/**
 * Buzz chat models for the sidecar. GPT uses the OpenAI-compatible host.
 * Claude uses the Anthropic-compatible host. OpenRouter is not seeded here.
 */
export function aetherProviderManifests(
  env: Record<string, string | undefined> = process.env,
  modelIds: readonly string[] = KNOWN_CHAT_MODEL_IDS,
): AetherProviderManifest[] {
  const buzzKey =
    envSecret(env, "AETHER_HOSTED_BUZZ_API_KEY") ||
    envSecret(env, "AETHER_HOSTED_CLAUDE_API_KEY");
  if (!buzzKey) return [];
  const ids = chatModelIds(modelIds);
  const gpt = ids.filter((id) => id.startsWith("gpt-"));
  const claude = ids.filter((id) => id.startsWith("claude-"));
  const base = normalizeBuzzBaseUrl(
    envPlain(env, "AETHER_HOSTED_BUZZ_BASE_URL") ||
      envPlain(env, "AETHER_HOSTED_CLAUDE_BASE_URL"),
  );
  const manifests: AetherProviderManifest[] = [];
  if (gpt.length) {
    manifests.push({
      type: "custom",
      name: AETHER_BUZZ_PROVIDER,
      baseUrl: base,
      auth: { apiKey: buzzKey },
      models: gpt.map((id) => buzzModel(id, id.replace(/\./g, "-"))),
    });
  }
  if (claude.length) {
    manifests.push({
      type: "anthropic",
      baseUrl: BUZZ_ANTHROPIC_BASE_URL,
      auth: { apiKey: buzzKey },
      models: claude.map((id) => buzzModel(id, id.replace(/\./g, "-"))),
    });
  }
  return manifests;
}

export function preferAetherExpertModel<T extends { name: string }>(
  models: T[],
): T | undefined {
  return models.find((model) => model.name === AETHER_EXPERT_MODEL_FQN) ?? models[0];
}
