/**
 * Server-side hosted upstream configuration.
 * Keys never leave the server; clients only send x-access-mode: hosted.
 *
 * Preferred stack:
 *   BUZZ (Claude + ChatGPT) → optional OpenAI-compatible relays → OpenRouter.
 */

export type UpstreamId = "claude" | "gpt" | "openrouter" | `relay${number}`;

export type UpstreamConfig = {
  id: UpstreamId;
  /** Internal label — never shown as the product brand to end users. */
  name: string;
  baseURL: string;
  apiKey: string;
  configured: boolean;
};

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
/** BUZZ dashboard "API Endpoint" is https://api.buzzai.cc — OpenAI SDK needs /v1. */
const DEFAULT_BUZZ_BASE = "https://api.buzzai.cc/v1";

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function normalizeBaseURL(url: string): string {
  const trimmed = url.replace(/\/$/, "");
  // Dashboard copies https://api.buzzai.cc without /v1; Chat Completions needs it.
  if (
    trimmed === "https://api.buzzai.cc" ||
    trimmed === "https://buzzai.cc" ||
    trimmed === "http://api.buzzai.cc" ||
    trimmed === "http://buzzai.cc"
  ) {
    return `${trimmed}/v1`;
  }
  return trimmed;
}

export function getOpenRouterUpstream(): UpstreamConfig {
  const apiKey = env("OPENROUTER_API_KEY");
  return {
    id: "openrouter",
    name: "openrouter",
    baseURL: OPENROUTER_BASE,
    apiKey,
    configured: apiKey.length > 0,
  };
}

/**
 * Shared BUZZ credentials. One key covers Claude + ChatGPT groups on the token.
 * Prefer AETHER_HOSTED_BUZZ_*; accept legacy CLAUDE_* aliases.
 */
function getBuzzCredentials(): { baseURL: string; apiKey: string } {
  const apiKey =
    env("AETHER_HOSTED_BUZZ_API_KEY") ||
    env("AETHER_HOSTED_CLAUDE_API_KEY");
  const baseURL = normalizeBaseURL(
    env("AETHER_HOSTED_BUZZ_BASE_URL") ||
      env("AETHER_HOSTED_CLAUDE_BASE_URL") ||
      DEFAULT_BUZZ_BASE,
  );
  return { baseURL, apiKey };
}

export function getClaudeUpstream(): UpstreamConfig {
  const { baseURL, apiKey } = getBuzzCredentials();
  return {
    id: "claude",
    name: "buzz",
    baseURL,
    apiKey,
    configured: apiKey.length > 0,
  };
}

/**
 * ChatGPT family — same BUZZ key by default.
 * Optional AETHER_HOSTED_CHATGPT_* / AETHER_HOSTED_GPT_* override if you ever
 * want a separate gateway; otherwise falls back to BUZZ.
 */
export function getGptUpstream(): UpstreamConfig {
  const overrideKey =
    env("AETHER_HOSTED_CHATGPT_API_KEY") || env("AETHER_HOSTED_GPT_API_KEY");
  if (overrideKey) {
    const baseURL = normalizeBaseURL(
      env("AETHER_HOSTED_CHATGPT_BASE_URL") ||
        env("AETHER_HOSTED_GPT_BASE_URL") ||
        DEFAULT_BUZZ_BASE,
    );
    return {
      id: "gpt",
      name: "chatgpt-gateway",
      baseURL,
      apiKey: overrideKey,
      configured: true,
    };
  }

  const buzz = getBuzzCredentials();
  return {
    id: "gpt",
    name: "buzz",
    baseURL: buzz.baseURL,
    apiKey: buzz.apiKey,
    configured: buzz.apiKey.length > 0,
  };
}

/**
 * Optional OpenAI-compatible relays (e.g. other Chinese gateways) tried after
 * BUZZ and before OpenRouter. Configure up to 5:
 *   AETHER_HOSTED_RELAY_1_BASE_URL / AETHER_HOSTED_RELAY_1_API_KEY
 *   AETHER_HOSTED_RELAY_2_BASE_URL / …
 */
export function getRelayUpstreams(): UpstreamConfig[] {
  const relays: UpstreamConfig[] = [];
  for (let i = 1; i <= 5; i++) {
    const apiKey = env(`AETHER_HOSTED_RELAY_${i}_API_KEY`);
    const baseURL = normalizeBaseURL(env(`AETHER_HOSTED_RELAY_${i}_BASE_URL`));
    if (!apiKey || !baseURL) continue;
    relays.push({
      id: `relay${i}`,
      name: env(`AETHER_HOSTED_RELAY_${i}_NAME`) || `relay-${i}`,
      baseURL,
      apiKey,
      configured: true,
    });
  }
  return relays;
}

/** True when at least one hosted upstream can serve requests. */
export function isHostedConfigured(): boolean {
  return (
    getOpenRouterUpstream().configured ||
    getClaudeUpstream().configured ||
    getGptUpstream().configured ||
    getRelayUpstreams().length > 0
  );
}

export type HostedCapabilities = {
  available: boolean;
  claude: boolean;
  gpt: boolean;
  /** Long-tail / non-Claude / non-ChatGPT models via OpenRouter. */
  catalog: boolean;
};

export function getHostedCapabilities(): HostedCapabilities {
  const openrouter = getOpenRouterUpstream().configured;
  const buzz = getBuzzCredentials().apiKey.length > 0;
  const claude = buzz || openrouter;
  const gpt = getGptUpstream().configured || openrouter;
  return {
    available: isHostedConfigured(),
    claude,
    gpt,
    catalog: openrouter,
  };
}
