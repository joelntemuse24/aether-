/** Curated chat models used when OpenRouter's catalog cannot be loaded. */
export const OPENROUTER_CURATED_MODELS: { id: string; label: string }[] = [
  { id: "openai/gpt-4.1", label: "GPT-4.1" },
  { id: "openai/gpt-4.1-mini", label: "GPT-4.1 Mini" },
  { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
  { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" },
];

const DEFAULT_GPT_BACKUP = "openai/gpt-4.1";

/** Buzz id → OpenRouter id. Override with AETHER_OPENROUTER_MODEL_MAP JSON. */
export const DEFAULT_OPENROUTER_MODEL_MAP: Record<string, string> = {
  "gpt-5.6-luna": DEFAULT_GPT_BACKUP,
  "gpt-5.6-sol": "openai/gpt-4.1",
  "gpt-5.6-terra": "openai/gpt-4.1",
  "gpt-6-astra": "openai/gpt-4.1",
  "gpt-6-sol": "openai/gpt-4.1",
  "gpt-6.1-sol": "openai/gpt-4.1",
};

export type OpenRouterCatalogRow = {
  id?: string;
  name?: string;
  supported_parameters?: string[];
  architecture?: { modality?: string };
};

export function isOpenRouterModelId(id: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i.test(id.trim());
}

export function filterOpenRouterChatModels(rows: OpenRouterCatalogRow[]): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = row.id?.trim() ?? "";
    if (!isOpenRouterModelId(id) || seen.has(id)) continue;
    if (/embed|whisper|moderation|image|tts|dall-e|flux/i.test(id)) continue;
    const modality = row.architecture?.modality ?? "";
    if (modality.startsWith("image") || modality.startsWith("audio")) continue;
    if (!(row.supported_parameters ?? []).includes("tools")) continue;
    seen.add(id);
    out.push({ id, label: row.name?.trim() || id });
  }
  return out;
}

export function openRouterModelMap(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const raw = env.AETHER_OPENROUTER_MODEL_MAP?.trim();
  if (!raw) return { ...DEFAULT_OPENROUTER_MODEL_MAP };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_OPENROUTER_MODEL_MAP };
    }
    const extra: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && isOpenRouterModelId(value)) extra[key] = value;
    }
    return { ...DEFAULT_OPENROUTER_MODEL_MAP, ...extra };
  } catch {
    return { ...DEFAULT_OPENROUTER_MODEL_MAP };
  }
}

/** Luna and other GPT ids map to an OpenAI model. Claude ids keep the same name on OpenRouter. */
export function openRouterFallbackModel(
  buzzId: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const id = buzzId.trim();
  const map = openRouterModelMap(env);
  if (map[id]) return map[id];
  if (id.startsWith("claude-") && isOpenRouterModelId(`anthropic/${id}`)) return `anthropic/${id}`;
  if (id.startsWith("gpt-")) return DEFAULT_GPT_BACKUP;
  return DEFAULT_GPT_BACKUP;
}

export function redactSecret(message: string, secret: string): string {
  if (!secret) return message;
  return message.split(secret).join("[redacted]");
}
