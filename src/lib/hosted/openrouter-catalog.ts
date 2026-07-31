/**
 * Server-side OpenRouter model list for Aether Cloud.
 * Public /models endpoint — no API key required. Cached in-process.
 */

import {
  pickDefaultModel,
  rankModelsForPicker,
  type RankedModelOption,
} from "./rank-models";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const CACHE_TTL_MS = 60 * 60 * 1000;

type OpenRouterModel = {
  id: string;
  name: string;
  context_length?: number;
};

type CacheEntry = {
  at: number;
  models: RankedModelOption[];
  defaultModel: string;
};

let cache: CacheEntry | null = null;

export async function fetchRankedHostedCatalog(): Promise<{
  models: RankedModelOption[];
  defaultModel: string;
}> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { models: cache.models, defaultModel: cache.defaultModel };
  }

  const res = await fetch(OPENROUTER_MODELS_URL, {
    headers: { "Content-Type": "application/json" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`OpenRouter models HTTP ${res.status}`);
  }
  const json = (await res.json()) as { data: OpenRouterModel[] };
  const models = rankModelsForPicker(json.data ?? []);
  const defaultModel = pickDefaultModel(models);
  cache = { at: Date.now(), models, defaultModel };
  return { models, defaultModel };
}
