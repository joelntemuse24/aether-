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
    id: "anthropic/claude-sonnet-4",
    label: "Claude Sonnet 4",
    provider: "openrouter",
    description: "Balanced reasoning & speed",
  },
  {
    id: "anthropic/claude-opus-4",
    label: "Claude Opus 4",
    provider: "openrouter",
    description: "Highest quality",
  },
  {
    id: "openai/gpt-4.1",
    label: "GPT-4.1",
    provider: "openrouter",
  },
  {
    id: "openai/gpt-4.1-mini",
    label: "GPT-4.1 Mini",
    provider: "openrouter",
  },
  {
    id: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "openrouter",
  },
  {
    id: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: "openrouter",
  },
  {
    id: "deepseek/deepseek-chat-v3-0324",
    label: "DeepSeek V3",
    provider: "openrouter",
  },
  {
    id: "deepseek/deepseek-r1",
    label: "DeepSeek R1",
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
    id: "z-ai/glm-4.5",
    label: "GLM-4.5",
    provider: "openrouter",
  },
  {
    id: "meta-llama/llama-4-maverick",
    label: "Llama 4 Maverick",
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
  // Show a short id for custom models (last segment)
  const parts = modelId.split("/");
  return parts[parts.length - 1] || modelId;
}
