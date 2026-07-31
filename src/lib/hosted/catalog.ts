/**
 * Curated Aether Cloud model catalog.
 * Presented as first-party models — upstream brands (OpenRouter, relay names)
 * are not exposed in the product UI.
 */

export type HostedModelFamily = "claude" | "gpt" | "other";

export type HostedModelOption = {
  id: string;
  label: string;
  family: HostedModelFamily;
  description?: string;
};

/** Default model when hosted mode has no selection yet. */
export const DEFAULT_HOSTED_MODEL = "claude-sonnet-4";

/**
 * User-facing catalog. IDs are stable Aether ids; the router maps them to
 * upstream provider model strings.
 */
export const HOSTED_CATALOG: HostedModelOption[] = [
  {
    id: "claude-sonnet-4",
    label: "Claude Sonnet 4",
    family: "claude",
    description: "Balanced — writing, coding, everyday work",
  },
  {
    id: "claude-opus-4",
    label: "Claude Opus 4",
    family: "claude",
    description: "Highest quality Claude for hard tasks",
  },
  {
    id: "claude-haiku-4.5",
    label: "Claude Haiku 4.5",
    family: "claude",
    description: "Fast and inexpensive",
  },
  {
    id: "gpt-4o",
    label: "ChatGPT 4o",
    family: "gpt",
    description: "Strong general ChatGPT model",
  },
  {
    id: "gpt-4o-mini",
    label: "ChatGPT 4o Mini",
    family: "gpt",
    description: "Fast and cheap for lighter turns",
  },
  {
    id: "gpt-4.1",
    label: "ChatGPT 4.1",
    family: "gpt",
    description: "Strong coding and instruction following",
  },
  {
    id: "o3-mini",
    label: "ChatGPT o3-mini",
    family: "gpt",
    description: "Reasoning-focused, cost-efficient",
  },
  {
    id: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    family: "other",
    description: "Long context and multimodal",
  },
  {
    id: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    family: "other",
    description: "Fast Gemini for everyday chat",
  },
  {
    id: "deepseek/deepseek-r1",
    label: "DeepSeek R1",
    family: "other",
    description: "Strong open reasoning model",
  },
  {
    id: "deepseek/deepseek-chat-v3-0324",
    label: "DeepSeek V3",
    family: "other",
    description: "Capable general chat",
  },
  {
    id: "meta-llama/llama-4-maverick",
    label: "Llama 4 Maverick",
    family: "other",
    description: "Meta open-weight frontier",
  },
];

export function getHostedModelLabel(modelId: string): string | null {
  const hit = HOSTED_CATALOG.find((m) => m.id === modelId);
  return hit?.label ?? null;
}

export function filterCatalogForCapabilities(caps: {
  claude: boolean;
  gpt: boolean;
  catalog: boolean;
}): HostedModelOption[] {
  return HOSTED_CATALOG.filter((m) => {
    if (m.family === "claude") return caps.claude;
    if (m.family === "gpt") return caps.gpt;
    return caps.catalog;
  });
}
