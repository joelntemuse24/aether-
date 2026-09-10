import {
  getClaudeUpstream,
  getGptUpstream,
  getOpenRouterUpstream,
  getRelayUpstreams,
  type UpstreamConfig,
} from "./config";
import type { HostedModelFamily } from "./catalog";
import { familyForRankedModel } from "./rank-models";
import {
  FAST_MODEL_CASCADE,
  PAID_FLASH_FALLBACKS,
  type SpeedTier,
} from "./speed-tiers";

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
 *
 * `speedTier: "fast"` (the default) reroutes generic requests through the
 * BUZZ free/cheap cascade first, then paid Flash, then OpenRouter as a
 * last resort. `"expert"` keeps the premium model on top of its chain.
 */
export function resolveHostedRoute(
  modelId: string,
  speedTier: SpeedTier = "fast",
): HostedRoute | null {
  const trimmed = modelId.trim();
  if (!trimmed) return null;

  const family = familyForModel(trimmed);
  const openrouter = getOpenRouterUpstream();
  const claude = getClaudeUpstream();
  const gpt = getGptUpstream();
  const gatewayId = toGatewayModelId(trimmed);

  const openrouterRoute = (id = trimmed): RoutedUpstream | null =>
    openrouter.configured
      ? { upstream: openrouter, modelId: toOpenRouterModelId(id) }
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
    if (speedTier === "expert") {
      // Expert keeps the premium model first, then the standard chain.
      pushUnique(chain, specialty, seen);
      for (const relay of relayRoutes(gatewayId)) {
        pushUnique(chain, relay, seen);
      }
      pushUnique(chain, openrouterRoute(), seen);
    } else {
      // Fast: free/cheap BUZZ cascade → paid Flash → premium → OpenRouter.
      const buzz = claude.configured ? claude : gpt.configured ? gpt : null;
      for (const id of FAST_MODEL_CASCADE) {
        if (buzz?.configured) pushUnique(chain, { upstream: buzz, modelId: id }, seen);
      }
      for (const id of PAID_FLASH_FALLBACKS) {
        if (buzz?.configured) pushUnique(chain, { upstream: buzz, modelId: id }, seen);
      }
      pushUnique(chain, specialty, seen);
      for (const relay of relayRoutes(gatewayId)) {
        pushUnique(chain, relay, seen);
      }
      pushUnique(chain, openrouterRoute(), seen);
    }

    if (chain.length === 0) return null;
    const [primary, ...fallbacks] = chain;
    return { primary, fallbacks };
  }

  // Long-tail: Fast reroutes through the BUZZ cascade too; Expert keeps the
  // OpenRouter catalog id (relays rarely have the full catalog).
  if (speedTier === "fast") {
    const buzz = claude.configured ? claude : gpt.configured ? gpt : null;
    if (buzz?.configured) {
      const chain: RoutedUpstream[] = [];
      const seen = new Set<string>();
      for (const id of FAST_MODEL_CASCADE) {
        pushUnique(chain, { upstream: buzz, modelId: id }, seen);
      }
      for (const id of PAID_FLASH_FALLBACKS) {
        pushUnique(chain, { upstream: buzz, modelId: id }, seen);
      }
      pushUnique(chain, openrouterRoute(trimmed), seen);
      if (chain.length > 0) {
        const [primary, ...fallbacks] = chain;
        return { primary, fallbacks };
      }
    }
  }
  const primary = openrouterRoute();
  if (!primary) return null;
  return { primary, fallbacks: [] };
}
