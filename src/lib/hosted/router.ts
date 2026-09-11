import {
  getClaudeUpstream,
  getGptUpstream,
  getOpenRouterUpstream,
  getRelayUpstreams,
  type UpstreamConfig,
} from "./config";
import {
  EXPERT_BUZZ_FALLBACK_MODEL,
  EXPERT_OPENROUTER_FALLBACK_MODEL,
  EXPERT_PRIMARY_MODEL,
  FAST_OPENROUTER_FALLBACK_MODEL,
  FAST_OPENROUTER_MODEL,
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
    /^(anthropic|openai|google|meta-llama|meta|deepseek|x-ai|moonshotai|nvidia)\//,
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
  if (modelId.startsWith("nemotron-")) return `nvidia/${modelId}`;
  return modelId;
}

/** Model id for OpenAI-compatible specialty gateways (Buzz, …). */
export function toGatewayModelId(modelId: string): string {
  return stripProviderPrefix(modelId);
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

function buzzGptUpstream(): ReturnType<typeof getGptUpstream> | null {
  const gpt = getGptUpstream();
  if (gpt.configured) return gpt;
  const claude = getClaudeUpstream();
  return claude.configured ? claude : null;
}

/**
 * Resolve Cloud Fast/Expert to primary + failover chain.
 *
 * Fast → OpenRouter Ultra → OpenRouter Lightning (no Buzz).
 * Expert → Buzz Luna → Buzz Sol → [optional relays] → OpenRouter DeepSeek.
 *
 * `modelId` is required for call-site compat but does not select the Cloud
 * route; Fast/Expert is the product control after the catalog picker was
 * removed.
 */
export function resolveHostedRoute(
  modelId: string,
  speedTier: SpeedTier = "fast",
): HostedRoute | null {
  const trimmed = modelId.trim();
  if (!trimmed) return null;

  const openrouter = getOpenRouterUpstream();
  const gpt = getGptUpstream();
  const buzz = buzzGptUpstream();

  const openrouterRoute = (id: string): RoutedUpstream | null =>
    openrouter.configured
      ? { upstream: openrouter, modelId: toOpenRouterModelId(id) }
      : null;

  const chain: RoutedUpstream[] = [];
  const seen = new Set<string>();

  if (speedTier === "expert") {
    const lunaId = toGatewayModelId(EXPERT_PRIMARY_MODEL);
    const solId = toGatewayModelId(EXPERT_BUZZ_FALLBACK_MODEL);
    const specialty = gpt.configured ? gpt : buzz;
    if (specialty) {
      pushUnique(chain, { upstream: specialty, modelId: lunaId }, seen);
      pushUnique(chain, { upstream: specialty, modelId: solId }, seen);
    }
    for (const relay of relayRoutes(lunaId)) {
      pushUnique(chain, relay, seen);
    }
    pushUnique(chain, openrouterRoute(EXPERT_OPENROUTER_FALLBACK_MODEL), seen);
  } else {
    pushUnique(chain, openrouterRoute(FAST_OPENROUTER_MODEL), seen);
    pushUnique(chain, openrouterRoute(FAST_OPENROUTER_FALLBACK_MODEL), seen);
  }

  if (chain.length === 0) return null;
  const [primary, ...fallbacks] = chain;
  return { primary, fallbacks };
}
