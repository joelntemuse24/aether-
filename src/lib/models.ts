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

/** Curated OpenRouter / multi-provider models for the picker (fallback when API is unreachable). */
export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: "anthropic/claude-sonnet-4",
    label: "Claude Sonnet 4",
    provider: "openrouter",
    description: "Balanced reasoning & speed",
  },
  {
    id: "anthropic/claude-3.5-sonnet",
    label: "Claude 3.5 Sonnet",
    provider: "openrouter",
    description: "Previous generation",
  },
  {
    id: "anthropic/claude-3.5-haiku",
    label: "Claude 3.5 Haiku",
    provider: "openrouter",
    description: "Fast & affordable",
  },
  {
    id: "openai/gpt-4o",
    label: "GPT-4o",
    provider: "openrouter",
    description: "OpenAI frontier",
  },
  {
    id: "openai/gpt-4o-mini",
    label: "GPT-4o Mini",
    provider: "openrouter",
    description: "Fast & affordable",
  },
  {
    id: "google/gemini-2.0-flash-001",
    label: "Gemini 2.0 Flash",
    provider: "openrouter",
    description: "Fast & capable",
  },
  {
    id: "google/gemini-pro-1.5",
    label: "Gemini Pro 1.5",
    provider: "openrouter",
  },
  {
    id: "deepseek/deepseek-r1",
    label: "DeepSeek R1",
    provider: "openrouter",
    description: "Open-source reasoning",
  },
  {
    id: "deepseek/deepseek-chat",
    label: "DeepSeek Chat",
    provider: "openrouter",
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
    id: "meta-llama/llama-3.3-70b-instruct",
    label: "Llama 3.3 70B",
    provider: "openrouter",
  },
  {
    id: "x-ai/grok-2-1212",
    label: "Grok 2",
    provider: "openrouter",
  },
];

export const DEFAULT_MODEL = "anthropic/claude-sonnet-4";

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
  // Check cached live models for a better label
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
  // Show a short id for custom models (last segment)
  const parts = modelId.split("/");
  return parts[parts.length - 1] || modelId;
}
