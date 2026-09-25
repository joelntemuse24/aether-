import { normalizeBuzzBaseUrl } from "@/lib/trueforge/providers";

export const DEFAULT_BUZZ_MODEL = "gpt-5.6-luna";
export const BUZZ_MODEL_STORAGE_KEY = "aether:buzz-model";
export const BUZZ_UNAVAILABLE_KEY = "aether:buzz-unavailable";

export type BuzzModelGroup = "OpenAI" | "Anthropic";

export type BuzzChatModel = {
  id: string;
  label: string;
  group: BuzzModelGroup;
};

const CACHE_MS = 10 * 60 * 1000;

/** Used when Buzz /models cannot be reached. */
export const KNOWN_BUZZ_CHAT_MODELS = [
  "claude-fable-5",
  "claude-fable-5-1",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-5-20251101",
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-opus-5-5",
  "claude-sonnet-4-5-20250929",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-6-astra",
  "gpt-6-sol",
] as const;

let cache: { at: number; models: BuzzChatModel[] } | null = null;

export function isBuzzChatModelId(id: string): boolean {
  if (id.startsWith("gpt-image-")) return false;
  return id.startsWith("gpt-") || id.startsWith("claude-");
}

export function buzzModelGroup(id: string): BuzzModelGroup {
  return id.startsWith("claude-") ? "Anthropic" : "OpenAI";
}

/** Friendly name. Dates on snapshot ids are dropped. */
export function buzzModelLabel(id: string): string {
  if (id.startsWith("gpt-")) {
    const [version, ...rest] = id.slice(4).split("-");
    const name = rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
    return name ? `GPT-${version} ${name}` : `GPT-${version}`;
  }
  if (id.startsWith("claude-")) {
    const rest = id.slice("claude-".length).replace(/-\d{8}$/, "");
    const [family, ...version] = rest.split("-");
    const familyLabel = family.charAt(0).toUpperCase() + family.slice(1);
    const ver = version.join(".");
    return ver ? `Claude ${familyLabel} ${ver}` : `Claude ${familyLabel}`;
  }
  return id;
}

export function toBuzzChatModel(id: string): BuzzChatModel {
  return { id, label: buzzModelLabel(id), group: buzzModelGroup(id) };
}

export function knownBuzzChatModels(): BuzzChatModel[] {
  return KNOWN_BUZZ_CHAT_MODELS.map(toBuzzChatModel);
}

/** TrueForge resource names cannot contain dots. */
export function buzzModelResourceName(id: string): string {
  return id.replace(/\./g, "-");
}

export function buzzModelFqn(id: string): string {
  const name = buzzModelResourceName(id);
  return id.startsWith("claude-") ? `anthropic/${name}` : `buzz/${name}`;
}

export function filterBuzzChatModelIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!isBuzzChatModelId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function resolveBuzzModelId(requested: string | null | undefined, models: BuzzChatModel[]): string {
  const id = (requested ?? "").trim();
  if (id && models.some((model) => model.id === id)) return id;
  if (models.some((model) => model.id === DEFAULT_BUZZ_MODEL)) return DEFAULT_BUZZ_MODEL;
  return models[0]?.id || DEFAULT_BUZZ_MODEL;
}

function buzzKey(env: Record<string, string | undefined>): string {
  const value = (env.AETHER_HOSTED_BUZZ_API_KEY || env.AETHER_HOSTED_CLAUDE_API_KEY || "").trim();
  if (/^https?:\/\//i.test(value)) return "";
  return value;
}

export async function listBuzzChatModels(
  env: Record<string, string | undefined> = process.env,
  now = Date.now(),
): Promise<BuzzChatModel[]> {
  if (cache && now - cache.at < CACHE_MS) return cache.models;
  const key = buzzKey(env);
  const base = normalizeBuzzBaseUrl(
    env.AETHER_HOSTED_BUZZ_BASE_URL || env.AETHER_HOSTED_CLAUDE_BASE_URL,
  );
  if (!key) return knownBuzzChatModels();
  try {
    const response = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return knownBuzzChatModels();
    const body = (await response.json()) as { data?: { id?: string }[] };
    const ids = filterBuzzChatModelIds(
      (body.data ?? []).map((row) => (typeof row.id === "string" ? row.id : "")),
    );
    const models = (ids.length ? ids : [...KNOWN_BUZZ_CHAT_MODELS]).map(toBuzzChatModel);
    cache = { at: now, models };
    return models;
  } catch {
    return knownBuzzChatModels();
  }
}

export function buzzModelUnavailableCopy(id: string): string {
  return `${buzzModelLabel(id)} isn't available on this key. Pick another model.`;
}

export function isBuzzModelUnavailableError(message: string): boolean {
  return /model_not_found|not enabled for group/i.test(message);
}

export function isTransientBuzzError(message: string): boolean {
  return /525|cloudflare|\b5\d\d\b|network|fetch failed|econn|socket|aborted/i.test(message);
}
