/**
 * Remote Hermes gateway configuration (server-only).
 * Users never see these values; the browser talks only to Aether.
 */

export type HermesConfig = {
  /** Origin without trailing slash or /v1 suffix */
  baseUrl: string;
  apiKey: string;
  /** Value sent as OpenAI `model` when the picker model should not override */
  modelName: string;
};

export function normalizeHermesBaseUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  if (u.toLowerCase().endsWith("/v1")) {
    u = u.slice(0, -3).replace(/\/+$/, "");
  }
  return u;
}

export function isHermesConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const enabled = env.HERMES_ENABLED?.trim().toLowerCase();
  if (enabled === "0" || enabled === "false" || enabled === "off") {
    return false;
  }
  const url = env.HERMES_BASE_URL?.trim();
  const key = env.HERMES_API_KEY?.trim();
  if (!url || !key) return false;
  return true;
}

export function getHermesConfig(
  env: NodeJS.ProcessEnv = process.env,
): HermesConfig | null {
  if (!isHermesConfigured(env)) return null;
  return {
    baseUrl: normalizeHermesBaseUrl(env.HERMES_BASE_URL!),
    apiKey: env.HERMES_API_KEY!.trim(),
    modelName: env.HERMES_MODEL_NAME?.trim() || "hermes-agent",
  };
}

/**
 * Stable long-term memory / tenancy scope for Hermes (X-Hermes-Session-Key).
 * Max 256 chars; no control characters.
 */
export function buildHermesSessionKey(input: {
  userId: string | null;
  conversationId: string | null;
}): string {
  const raw = input.userId
    ? `aether:user:${input.userId}`
    : `aether:anon:${input.conversationId || "anon"}`;
  return raw.replace(/[\r\n\0]/g, "").slice(0, 256);
}

export function hermesChatCompletionsUrl(baseUrl: string): string {
  return `${normalizeHermesBaseUrl(baseUrl)}/v1/chat/completions`;
}
