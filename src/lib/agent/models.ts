/**
 * Language models for one native turn. Buzz uses the VM env key.
 * An OpenRouter key is the per-turn header only — never the VM's OPENROUTER_API_KEY.
 */

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { isOpenRouterModelId, openRouterFallbackModel } from "@/lib/openrouter/models";
import { normalizeBuzzBaseUrl } from "@/lib/trueforge/providers";

export const AGENT_MODEL_UNAVAILABLE =
  "Aether's native engine is not available right now. Please try again.";

const OPENROUTER_ORIGIN = "https://openrouter.ai/api/v1";

export type AgentModelBuild =
  | { ok: true; model: LanguageModel; fallbacks: LanguageModel[] }
  | { ok: false; error: string };

function buzzKey(env: Record<string, string | undefined>): string {
  const value = (env.AETHER_HOSTED_BUZZ_API_KEY || env.AETHER_HOSTED_CLAUDE_API_KEY || "").trim();
  if (/^https?:\/\//i.test(value)) return "";
  return value;
}

function openRouterChat(
  apiKey: string,
  modelId: string,
  env: Record<string, string | undefined>,
  origin?: string | null,
): LanguageModel {
  const base = (env.OPENROUTER_BASE_URL || OPENROUTER_ORIGIN).trim().replace(/\/$/, "");
  const client = createOpenAI({
    apiKey,
    baseURL: base || OPENROUTER_ORIGIN,
    headers: {
      "HTTP-Referer": origin ?? "https://aether.local",
      "X-Title": "Aether",
    },
  });
  return client.chat(modelId);
}

export function buildAgentLanguageModels(input: {
  modelId: string;
  env: Record<string, string | undefined>;
  openRouterKey?: string | null;
  origin?: string | null;
}): AgentModelBuild {
  const modelId = input.modelId.trim();
  const openRouterKey = (input.openRouterKey ?? "").trim();
  if (!modelId) return { ok: false, error: AGENT_MODEL_UNAVAILABLE };

  if (isOpenRouterModelId(modelId)) {
    if (!openRouterKey) return { ok: false, error: AGENT_MODEL_UNAVAILABLE };
    return {
      ok: true,
      model: openRouterChat(openRouterKey, modelId, input.env, input.origin),
      fallbacks: [],
    };
  }

  const hostedKey = buzzKey(input.env);
  if (!hostedKey) {
    if (!openRouterKey) return { ok: false, error: AGENT_MODEL_UNAVAILABLE };
    return {
      ok: true,
      model: openRouterChat(
        openRouterKey,
        openRouterFallbackModel(modelId, input.env),
        input.env,
        input.origin,
      ),
      fallbacks: [],
    };
  }

  const client = createOpenAI({
    apiKey: hostedKey,
    baseURL: normalizeBuzzBaseUrl(
      input.env.AETHER_HOSTED_BUZZ_BASE_URL || input.env.AETHER_HOSTED_CLAUDE_BASE_URL,
    ),
  });
  const fallbacks = openRouterKey
    ? [
        openRouterChat(
          openRouterKey,
          openRouterFallbackModel(modelId, input.env),
          input.env,
          input.origin,
        ),
      ]
    : [];
  return { ok: true, model: client.chat(modelId), fallbacks };
}
