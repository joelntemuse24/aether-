import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { listHostedCandidates } from "@/lib/hosted/client";
import { createFailoverLanguageModel } from "@/lib/hosted/failover";

export type ChatLanguageProviderId =
  | "openrouter"
  | "openai"
  | "anthropic"
  | "custom";

function resolveModelId(
  provider: ChatLanguageProviderId,
  model: string,
): string {
  if (provider === "anthropic") return model.replace(/^anthropic\//, "");
  if (provider === "openai") return model.replace(/^openai\//, "");
  return model;
}

export function buildByokLanguageModel(input: {
  provider: ChatLanguageProviderId;
  apiKey: string;
  baseURL: string;
  modelId: string;
  origin?: string | null;
}): LanguageModel {
  const modelId = resolveModelId(input.provider, input.modelId);
  if (input.provider === "anthropic") {
    return createAnthropic({ apiKey: input.apiKey })(modelId);
  }
  const openai = createOpenAI({
    apiKey: input.apiKey,
    baseURL:
      input.baseURL ||
      (input.provider === "openrouter"
        ? "https://openrouter.ai/api/v1"
        : input.provider === "openai"
          ? "https://api.openai.com/v1"
          : input.baseURL),
    headers:
      input.provider === "openrouter"
        ? {
            "HTTP-Referer": input.origin ?? "http://localhost:3000",
            "X-Title": "Aether",
          }
        : undefined,
  });
  return openai.chat(modelId);
}

export function resolveTurnLanguageModel(input: {
  hosted: boolean;
  provider: ChatLanguageProviderId;
  apiKey: string;
  baseURL: string;
  modelId: string;
  origin?: string | null;
}): LanguageModel | null {
  if (input.hosted) {
    const candidates = listHostedCandidates(input.modelId, input.origin ?? null);
    if (candidates.length === 0) return null;
    return createFailoverLanguageModel(candidates);
  }
  if (!input.apiKey.trim()) return null;
  return buildByokLanguageModel({
    provider: input.provider,
    apiKey: input.apiKey,
    baseURL: input.baseURL,
    modelId: input.modelId,
    origin: input.origin,
  });
}
