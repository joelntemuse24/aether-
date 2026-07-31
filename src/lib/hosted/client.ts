import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { createFailoverLanguageModel } from "./failover";
import { resolveHostedRoute, type RoutedUpstream } from "./router";

function createChatModel(
  route: RoutedUpstream,
  origin?: string | null,
): LanguageModel {
  const { upstream, modelId } = route;
  const openai = createOpenAI({
    apiKey: upstream.apiKey,
    baseURL: upstream.baseURL,
    headers:
      upstream.id === "openrouter"
        ? {
            "HTTP-Referer": origin ?? "http://localhost:3000",
            "X-Title": "Aether",
          }
        : undefined,
  });
  return openai.chat(modelId);
}

/**
 * Build a LanguageModel for hosted mode with automatic upstream failover
 * (BUZZ → relays → OpenRouter).
 */
export function createHostedLanguageModel(
  modelId: string,
  origin?: string | null,
): LanguageModel | null {
  const candidates = listHostedCandidates(modelId, origin);
  if (candidates.length === 0) return null;
  return createFailoverLanguageModel(candidates);
}

/** Ordered candidates: primary then fallbacks (BUZZ → relays → OpenRouter). */
export function listHostedCandidates(
  modelId: string,
  origin?: string | null,
): Array<{ model: LanguageModel; upstreamId: string; upstreamModelId: string }> {
  const route = resolveHostedRoute(modelId);
  if (!route) return [];
  return [route.primary, ...route.fallbacks].map((r) => ({
    model: createChatModel(r, origin),
    upstreamId: r.upstream.id,
    upstreamModelId: r.modelId,
  }));
}
