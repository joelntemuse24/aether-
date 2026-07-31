/**
 * Aether Cloud catalog helpers.
 * Live models come from OpenRouter via openrouter-catalog + rank-models.
 * This module keeps shared types / defaults for client + server.
 */

import type { RankedFamily, RankedModelOption } from "./rank-models";
import { PREFERRED_DEFAULT_MODELS } from "./rank-models";

export type HostedModelFamily = RankedFamily;
export type HostedModelOption = RankedModelOption;

/** Fallback default when live catalog has not loaded yet. */
export const DEFAULT_HOSTED_MODEL: string = PREFERRED_DEFAULT_MODELS[2];

/** @deprecated Static catalog removed — kept empty for import safety. */
export const HOSTED_CATALOG: HostedModelOption[] = [];

export function getHostedModelLabel(modelId: string): string | null {
  if (!modelId) return null;
  // Lightweight offline labels for common ids before live status arrives
  if (modelId.startsWith("openai/")) {
    const bare = modelId.slice("openai/".length).replace(/^gpt-/, "").replace(/-/g, " ");
    return `ChatGPT ${bare}`.replace(/\b\w/g, (c) => c.toUpperCase()).replace("Chatgpt", "ChatGPT");
  }
  if (modelId.startsWith("anthropic/")) {
    const bare = modelId.slice("anthropic/".length).replace(/-/g, " ");
    return bare.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return null;
}

export function filterCatalogForCapabilities(
  models: HostedModelOption[],
  caps: { claude: boolean; gpt: boolean; catalog: boolean },
): HostedModelOption[] {
  return models.filter((m) => {
    if (m.family === "claude") return caps.claude;
    if (m.family === "chatgpt") return caps.gpt;
    return caps.catalog;
  });
}
