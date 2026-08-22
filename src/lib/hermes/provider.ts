/**
 * Per-request model + provider for Hermes.
 *
 * Official contract: a bare `model` without `provider` is ignored unless the
 * Hermes host enabled `direct_model_requests`. Aether always sends a provider
 * when it knows one. Never sends user API keys — only the picker model id
 * and a provider slug.
 *
 * Hosted Cloud matches local failover families (`familyForRankedModel`):
 * ChatGPT + Claude → named custom provider `providers.buzz` (OpenAI-compatible).
 * Hermes canonical slug is `custom:buzz` (alias `buzz` also resolves).
 * Do not send native `anthropic` for hosted Claude — that is the Anthropic
 * Messages API; Buzz speaks Chat Completions only.
 * Other hosted models → `openrouter`.
 * `HERMES_PROVIDER` still wins when set to a known slug.
 * BYOK → openai / anthropic slugs only.
 */

import { familyForRankedModel } from "@/lib/hosted/rank-models";

export const HERMES_PROVIDER_SLUGS = [
  "openrouter",
  "openai",
  "anthropic",
  "custom:buzz",
] as const;

export type HermesProviderSlug = (typeof HERMES_PROVIDER_SLUGS)[number];

/** Canonical slug Hermes honors for `providers.buzz` in config.yaml. */
export const HERMES_HOSTED_BUZZ_PROVIDER: HermesProviderSlug = "custom:buzz";

export type HermesModelRequest = {
  model: string;
  provider?: HermesProviderSlug;
};

function knownProvider(value: string | null | undefined): HermesProviderSlug | undefined {
  const p = value?.trim().toLowerCase();
  if (p === "openrouter" || p === "openai" || p === "anthropic") return p;
  // Hermes aliases for the named `providers.buzz` entry.
  if (p === "custom:buzz" || p === "buzz") return HERMES_HOSTED_BUZZ_PROVIDER;
  return undefined;
}

function hostedProviderForModel(model: string): HermesProviderSlug {
  const family = familyForRankedModel(model);
  if (family === "claude" || family === "chatgpt") {
    return HERMES_HOSTED_BUZZ_PROVIDER;
  }
  return "openrouter";
}

/**
 * Resolve the OpenAI-compatible `model` + `provider` fields for Hermes.
 * Never sends user API keys — only the picker model id and a provider slug.
 */
export function resolveHermesModelRequest(input: {
  requestedModel: string;
  accessMode: "hosted" | "byok";
  byokProvider?: string | null;
  defaultModelName?: string;
  env?: NodeJS.ProcessEnv;
}): HermesModelRequest {
  const env = input.env ?? process.env;
  const model =
    input.requestedModel.trim() ||
    env.HERMES_MODEL_NAME?.trim() ||
    input.defaultModelName ||
    "hermes-agent";

  const override = knownProvider(env.HERMES_PROVIDER);
  if (override) {
    return { model, provider: override };
  }

  if (input.accessMode === "hosted") {
    return { model, provider: hostedProviderForModel(model) };
  }

  const byok = knownProvider(input.byokProvider);
  if (byok) {
    return { model, provider: byok };
  }

  return { model };
}
