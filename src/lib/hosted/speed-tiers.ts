/**
 * Fast / Expert speed tiers — Cloud think-depth / model route.
 *
 * Fast (default): OpenRouter Nemotron Ultra.
 * Expert: Buzz GPT path, Luna.
 *
 * Fast/Expert is not a tools gate (Ask/Auto lives in Settings). Product UI
 * must never name vendors.
 *
 * OpenRouter has no literal "Nemotron 3.5 Ultra" slug. Closest paid Ultra:
 * `nvidia/nemotron-3-ultra-550b-a55b` (Nemotron 3 Ultra 550B). The 3.5 line
 * on OpenRouter is Lightning / Content Safety, not Ultra.
 */

export type SpeedTier = "fast" | "expert";

/**
 * Paid OpenRouter Nemotron Ultra. Prefer this over `:free` for prod quality.
 * Verified against OpenRouter /models (no `nemotron-3.5-ultra` exists).
 */
export const FAST_OPENROUTER_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

/** Expert default: paid Buzz ChatGPT group, Luna. */
export const EXPERT_PRIMARY_MODEL = "gpt-5.6-luna";

/** Catalog / status form of the Expert model. */
export const EXPERT_CATALOG_MODEL = "openai/gpt-5.6-luna";

/** Short-context cap for Luna — beyond this, long-ctx is required. */
export const EXPERT_SHORT_CONTEXT_TOKENS = 272_000;

/** Fast tier's user-facing label shown in the picker. */
export const FAST_TIER_LABEL = "Fast";
export const EXPERT_TIER_LABEL = "Expert";

export function parseSpeedTier(value: unknown): SpeedTier {
  return value === "expert" ? "expert" : "fast";
}

/** Canonical Cloud model id for a speed tier (gateway form for Expert). */
export function resolveCloudTierModel(speedTier: SpeedTier): string {
  return speedTier === "expert" ? EXPERT_PRIMARY_MODEL : FAST_OPENROUTER_MODEL;
}

/** Public /api/hosted/status defaults — model ids only, no vendor names. */
export function hostedCloudRouteAdvertisement(): {
  defaultModel: string;
  routes: { fast: string; expert: string };
} {
  return {
    defaultModel: FAST_OPENROUTER_MODEL,
    routes: {
      fast: FAST_OPENROUTER_MODEL,
      expert: EXPERT_CATALOG_MODEL,
    },
  };
}

/**
 * Composer Fast/Expert is the base. Deep harness or a vision attachment
 * floors to Expert (premium / vision-capable).
 */
export function resolveEffectiveSpeedTier(input: {
  requested?: string | null;
  harnessDepth?: string | null;
  hasImageAttachment?: boolean;
}): SpeedTier {
  const requested = parseSpeedTier(input.requested);
  if (input.harnessDepth === "deep" || input.hasImageAttachment) {
    return "expert";
  }
  return requested;
}

/**
 * True when the thread is long enough that Expert's short-context primary
 * must be skipped in favor of a long-context model.
 */
export function threadNeedsLongContext(threadText: string): boolean {
  // ~4 chars per token; keep margin under the short-ctx cap.
  const approxTokens = Math.ceil(threadText.length / 4);
  return approxTokens > EXPERT_SHORT_CONTEXT_TOKENS * 0.9;
}
