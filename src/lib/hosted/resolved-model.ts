/**
 * Real upstream model behind Free auto, for Joel's debugging only.
 *
 * OmniRoute answers with the model it picked: response header `x-omniroute-model`
 * (for example `apodex/apodex-1.1-mini:free`), `x-omniroute-provider`, and the
 * JSON body `model`. The product UI keeps saying "Free auto". The id is stored
 * on the assistant message (`metadata.custom.resolvedModel`) and in
 * sessionStorage, and only the model picker reveals it on request.
 */
import { HOSTED_DEFAULT_MODEL_FQN, HOSTED_DEFAULT_MODEL_ID } from "./default-model";

export const RESOLVED_MODEL_HEADER = "x-omniroute-model";
export const RESOLVED_PROVIDER_HEADER = "x-omniroute-provider";
/** localStorage flag. "1" shows "Resolved: …" under the Free auto picker label. */
export const DEBUG_MODELS_STORAGE_KEY = "aether.debugModels";
/** sessionStorage key holding the last resolved model id. */
export const LAST_RESOLVED_MODEL_KEY = "aether:lastResolvedModel";
/** Window event fired when a new resolved model is stored. */
export const RESOLVED_MODEL_EVENT = "aether:resolved-model";

const MAX_LENGTH = 200;

type HeaderSource =
  | { get(name: string): string | null | undefined }
  | Record<string, unknown>
  | null
  | undefined;

function readHeader(headers: HeaderSource, name: string): string {
  if (!headers) return "";
  if (typeof (headers as { get?: unknown }).get === "function") {
    return String((headers as { get(n: string): unknown }).get(name) ?? "");
  }
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === name && typeof value === "string") return value;
  }
  return "";
}

/** Trims, drops control characters, and caps length. Empty and generic ids become null. */
export function cleanResolvedModel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_LENGTH);
  if (!value) return null;
  // The combo name is what the user already picked, so it says nothing new.
  if (value === HOSTED_DEFAULT_MODEL_ID || value === HOSTED_DEFAULT_MODEL_FQN) return null;
  return value;
}

/**
 * Resolved model from response headers, then the completion JSON `model`.
 * A bare body model gets the `x-omniroute-provider` prefix when one is sent.
 */
export function extractResolvedModel(input: {
  headers?: HeaderSource;
  body?: unknown;
}): string | null {
  const fromHeader = cleanResolvedModel(readHeader(input.headers, RESOLVED_MODEL_HEADER));
  if (fromHeader) return fromHeader;
  const body = input.body;
  const bodyModel = cleanResolvedModel(
    body && typeof body === "object" ? (body as { model?: unknown }).model : undefined,
  );
  if (!bodyModel) return null;
  const provider = cleanResolvedModel(readHeader(input.headers, RESOLVED_PROVIDER_HEADER));
  return provider && !bodyModel.includes("/") ? `${provider}/${bodyModel}` : bodyModel;
}

/**
 * Resolved model carried by a TrueForge turn event. The SDK's `model.message`
 * events carry no model today, so this reads optional `model` / `resolvedModel`
 * / `headers` fields a patched sidecar can add (see `chat-stream.ts`).
 */
export function resolvedModelFromEvent(event: { [key: string]: unknown }): string | null {
  const direct = cleanResolvedModel(event.resolvedModel);
  if (direct) return direct;
  const headers =
    event.headers && typeof event.headers === "object"
      ? (event.headers as Record<string, unknown>)
      : null;
  return extractResolvedModel({ headers, body: event });
}

/** AI SDK message metadata that carries the resolved model. */
export function resolvedModelMetadata(id: string): { custom: { resolvedModel: string } } {
  return { custom: { resolvedModel: id } };
}

export function resolvedModelFromMessage(
  message: { metadata?: unknown } | null | undefined,
): string | null {
  const custom = (message?.metadata as { custom?: unknown } | null | undefined)?.custom;
  if (!custom || typeof custom !== "object") return null;
  return cleanResolvedModel((custom as { resolvedModel?: unknown }).resolvedModel);
}

export function isDebugModelsEnabled(storage?: Pick<Storage, "getItem"> | null): boolean {
  try {
    const store = storage ?? (typeof window === "undefined" ? null : window.localStorage);
    return store?.getItem(DEBUG_MODELS_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function readLastResolvedModel(storage?: Pick<Storage, "getItem"> | null): string | null {
  try {
    const store = storage ?? (typeof window === "undefined" ? null : window.sessionStorage);
    return cleanResolvedModel(store?.getItem(LAST_RESOLVED_MODEL_KEY));
  } catch {
    return null;
  }
}

/** Stores the id for this browser session and tells the picker. */
export function rememberResolvedModel(raw: unknown): void {
  const id = cleanResolvedModel(raw);
  if (!id || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(LAST_RESOLVED_MODEL_KEY, id);
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent(RESOLVED_MODEL_EVENT, { detail: { id } }));
}
