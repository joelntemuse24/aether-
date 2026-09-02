import type { ProviderId } from "@/lib/models";
import {
  parseToolApprovalMode,
  type ToolApprovalMode,
} from "@/lib/hermes/tool-approval";
import type { HarnessChatContext } from "@/lib/harness/types";
import type { AccessMode, AppSettings } from "@/lib/settings";
import { resolveApiKey, resolveBaseURL, resolveModel } from "@/lib/settings";

export type ChatAccessMode = "hosted" | "byok";

export type ChatClientAttachment = {
  name: string;
  mime: string;
  dataUrl: string;
};

/** Ephemeral turn payload for chat.agent (BYOK key lives here only). */
export type ChatClientData = {
  accessMode: ChatAccessMode;
  model: string;
  toolsEnabled?: boolean;
  approvalMode?: ToolApprovalMode;
  provider?: ProviderId;
  apiKey?: string;
  baseURL?: string;
  origin?: string;
  system?: string;
  harness?: HarnessChatContext;
  memoryContext?: string;
  projectId?: string;
  conversationId?: string;
  continueSegment?: boolean;
  attachments?: ChatClientAttachment[];
  textPrefix?: string;
  /** Opaque signed context minted on Vercel — worker must not log it. */
  contextToken?: string;
  userId?: string | null;
  hasDrive?: boolean;
  hasGitHub?: boolean;
  hasMemory?: boolean;
  driveAccessToken?: string;
  githubAccessToken?: string;
};

const PROVIDERS: readonly ProviderId[] = [
  "openrouter",
  "openai",
  "anthropic",
  "custom",
];

const SECRET_KEYS = [
  "apiKey",
  "contextToken",
  "driveAccessToken",
  "githubAccessToken",
] as const;

export type ParseChatClientDataResult =
  | { ok: true; data: ChatClientData }
  | { ok: false; error: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseChatClientData(raw: unknown): ParseChatClientDataResult {
  const rec = asRecord(raw);
  if (!rec) return { ok: false, error: "clientData must be an object." };

  const accessMode: ChatAccessMode =
    rec.accessMode === "byok" ? "byok" : "hosted";
  const model = str(rec.model).trim();
  if (!model) {
    return { ok: false, error: "No model selected. Pick a model from the dropdown." };
  }

  const providerRaw = str(rec.provider).trim() || "openrouter";
  const provider = (PROVIDERS as readonly string[]).includes(providerRaw)
    ? (providerRaw as ProviderId)
    : "openrouter";

  const apiKey = str(rec.apiKey).trim();
  if (accessMode === "byok" && !apiKey) {
    return {
      ok: false,
      error:
        "Missing API key. Open Settings and add an OpenRouter (or other provider) key.",
    };
  }

  const attachments = Array.isArray(rec.attachments)
    ? rec.attachments
        .map((row) => {
          const item = asRecord(row);
          if (!item) return null;
          const name = str(item.name);
          const mime = str(item.mime);
          const dataUrl = str(item.dataUrl);
          if (!name || !mime || !dataUrl) return null;
          return { name, mime, dataUrl };
        })
        .filter((row): row is ChatClientAttachment => row !== null)
    : undefined;

  const data: ChatClientData = {
    accessMode,
    model,
    toolsEnabled: rec.toolsEnabled !== false,
    approvalMode: parseToolApprovalMode(rec.approvalMode),
    provider,
    apiKey: accessMode === "byok" ? apiKey : undefined,
    baseURL: str(rec.baseURL).trim() || undefined,
    origin: str(rec.origin).trim() || undefined,
    system: str(rec.system).slice(0, 8000) || undefined,
    harness: rec.harness as HarnessChatContext | undefined,
    memoryContext: str(rec.memoryContext).slice(0, 6000) || undefined,
    projectId: str(rec.projectId).trim() || undefined,
    conversationId: str(rec.conversationId).trim() || undefined,
    continueSegment: rec.continueSegment === true,
    attachments,
    textPrefix: str(rec.textPrefix) || undefined,
    contextToken: str(rec.contextToken).trim() || undefined,
    userId:
      typeof rec.userId === "string"
        ? rec.userId
        : rec.userId === null
          ? null
          : undefined,
    hasDrive: rec.hasDrive === true,
    hasGitHub: rec.hasGitHub === true,
    hasMemory: rec.hasMemory === true,
  };

  return { ok: true, data };
}

export function resolveByokClientSecrets(
  data: Pick<ChatClientData, "accessMode" | "provider" | "apiKey" | "baseURL">,
): { provider: ProviderId; apiKey: string; baseURL?: string } | null {
  if (data.accessMode !== "byok") return null;
  const apiKey = data.apiKey?.trim() ?? "";
  if (!apiKey) return null;
  return {
    provider: data.provider ?? "openrouter",
    apiKey,
    baseURL: data.baseURL?.trim() || undefined,
  };
}

/** Strip secrets before Neon, snapshots, or any durable dump. */
export function persistableChatClientData(
  data: ChatClientData,
): Omit<
  ChatClientData,
  "apiKey" | "contextToken" | "driveAccessToken" | "githubAccessToken"
> {
  const rest = { ...data };
  delete rest.apiKey;
  delete rest.contextToken;
  delete rest.driveAccessToken;
  delete rest.githubAccessToken;
  return rest;
}

/**
 * Sticky session payload for createStartSessionAction.
 * Drops the BYOK key (and raw connector tokens) so they are not stored on the
 * session row. Keeps the opaque context JWT for Aether tool callbacks.
 * Per-turn transport clientData still carries apiKey for that turn only.
 */
export function sessionSafeChatClientData(data: ChatClientData): ChatClientData {
  const rest = { ...data };
  delete rest.apiKey;
  delete rest.driveAccessToken;
  delete rest.githubAccessToken;
  return rest;
}

export function redactChatClientData(
  data: Record<string, unknown> | ChatClientData,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...data };
  for (const key of SECRET_KEYS) {
    if (key in next && next[key]) next[key] = "[redacted]";
  }
  return next;
}

export function buildBrowserChatClientData(input: {
  settings: AppSettings;
  origin?: string;
  harness?: HarnessChatContext | null;
  memoryContext?: string;
  projectId?: string | null;
  conversationId?: string;
  continueSegment?: boolean;
  attachments?: ChatClientAttachment[];
  textPrefix?: string;
  system?: string;
}): ChatClientData {
  const accessMode: AccessMode =
    input.settings.accessMode === "byok" ? "byok" : "hosted";
  const data: ChatClientData = {
    accessMode,
    model: resolveModel(input.settings),
    toolsEnabled: input.settings.enableTools,
    approvalMode: parseToolApprovalMode(input.settings.toolApprovalMode),
    origin: input.origin,
    system: input.system,
    harness: input.harness ?? undefined,
    memoryContext: input.memoryContext,
    projectId: input.projectId ?? undefined,
    conversationId: input.conversationId,
    continueSegment: input.continueSegment === true,
    attachments: input.attachments,
    textPrefix: input.textPrefix,
  };
  if (accessMode === "byok") {
    data.provider = input.settings.provider;
    data.apiKey = resolveApiKey(input.settings);
    data.baseURL = resolveBaseURL(input.settings);
  }
  return data;
}
