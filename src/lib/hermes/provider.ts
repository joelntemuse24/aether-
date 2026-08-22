/**
 * Per-request model + provider for Hermes.
 *
 * Official contract: a bare `model` without `provider` is ignored unless the
 * Hermes host enabled `direct_model_requests`. Aether always sends a provider
 * when it knows one (hosted Cloud → openrouter; BYOK → the user's provider).
 */

export const HERMES_PROVIDER_SLUGS = [
  "openrouter",
  "openai",
  "anthropic",
] as const;

export type HermesProviderSlug = (typeof HERMES_PROVIDER_SLUGS)[number];

export type HermesModelRequest = {
  model: string;
  provider?: HermesProviderSlug;
};

function knownProvider(value: string | null | undefined): HermesProviderSlug | undefined {
  const p = value?.trim().toLowerCase();
  if (p === "openrouter" || p === "openai" || p === "anthropic") return p;
  return undefined;
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
    return { model, provider: "openrouter" };
  }

  const byok = knownProvider(input.byokProvider);
  if (byok) {
    return { model, provider: byok };
  }

  return { model };
}
