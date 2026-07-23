export type ProviderId = "openrouter" | "openai" | "anthropic" | "custom";

export type ModelOption = {
  id: string;
  label: string;
  provider: ProviderId;
  description?: string;
};

// ─── Live model fetching from OpenRouter public API ───

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const CACHE_KEY = "aether:models-cache:v1";
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
  try {
    const res = await fetch(OPENROUTER_MODELS_URL, {
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { data: OpenRouterModel[] };

    const filtered = json.data
      .filter(
        (m) =>
          FEATURED_PREFIXES.some((p) => m.id.startsWith(p)) &&
          !isFreeModel(m.id) &&
          !m.id.startsWith("~"), // skip alias entries
      )
      .map((m) => ({
        id: m.id,
        label: cleanLabel(m.name),
        provider: "openrouter" as ProviderId,
        description: m.context_length
          ? `${(m.context_length / 1000).toFixed(0)}K context`
          : undefined,
      }));

    return filtered.length > 0 ? filtered : MODEL_OPTIONS;
  } catch {
    return MODEL_OPTIONS;
  }
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

/** Curated OpenRouter / multi-provider models for the picker. */
export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: "anthropic/claude-fable-5",
    label: "Claude Fable 5",
    provider: "openrouter",
    description: "Frontier — autonomous & coding",
  },
  {
    id: "anthropic/claude-sonnet-5",
    label: "Claude Sonnet 5",
    provider: "openrouter",
    description: "Balanced reasoning & speed",
  },
  {
    id: "anthropic/claude-opus-4.8",
    label: "Claude Opus 4.8",
    provider: "openrouter",
    description: "Highest quality reasoning",
  },
  {
    id: "anthropic/claude-haiku-4.5",
    label: "Claude Haiku 4.5",
    provider: "openrouter",
    description: "Fast & affordable",
  },
  {
    id: "openai/gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    provider: "openrouter",
    description: "OpenAI frontier",
  },
  {
    id: "openai/gpt-5.5",
    label: "GPT-5.5",
    provider: "openrouter",
  },
  {
    id: "google/gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    provider: "openrouter",
    description: "Google frontier",
  },
  {
    id: "google/gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    provider: "openrouter",
    description: "Fast & capable",
  },
  {
    id: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "openrouter",
  },
  {
    id: "deepseek/deepseek-r1",
    label: "DeepSeek R1",
    provider: "openrouter",
    description: "Open-source reasoning",
  },
  {
    id: "moonshotai/kimi-k2",
    label: "Kimi K2",
    provider: "openrouter",
  },
  {
    id: "qwen/qwen3-235b-a22b",
    label: "Qwen3 235B",
    provider: "openrouter",
  },
  {
    id: "z-ai/glm-4.5",
    label: "GLM-4.5",
    provider: "openrouter",
  },
  {
    id: "meta/muse-spark-1.1",
    label: "Muse Spark 1.1",
    provider: "openrouter",
    description: "Meta's latest",
  },
  {
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    provider: "openrouter",
    description: "Open-source, smart coding",
  },
];

export const DEFAULT_MODEL = "anthropic/claude-sonnet-5";

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
  const found = MODEL_OPTIONS.find((m) => m.id === modelId);
  if (found) return found.label;
  // Show a short id for custom models (last segment)
  const parts = modelId.split("/");
  return parts[parts.length - 1] || modelId;
}
