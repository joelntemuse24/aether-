/**
 * Fast / Expert speed tiers.
 *
 * Fast (default): free/cheap BUZZ OpenAI-compatible models first, cascade on
 * 429 / 5xx / timeout / empty / broken tool JSON (~8-12s per hop), then paid
 * Flash on the same BUZZ key, then OpenRouter only if BUZZ is fully down.
 *
 * Expert: paid BUZZ ChatGPT group first (short-context Luna), then the same
 * failover chain. Used when the user picks Expert (deep reasoning), a vision
 * attachment arrives (needs a vision-capable model), or the user explicitly
 * selects a specific model in the picker.
 */

/** BUZZ free/cheap cascade, in priority order (exact gateway ids). */
export const FAST_MODEL_CASCADE = [
  "glm-5.3-flash-free",
  "deepseek-v4-flash-free",
  "deepseek-v4-flash-vision-exp-free",
  "hy3-free",
  "qwen-3.8-free",
  "mimo-v2.5-free",
  "buzz-free",
] as const;

/** Paid Flash fallbacks on the same BUZZ key (after the free tier). */
export const PAID_FLASH_FALLBACKS = [
  "glm-5.3-flash",
  "deepseek-v4-flash",
  "hy3",
] as const;

/** Expert default: paid BUZZ ChatGPT group, short-context Luna. */
export const EXPERT_PRIMARY_MODEL = "gpt-5.6-luna";
/** Short-context cap for Luna — beyond this, long-ctx is required. */
export const EXPERT_SHORT_CONTEXT_TOKENS = 272_000;

/** Fast tier's user-facing label shown in the picker. */
export const FAST_TIER_LABEL = "Fast";
export const EXPERT_TIER_LABEL = "Expert";

export type SpeedTier = "fast" | "expert";

/**
 * True when the thread is long enough that Expert's short-context primary
 * must be skipped in favor of a long-context model.
 */
export function threadNeedsLongContext(threadText: string): boolean {
  // ~4 chars per token; keep margin under the short-ctx cap.
  const approxTokens = Math.ceil(threadText.length / 4);
  return approxTokens > EXPERT_SHORT_CONTEXT_TOKENS * 0.9;
}
