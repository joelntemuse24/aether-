/**
 * Hosted Aether model providers for local TrueForge.
 * Keys stay in server env. Nothing here is a customer BYOK path.
 */

export const AETHER_TENANT_ID = 'default';
export const AETHER_BUZZ_PROVIDER = 'buzz';
export const AETHER_OPENROUTER_PROVIDER = 'openrouter';
/** Composer FQN. Expert default is GPT-5.6 Luna on Buzz. */
export const AETHER_EXPERT_MODEL_FQN = 'buzz/gpt-5-6-luna';

export const DEFAULT_BUZZ_BASE_URL = 'https://api.buzzai.cc/v1';
export const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type AetherConfiguredModel = {
  model_id: string;
  name: string;
  properties: {
    context_length: number;
    max_output_tokens: number;
    reasoning_efforts: ReasoningEffort[];
  };
};

export type AetherProviderManifest = {
  type: 'custom';
  name: string;
  base_url: string;
  auth: { api_key: string };
  models: AetherConfiguredModel[];
};

const LUNA_EFFORTS: ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];

const LUNA_PROPERTIES: AetherConfiguredModel['properties'] = {
  context_length: 1_050_000,
  max_output_tokens: 128_000,
  reasoning_efforts: LUNA_EFFORTS,
};

function envValue(env: NodeJS.ProcessEnv, name: string): string {
  return (env[name] ?? '').trim();
}

/** Dashboard copies https://api.buzzai.cc; Chat Completions needs /v1. */
export function normalizeBuzzBaseUrl(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/\/$/, '');
  if (
    trimmed === '' ||
    trimmed === 'https://api.buzzai.cc' ||
    trimmed === 'https://buzzai.cc' ||
    trimmed === 'http://api.buzzai.cc' ||
    trimmed === 'http://buzzai.cc'
  ) {
    if (trimmed === '' || trimmed === 'https://api.buzzai.cc' || trimmed === 'https://buzzai.cc') {
      return DEFAULT_BUZZ_BASE_URL;
    }
    return `${trimmed}/v1`;
  }
  return trimmed;
}

function buzzModel(modelId: string, name: string): AetherConfiguredModel {
  return { model_id: modelId, name, properties: LUNA_PROPERTIES };
}

/**
 * Providers to upsert when the matching server key is set.
 * Buzz is listed first so a fresh database exposes Luna before the OpenRouter catalog.
 */
export function aetherProviderManifests(env: NodeJS.ProcessEnv = process.env): AetherProviderManifest[] {
  const manifests: AetherProviderManifest[] = [];

  const buzzKey =
    envValue(env, 'AETHER_HOSTED_BUZZ_API_KEY') || envValue(env, 'AETHER_HOSTED_CLAUDE_API_KEY');
  if (buzzKey) {
    const base = normalizeBuzzBaseUrl(
      envValue(env, 'AETHER_HOSTED_BUZZ_BASE_URL') || envValue(env, 'AETHER_HOSTED_CLAUDE_BASE_URL'),
    );
    manifests.push({
      type: 'custom',
      name: AETHER_BUZZ_PROVIDER,
      base_url: base,
      auth: { api_key: buzzKey },
      models: [buzzModel('gpt-5.6-luna', 'gpt-5-6-luna'), buzzModel('gpt-5.6-sol', 'gpt-5-6-sol')],
    });
  }

  const openRouterKey = envValue(env, 'OPENROUTER_API_KEY');
  if (openRouterKey) {
    const base = envValue(env, 'OPENROUTER_BASE_URL').replace(/\/$/, '') || DEFAULT_OPENROUTER_BASE_URL;
    manifests.push({
      type: 'custom',
      name: AETHER_OPENROUTER_PROVIDER,
      base_url: base,
      auth: { api_key: openRouterKey },
      models: [
        buzzModel('openai/gpt-5.6-luna', 'gpt-5-6-luna'),
        buzzModel('openai/gpt-5.6-sol', 'gpt-5-6-sol'),
        buzzModel('openai/gpt-5.6-terra', 'gpt-5-6-terra'),
      ],
    });
  }

  return manifests;
}

export function preferAetherExpertModel<T extends { name: string }>(models: T[]): T | undefined {
  return models.find(model => model.name === AETHER_EXPERT_MODEL_FQN) ?? models[0];
}
