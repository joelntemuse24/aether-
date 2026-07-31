/**
 * Rank + brand live OpenRouter models for the Aether Cloud picker.
 * Sections: ChatGPT → Claude → More. Within each, flagships first.
 */

export type RankedFamily = "chatgpt" | "claude" | "other";

export type RankableModel = {
  id: string;
  name: string;
  context_length?: number;
};

export type RankedModelOption = {
  id: string;
  label: string;
  family: RankedFamily;
  description?: string;
};

const PROVIDER_PREFIXES = [
  "openai/",
  "anthropic/",
  "google/",
  "deepseek/",
  "moonshotai/",
  "qwen/",
  "z-ai/",
  "meta-llama/",
  "meta/",
  "x-ai/",
] as const;

/** Preferred defaults — first match present in the live catalog wins. */
export const PREFERRED_DEFAULT_MODELS = [
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-luna",
  "openai/gpt-5.5",
  "openai/gpt-5.4",
  "openai/gpt-5.2-chat",
  "openai/gpt-5.2",
  "openai/gpt-4o",
] as const;

/**
 * Short “major models” list for the default picker view (Cursor-style).
 * Full catalog is available via search. Missing ids are skipped at runtime.
 */
export const FEATURED_MODEL_IDS = [
  // ChatGPT
  "openai/gpt-5.6-sol",
  "openai/gpt-5.5",
  "openai/gpt-5.4",
  "openai/o3",
  // Claude
  "anthropic/claude-opus-5",
  "anthropic/claude-sonnet-5",
  "anthropic/claude-fable-5",
  "anthropic/claude-haiku-4.5",
  // More
  "x-ai/grok-4.5",
  "moonshotai/kimi-k3",
  "google/gemini-3.5-flash",
  "deepseek/deepseek-r1",
] as const;

const FEATURED_INDEX = new Map(
  FEATURED_MODEL_IDS.map((id, i) => [id, i] as const),
);

/** Exact-id pins (lower index = higher). Covers frontier chat models. */
const PIN_ORDER: string[] = [
  // ChatGPT / OpenAI
  "openai/gpt-5.6-luna-pro",
  "openai/gpt-5.6-luna",
  "openai/gpt-5.6-terra-pro",
  "openai/gpt-5.6-terra",
  "openai/gpt-5.6-sol-pro",
  "openai/gpt-5.6-sol",
  "openai/gpt-5.5-pro",
  "openai/gpt-5.5",
  "openai/gpt-5.4-pro",
  "openai/gpt-5.4",
  "openai/gpt-5.3-chat",
  "openai/gpt-5.2-chat",
  "openai/gpt-5.2-pro",
  "openai/gpt-5.2",
  "openai/gpt-5.1-chat",
  "openai/gpt-5.1",
  "openai/gpt-5-pro",
  "openai/gpt-5",
  "openai/o3-pro",
  "openai/o3",
  "openai/o4-mini-high",
  "openai/o4-mini",
  "openai/o3-mini",
  "openai/gpt-4.1",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  // Claude
  "anthropic/claude-opus-5-fast",
  "anthropic/claude-opus-5",
  "anthropic/claude-sonnet-5",
  "anthropic/claude-fable-5",
  "anthropic/claude-opus-4.8-fast",
  "anthropic/claude-opus-4.8",
  "anthropic/claude-opus-4.7-fast",
  "anthropic/claude-opus-4.7",
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-opus-4.6",
  "anthropic/claude-opus-4.5",
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-haiku-4.5",
  "anthropic/claude-opus-4.1",
  "anthropic/claude-opus-4",
  "anthropic/claude-sonnet-4",
  // More — flagships
  "x-ai/grok-4.5",
  "x-ai/grok-4.3",
  "x-ai/grok-4.20",
  "moonshotai/kimi-k3",
  "moonshotai/kimi-k2.7-code",
  "moonshotai/kimi-k2.6",
  "moonshotai/kimi-k2.5",
  "google/gemini-3.6-flash",
  "google/gemini-3.5-flash",
  "google/gemini-3.1-pro-preview",
  "google/gemini-3-flash-preview",
  "google/gemini-2.5-pro",
  "google/gemini-2.5-flash",
  "deepseek/deepseek-r1",
  "deepseek/deepseek-chat-v3-0324",
  "meta-llama/llama-4-maverick",
];

const PIN_INDEX = new Map(PIN_ORDER.map((id, i) => [id, i]));

const OTHER_PROVIDER_RANK: Record<string, number> = {
  "x-ai": 0,
  moonshotai: 1,
  google: 2,
  deepseek: 3,
  qwen: 4,
  "z-ai": 5,
  "meta-llama": 6,
  meta: 7,
};

function bareId(id: string): string {
  const slash = id.indexOf("/");
  return slash >= 0 ? id.slice(slash + 1) : id;
}

function providerOf(id: string): string {
  const slash = id.indexOf("/");
  return slash >= 0 ? id.slice(0, slash) : "";
}

export function familyForRankedModel(id: string): RankedFamily {
  if (id.startsWith("openai/") || id.startsWith("gpt-") || /^o[0-9]/.test(id)) {
    return "chatgpt";
  }
  if (id.startsWith("anthropic/") || id.startsWith("claude-")) {
    return "claude";
  }
  return "other";
}

/** Drop batch/free/audio/image-only / oss noise from the chat picker. */
export function isPickerEligible(id: string): boolean {
  const lower = id.toLowerCase();
  if (lower.includes(":free") || lower.includes(":batch")) return false;
  if (lower.startsWith("~")) return false;
  if (!PROVIDER_PREFIXES.some((p) => id.startsWith(p))) return false;
  if (/(^|[-/])(audio|image|tts|whisper|moderation|embedding|realtime)([-:]|$)/.test(lower)) {
    return false;
  }
  if (lower.includes("gpt-oss") || lower.includes("safeguard")) return false;
  if (lower.includes("grok-build")) return false;
  return true;
}

function cleanUpstreamName(name: string): string {
  return name.replace(/^[^:]+:\s*/, "").trim();
}

/** User-facing labels — ChatGPT brand for OpenAI chat models. */
export function brandModelLabel(id: string, upstreamName: string): string {
  const cleaned = cleanUpstreamName(upstreamName);
  const family = familyForRankedModel(id);
  if (family === "chatgpt") {
    // "GPT-5.5" / "GPT-5.6 Sol" → "ChatGPT 5.5" / "ChatGPT 5.6 Sol"
    const fromName = cleaned.replace(/^GPT[-\s]*/i, "ChatGPT ").replace(/\s+/g, " ").trim();
    if (/^ChatGPT\b/i.test(fromName)) return fromName;
    const bare = bareId(id)
      .replace(/^gpt-/, "ChatGPT ")
      .replace(/^o(\d)/, "ChatGPT o$1")
      .replace(/-/g, " ");
    return bare.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (family === "claude") {
    return cleaned.replace(/^Anthropic:\s*/i, "") || cleaned;
  }
  if (id.startsWith("deepseek/")) {
    return /^deepseek\b/i.test(cleaned) ? cleaned : `DeepSeek ${cleaned}`;
  }
  if (id.startsWith("moonshotai/") || id.startsWith("x-ai/")) {
    return cleaned;
  }
  return cleaned;
}

function versionScore(id: string): number {
  // Higher is better. Parse dotted versions like 5.6, 4.8, 3.6.
  const bare = bareId(id);
  const match = bare.match(/(\d+)(?:\.(\d+))?/);
  if (!match) return 0;
  const major = Number(match[1]) || 0;
  const minor = Number(match[2]) || 0;
  return major * 1000 + minor * 10;
}

function tierBoost(id: string): number {
  const bare = bareId(id).toLowerCase();
  if (bare.includes("opus")) return 80;
  if (bare.includes("fable")) return 70;
  if (bare.includes("sonnet")) return 60;
  if (bare.includes("luna")) return 55;
  if (bare.includes("terra")) return 50;
  if (bare.includes("sol")) return 45;
  if (bare.includes("pro") && !bare.includes("opus")) return 40;
  if (bare.includes("haiku") || bare.includes("mini") || bare.includes("nano") || bare.includes("flash")) {
    return 10;
  }
  return 30;
}

function sortKey(id: string): [number, number, number, string] {
  const pin = PIN_INDEX.has(id) ? PIN_INDEX.get(id)! : 10_000;
  const family = familyForRankedModel(id);
  const providerRank =
    family === "other"
      ? (OTHER_PROVIDER_RANK[providerOf(id)] ?? 50)
      : 0;
  // Among unpinned: higher version+tier first → invert for ascending sort
  const capability = -(versionScore(id) * 100 + tierBoost(id));
  return [pin, providerRank, capability, id];
}

function cmp(a: string, b: string): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

const FAMILY_ORDER: RankedFamily[] = ["chatgpt", "claude", "other"];

export function rankModelsForPicker(models: RankableModel[]): RankedModelOption[] {
  const eligible = models.filter((m) => isPickerEligible(m.id));
  const byFamily: Record<RankedFamily, RankableModel[]> = {
    chatgpt: [],
    claude: [],
    other: [],
  };
  for (const m of eligible) {
    byFamily[familyForRankedModel(m.id)].push(m);
  }

  const out: RankedModelOption[] = [];
  for (const family of FAMILY_ORDER) {
    const sorted = [...byFamily[family]].sort((a, b) => cmp(a.id, b.id));
    for (const m of sorted) {
      out.push({
        id: m.id,
        label: brandModelLabel(m.id, m.name),
        family,
        description: m.context_length
          ? `${(m.context_length / 1000).toFixed(0)}K context`
          : undefined,
      });
    }
  }
  return out;
}

export function pickDefaultModel(models: RankedModelOption[]): string {
  for (const id of PREFERRED_DEFAULT_MODELS) {
    if (models.some((m) => m.id === id)) return id;
  }
  const firstChatgpt = models.find((m) => m.family === "chatgpt");
  return firstChatgpt?.id ?? models[0]?.id ?? "";
}

/** Featured majors in pinned order; only ids present in `models`. */
export function featuredModelsForPicker<T extends { id: string }>(
  models: T[],
): T[] {
  const byId = new Map(models.map((m) => [m.id, m]));
  const out: T[] = [];
  for (const id of FEATURED_MODEL_IDS) {
    const hit = byId.get(id);
    if (hit) out.push(hit);
  }
  return out;
}

export function isFeaturedModelId(id: string): boolean {
  return FEATURED_INDEX.has(id as (typeof FEATURED_MODEL_IDS)[number]);
}

/** Case-insensitive match on id + label. */
export function filterModelsByQuery<T extends { id: string; label: string }>(
  models: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return models;
  const tokens = q.split(/\s+/).filter(Boolean);
  return models.filter((m) => {
    const hay = `${m.label} ${m.id}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}
