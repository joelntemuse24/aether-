/**
 * Hosted default chat model for everyone (guests and signed-in).
 * Runs on the sidecar through a hosted OpenRouter provider keyed by
 * AETHER_HOSTED_OPENROUTER_API_KEY (server env only, never a user key).
 * Buzz models stay wired but are hidden unless AETHER_BUZZ_MODELS_ENABLED=1.
 */

export const HOSTED_DEFAULT_MODEL_ID = "qwen/qwen3.8-27b:free";
export const HOSTED_DEFAULT_MODEL_LABEL = "Qwen3.8 27B";
/** Sidecar provider name for the hosted OpenRouter models. */
export const HOSTED_OPENROUTER_PROVIDER = "openrouter";
/** TrueForge resource names cannot contain dots, slashes, or colons. */
export const HOSTED_DEFAULT_MODEL_RESOURCE = "qwen3-8-27b-free";
export const HOSTED_DEFAULT_MODEL_FQN = `${HOSTED_OPENROUTER_PROVIDER}/${HOSTED_DEFAULT_MODEL_RESOURCE}`;
/**
 * Free hosted fallback for a rate-limited default. Same hosted provider and
 * key, tools supported, never a paid or user-keyed model.
 */
export const HOSTED_FREE_FALLBACK_MODEL_ID = "google/gemma-4-31b-it:free";
export const HOSTED_FREE_FALLBACK_MODEL_RESOURCE = "gemma-4-31b-it-free";
export const HOSTED_FREE_FALLBACK_MODEL_FQN = `${HOSTED_OPENROUTER_PROVIDER}/${HOSTED_FREE_FALLBACK_MODEL_RESOURCE}`;
export const HOSTED_FREE_FALLBACK_CONTEXT_LENGTH = 262_144;
export const HOSTED_FREE_FALLBACK_MAX_OUTPUT_TOKENS = 32_768;
export const HOSTED_DEFAULT_CONTEXT_LENGTH = 262_144;
export const HOSTED_DEFAULT_MAX_OUTPUT_TOKENS = 32_768;
/**
 * Sent as `reasoning_effort` on every hosted default turn. Without it Qwen
 * thinks for 8k+ tokens (about 4 minutes) on a long question and the turn is
 * cut off before any answer text. `low` answers the same question in under a minute.
 */
export const HOSTED_DEFAULT_REASONING_EFFORT = "low" as const;

/** Picker group for the hosted default. */
export const HOSTED_DEFAULT_GROUP = "Default" as const;

export function isHostedDefaultModel(id: string | null | undefined): boolean {
  const value = (id ?? "").trim();
  return value === HOSTED_DEFAULT_MODEL_ID || value === HOSTED_DEFAULT_MODEL_FQN;
}

/** Buzz models are hidden (and not routed) unless this flag is "1" or "true". */
export function buzzModelsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const raw = (env.AETHER_BUZZ_MODELS_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true";
}

export function hostedDefaultPickerModel(): {
  id: string;
  label: string;
  group: typeof HOSTED_DEFAULT_GROUP;
} {
  return {
    id: HOSTED_DEFAULT_MODEL_ID,
    label: HOSTED_DEFAULT_MODEL_LABEL,
    group: HOSTED_DEFAULT_GROUP,
  };
}

/**
 * Which hosted model a turn uses. A user's own OpenRouter model id passes
 * through. Buzz ids pass through only while Buzz is enabled. Everything else,
 * including an empty or stale id, is the hosted default.
 */
export function resolveHostedTurnModel(input: {
  requested: string | null | undefined;
  buzzEnabled: boolean;
  isByokOpenRouterId: (id: string) => boolean;
  isBuzzId: (id: string) => boolean;
}): { kind: "default" } | { kind: "byok-openrouter"; id: string } | { kind: "buzz"; id: string } {
  const id = (input.requested ?? "").trim();
  if (!id || isHostedDefaultModel(id)) return { kind: "default" };
  if (input.isBuzzId(id)) {
    return input.buzzEnabled ? { kind: "buzz", id } : { kind: "default" };
  }
  if (input.isByokOpenRouterId(id)) return { kind: "byok-openrouter", id };
  return { kind: "default" };
}
