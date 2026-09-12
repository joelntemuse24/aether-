/**
 * Cloud model route — Expert only (2026-09-12).
 *
 * Expert: Buzz GPT Luna → Buzz GPT Sol → OpenRouter DeepSeek V4 Flash.
 * Legacy `fast` stored prefs and request headers coerce to Expert.
 *
 * Speed is not a tools gate (Ask/Auto lives in Settings). Product UI
 * must never name vendors.
 */

export type SpeedTier = "fast" | "expert";

/** Expert default: paid Buzz ChatGPT group, Luna. */
export const EXPERT_PRIMARY_MODEL = "gpt-5.6-luna";

/**
 * Expert hop 2 on the same Buzz GPT upstream. "Soul" in product talk is Sol.
 * Gateway id matches `src/app/api/conversations/title/route.ts` (`gpt-5.6-sol`).
 */
export const EXPERT_BUZZ_FALLBACK_MODEL = "gpt-5.6-sol";

/** Expert hop 3: OpenRouter DeepSeek V4 Flash (not OpenRouter Luna). */
export const EXPERT_OPENROUTER_FALLBACK_MODEL = "deepseek/deepseek-v4-flash";

/** Catalog / status form of the Expert primary. */
export const EXPERT_CATALOG_MODEL = "openai/gpt-5.6-luna";

/** Catalog / status form of Expert Sol. */
export const EXPERT_SOL_CATALOG_MODEL = "openai/gpt-5.6-sol";

/** Short-context cap for Luna — beyond this, long-ctx is required. */
export const EXPERT_SHORT_CONTEXT_TOKENS = 272_000;

export const EXPERT_TIER_LABEL = "Expert";

/** Fast is retired — leftover `fast` values become Expert. */
export function parseSpeedTier(_value: unknown): SpeedTier {
  void _value;
  return "expert";
}

/** Canonical Cloud model id (gateway form). Legacy Fast requests map here too. */
export function resolveCloudTierModel(_speedTier?: SpeedTier): string {
  void _speedTier;
  return EXPERT_PRIMARY_MODEL;
}

/** Public /api/hosted/status defaults — model ids only, no vendor names. */
export function hostedCloudRouteAdvertisement(): {
  defaultModel: string;
  routes: { expert: string; fast?: string };
  failover: { expert: string[]; fast?: string[] };
} {
  return {
    defaultModel: EXPERT_CATALOG_MODEL,
    routes: {
      expert: EXPERT_CATALOG_MODEL,
    },
    failover: {
      expert: [
        EXPERT_CATALOG_MODEL,
        EXPERT_SOL_CATALOG_MODEL,
        EXPERT_OPENROUTER_FALLBACK_MODEL,
      ],
    },
  };
}

/**
 * Cloud chats are Expert only. Leftover Fast / missing requests coerce here.
 * Deep harness and vision attachments stay on the same path.
 */
export function resolveEffectiveSpeedTier(_input: {
  requested?: string | null;
  harnessDepth?: string | null;
  hasImageAttachment?: boolean;
}): SpeedTier {
  void _input;
  return "expert";
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
