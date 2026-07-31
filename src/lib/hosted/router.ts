import {
  getClaudeUpstream,
  getGptUpstream,
  getOpenRouterUpstream,
  type UpstreamConfig,
} from "./config";
import { HOSTED_CATALOG, type HostedModelFamily } from "./catalog";

export type RoutedUpstream = {
  upstream: UpstreamConfig;
  /** Model id to send to this upstream's Chat Completions API. */
  modelId: string;
};

export type HostedRoute = {
  primary: RoutedUpstream;
  /** Tried if the primary request fails before/during setup. */
  fallbacks: RoutedUpstream[];
};

function stripProviderPrefix(modelId: string): string {
  return modelId.replace(/^(anthropic|openai|google|meta-llama|meta|deepseek)\//, "");
}

/** Map Aether / short ids onto OpenRouter's provider/model form. */
export function toOpenRouterModelId(modelId: string): string {
  if (modelId.includes("/")) return modelId;
  if (modelId.startsWith("claude-")) return `anthropic/${modelId}`;
  if (
    modelId.startsWith("gpt-") ||
    /^o[0-9]/.test(modelId) ||
    modelId.startsWith("chatgpt-")
  ) {
    return `openai/${modelId}`;
  }
  if (modelId.startsWith("gemini-")) return `google/${modelId}`;
  if (modelId.startsWith("deepseek-")) return `deepseek/${modelId}`;
  if (modelId.startsWith("llama-")) return `meta-llama/${modelId}`;
  return modelId;
}

/** Model id for OpenAI-compatible specialty gateways (BUZZ, Code Easy, …). */
export function toGatewayModelId(modelId: string): string {
  return stripProviderPrefix(modelId);
}

export function familyForModel(modelId: string): HostedModelFamily {
  const catalog = HOSTED_CATALOG.find((m) => m.id === modelId);
  if (catalog) return catalog.family;

  const id = modelId.toLowerCase();
  const bare = stripProviderPrefix(id);
  if (bare.startsWith("claude") || id.startsWith("anthropic/")) return "claude";
  if (
    bare.startsWith("gpt-") ||
    /^o[0-9]/.test(bare) ||
    bare.startsWith("chatgpt-") ||
    id.startsWith("openai/")
  ) {
    return "gpt";
  }
  return "other";
}

/**
 * Resolve a user-facing model id to a primary upstream + OpenRouter fallback.
 * Returns null when hosted is not configured for that family.
 */
export function resolveHostedRoute(modelId: string): HostedRoute | null {
  const trimmed = modelId.trim();
  if (!trimmed) return null;

  const family = familyForModel(trimmed);
  const openrouter = getOpenRouterUpstream();
  const claude = getClaudeUpstream();
  const gpt = getGptUpstream();

  const openrouterRoute = (): RoutedUpstream | null =>
    openrouter.configured
      ? { upstream: openrouter, modelId: toOpenRouterModelId(trimmed) }
      : null;

  if (family === "claude") {
    const primary: RoutedUpstream | null = claude.configured
      ? { upstream: claude, modelId: toGatewayModelId(trimmed) }
      : openrouterRoute();
    if (!primary) return null;
    const fallbacks: RoutedUpstream[] = [];
    const or = openrouterRoute();
    if (
      or &&
      (primary.upstream.id !== "openrouter" ||
        primary.modelId !== or.modelId)
    ) {
      if (primary.upstream.id !== "openrouter") fallbacks.push(or);
    }
    return { primary, fallbacks };
  }

  if (family === "gpt") {
    const primary: RoutedUpstream | null = gpt.configured
      ? { upstream: gpt, modelId: toGatewayModelId(trimmed) }
      : openrouterRoute();
    if (!primary) return null;
    const fallbacks: RoutedUpstream[] = [];
    const or = openrouterRoute();
    if (or && primary.upstream.id !== "openrouter") fallbacks.push(or);
    return { primary, fallbacks };
  }

  // Long-tail: OpenRouter only
  const primary = openrouterRoute();
  if (!primary) return null;
  return { primary, fallbacks: [] };
}
