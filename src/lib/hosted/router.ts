import {
  getClaudeUpstream,
  getGptUpstream,
  getOpenRouterUpstream,
  getRelayUpstreams,
  type UpstreamConfig,
} from "./config";
import type { HostedModelFamily } from "./catalog";
import { familyForRankedModel } from "./rank-models";

export type RoutedUpstream = {
  upstream: UpstreamConfig;
  /** Model id to send to this upstream's Chat Completions API. */
  modelId: string;
};

export type HostedRoute = {
  primary: RoutedUpstream;
  /** Tried in order when the previous upstream fails (429 / saturation / 5xx). */
  fallbacks: RoutedUpstream[];
};

function stripProviderPrefix(modelId: string): string {
  return modelId.replace(
    /^(anthropic|openai|google|meta-llama|meta|deepseek|x-ai|moonshotai)\//,
    "",
  );
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

/** Model id for OpenAI-compatible specialty gateways (BUZZ, …). */
export function toGatewayModelId(modelId: string): string {
  return stripProviderPrefix(modelId);
}

export function familyForModel(modelId: string): HostedModelFamily {
  return familyForRankedModel(modelId);
}

function relayRoutes(gatewayModelId: string): RoutedUpstream[] {
  return getRelayUpstreams().map((upstream) => ({
    upstream,
    modelId: gatewayModelId,
  }));
}

function pushUnique(
  list: RoutedUpstream[],
  next: RoutedUpstream | null | undefined,
  seen: Set<string>,
) {
  if (!next) return;
  const key = `${next.upstream.id}|${next.upstream.baseURL}|${next.modelId}`;
  if (seen.has(key)) return;
  seen.add(key);
  list.push(next);
}

/**
 * Resolve a user-facing model id to primary + failover chain:
 * specialty gateway (BUZZ) → optional relays → OpenRouter.
 */
export function resolveHostedRoute(modelId: string): HostedRoute | null {
  const trimmed = modelId.trim();
  if (!trimmed) return null;

  const family = familyForModel(trimmed);
  const openrouter = getOpenRouterUpstream();
  const claude = getClaudeUpstream();
  const gpt = getGptUpstream();
  const gatewayId = toGatewayModelId(trimmed);

  const openrouterRoute = (): RoutedUpstream | null =>
    openrouter.configured
      ? { upstream: openrouter, modelId: toOpenRouterModelId(trimmed) }
      : null;

  if (family === "claude" || family === "chatgpt") {
    const specialty =
      family === "claude"
        ? claude.configured
          ? ({ upstream: claude, modelId: gatewayId } satisfies RoutedUpstream)
          : null
        : gpt.configured
          ? ({ upstream: gpt, modelId: gatewayId } satisfies RoutedUpstream)
          : null;

    const chain: RoutedUpstream[] = [];
    const seen = new Set<string>();
    pushUnique(chain, specialty, seen);
    for (const relay of relayRoutes(gatewayId)) {
      pushUnique(chain, relay, seen);
    }
    pushUnique(chain, openrouterRoute(), seen);

    if (chain.length === 0) return null;
    const [primary, ...fallbacks] = chain;
    return { primary, fallbacks };
  }

  // Long-tail: OpenRouter only (relays rarely have the full catalog).
  const primary = openrouterRoute();
  if (!primary) return null;
  return { primary, fallbacks: [] };
}
