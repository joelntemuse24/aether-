import type { ProviderId } from "./models";
import { DEFAULT_MODEL } from "./models";

const STORAGE_KEY = "aether:settings:v1";

const STALE_MODELS = [
  "anthropic/claude-fable-5",
  "anthropic/claude-sonnet-5",
  "anthropic/claude-opus-4.8",
  "anthropic/claude-haiku-4.5",
  "openai/gpt-5.6-sol",
  "openai/gpt-5.5",
  "google/gemini-3.1-pro-preview",
  "google/gemini-3.5-flash",
  "google/gemini-2.5-pro",
  "z-ai/glm-4.5",
  "meta/muse-spark-1.1",
  "openai/gpt-oss-120b",
];

export type AppSettings = {
  provider: ProviderId;
  /** Active API key for the selected provider */
  apiKey: string;
  /** OpenRouter key (kept when switching providers) */
  openrouterKey: string;
  openaiKey: string;
  anthropicKey: string;
  customKey: string;
  /** Base URL for custom / openai-compatible endpoints */
  baseURL: string;
  model: string;
  /** Optional custom model string when not picking from list */
  customModel: string;
  useCustomModel: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
  provider: "openrouter",
  apiKey: "",
  openrouterKey: "",
  openaiKey: "",
  anthropicKey: "",
  customKey: "",
  baseURL: "https://openrouter.ai/api/v1",
  model: DEFAULT_MODEL,
  customModel: "",
  useCustomModel: false,
};

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    // Migrate stale/fictional model IDs to the current default
    if (merged.model && STALE_MODELS.includes(merged.model)) {
      merged.model = DEFAULT_MODEL;
    }
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/** Resolve the key currently active for the chosen provider. */
export function resolveApiKey(settings: AppSettings): string {
  switch (settings.provider) {
    case "openrouter":
      return settings.openrouterKey || settings.apiKey;
    case "openai":
      return settings.openaiKey || settings.apiKey;
    case "anthropic":
      return settings.anthropicKey || settings.apiKey;
    case "custom":
      return settings.customKey || settings.apiKey;
    default:
      return settings.apiKey;
  }
}

export function resolveModel(settings: AppSettings): string {
  if (settings.useCustomModel && settings.customModel.trim()) {
    return settings.customModel.trim();
  }
  return settings.model;
}

export function resolveBaseURL(settings: AppSettings): string {
  if (settings.provider === "custom" && settings.baseURL.trim()) {
    return settings.baseURL.trim().replace(/\/$/, "");
  }
  if (settings.provider === "openrouter") {
    return "https://openrouter.ai/api/v1";
  }
  if (settings.provider === "openai") {
    return "https://api.openai.com/v1";
  }
  if (settings.provider === "anthropic") {
    return "https://api.anthropic.com/v1";
  }
  return settings.baseURL.trim().replace(/\/$/, "") || "https://openrouter.ai/api/v1";
}

/** Headers the client sends to /api/chat so the route can proxy with the user's key. */
export function buildChatHeaders(settings: AppSettings): Record<string, string> {
  const key = resolveApiKey(settings);
  return {
    "x-api-key": key,
    "x-provider": settings.provider,
    "x-base-url": resolveBaseURL(settings),
    "x-model": resolveModel(settings),
  };
}

export function hasValidKey(settings: AppSettings): boolean {
  return resolveApiKey(settings).trim().length > 0;
}
