/**
 * Server-side hosted upstream configuration.
 * Keys never leave the server; clients only send x-access-mode: hosted.
 */

export type UpstreamId = "claude" | "gpt" | "openrouter";

export type UpstreamConfig = {
  id: UpstreamId;
  /** Internal label — never shown as the product brand to end users. */
  name: string;
  baseURL: string;
  apiKey: string;
  configured: boolean;
};

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const DEFAULT_CLAUDE_BASE = "https://buzzai.cc/v1";
const DEFAULT_GPT_BASE = "https://api.icodeeasy.cc/v1";

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function normalizeBaseURL(url: string): string {
  return url.replace(/\/$/, "");
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

export function getClaudeUpstream(): UpstreamConfig {
  const apiKey = env("AETHER_HOSTED_CLAUDE_API_KEY");
  const baseURL = normalizeBaseURL(
    env("AETHER_HOSTED_CLAUDE_BASE_URL") || DEFAULT_CLAUDE_BASE,
  );
  return {
    id: "claude",
    name: "claude-gateway",
    baseURL,
    apiKey,
    configured: apiKey.length > 0,
  };
}

export function getGptUpstream(): UpstreamConfig {
  // Prefer ChatGPT-named env vars; keep GPT_* as aliases.
  const apiKey =
    env("AETHER_HOSTED_CHATGPT_API_KEY") || env("AETHER_HOSTED_GPT_API_KEY");
  const baseURL = normalizeBaseURL(
    env("AETHER_HOSTED_CHATGPT_BASE_URL") ||
      env("AETHER_HOSTED_GPT_BASE_URL") ||
      DEFAULT_GPT_BASE,
  );
  return {
    id: "gpt",
    name: "chatgpt-gateway",
    baseURL,
    apiKey,
    configured: apiKey.length > 0,
  };
}

/** True when at least one hosted upstream can serve requests. */
export function isHostedConfigured(): boolean {
  return (
    getOpenRouterUpstream().configured ||
    getClaudeUpstream().configured ||
    getGptUpstream().configured
  );
}

export type HostedCapabilities = {
  available: boolean;
  claude: boolean;
  gpt: boolean;
  /** Long-tail / non-Claude / non-GPT models via OpenRouter. */
  catalog: boolean;
};

export function getHostedCapabilities(): HostedCapabilities {
  const openrouter = getOpenRouterUpstream().configured;
  const claude = getClaudeUpstream().configured || openrouter;
  const gpt = getGptUpstream().configured || openrouter;
  return {
    available: isHostedConfigured(),
    claude,
    gpt,
    catalog: openrouter,
  };
}
