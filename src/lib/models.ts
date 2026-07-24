export type ProviderId = "openrouter" | "openai" | "anthropic" | "custom";

export type ModelOption = {
  id: string;
  label: string;
  provider: ProviderId;
  description?: string;
};

// ─── Live model fetching from OpenRouter public API ───

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const CACHE_KEY = "aether:models-cache:v2";
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

type OpenRouterModel = {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
};

type ModelCache = {
  timestamp: number;
  models: ModelOption[];
};

// Providers we show in the picker (filters out niche/roleplay models)
const FEATURED_PREFIXES = [
  "anthropic/",
  "openai/",
  "google/",
  "deepseek/",
  "moonshotai/",
  "qwen/",
  "z-ai/",
  "meta/",
  "meta-llama/",
  "x-ai/",
];

function cleanLabel(name: string): string {
  return name.replace(/^[^:]+:\s*/, "").trim();
}

function isFreeModel(id: string): boolean {
  return id.includes(":free");
}

export async function fetchOpenRouterModels(): Promise<ModelOption[]> {
  const res = await fetch(OPENROUTER_MODELS_URL, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { data: OpenRouterModel[] };

  return json.data
    .filter(
      (m) =>
        FEATURED_PREFIXES.some((p) => m.id.startsWith(p)) &&
        !isFreeModel(m.id) &&
        !m.id.startsWith("~"),
    )
    .map((m) => ({
      id: m.id,
      label: cleanLabel(m.name),
      provider: "openrouter" as ProviderId,
      description: m.context_length
        ? `${(m.context_length / 1000).toFixed(0)}K context`
        : undefined,
    }));
}

export function getCachedModels(): ModelOption[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as ModelCache;
    if (Date.now() - cache.timestamp > CACHE_TTL) return null;
    return cache.models;
  } catch {
    return null;
  }
}

export function setCachedModels(models: ModelOption[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ timestamp: Date.now(), models }),
    );
  } catch {
    /* ignore */
  }
}

/** No hardcoded fallback — models always come from the live OpenRouter API. */
export const DEFAULT_MODEL = "";

export const PROVIDER_DEFAULTS: Record<
  ProviderId,
  { label: string; baseURL: string; docsUrl?: string }
> = {
  openrouter: {
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    docsUrl: "https://openrouter.ai/keys",
  },
  openai: {
    label: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    docsUrl: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    label: "Anthropic",
    baseURL: "https://api.anthropic.com/v1",
    docsUrl: "https://console.anthropic.com/settings/keys",
  },
  custom: {
    label: "Custom (OpenAI-compatible)",
    baseURL: "",
  },
};

export function getModelLabel(modelId: string): string {
  if (!modelId) return "Select a model";
  // Check cached live models for the label
  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const cache = JSON.parse(raw) as ModelCache;
        const cached = cache.models.find((m) => m.id === modelId);
        if (cached) return cached.label;
      }
    } catch {
      /* ignore */
    }
  }
  // Show a short id for custom/unknown models (last segment)
  const parts = modelId.split("/");
  return parts[parts.length - 1] || modelId;
}
