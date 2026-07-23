export type ProviderId = "openrouter" | "openai" | "anthropic" | "custom";

export type ModelOption = {
  id: string;
  label: string;
  provider: ProviderId;
  description?: string;
};

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
