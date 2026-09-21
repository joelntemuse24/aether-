import type { UIMessage } from "ai";
import { mergeStoredThreadWithIncoming } from "./chat-history-merge";

/**
 * Survive the first-send remount: initialize() assigns a remoteId and
 * assistant-ui remounts useChat before persist can flush. Keep the live
 * turn (user + assistant) in module memory keyed by local + durable +
 * remote ids so the answer stays visible without a sidebar click.
 */

type FirstSendDraft = {
  keys: Set<string>;
  messages: UIMessage[];
  at: number;
};

const DRAFT_TTL_MS = 60_000;
let draft: FirstSendDraft | null = null;

function prune(): FirstSendDraft | null {
  if (!draft) return null;
  if (Date.now() - draft.at > DRAFT_TTL_MS) {
    draft = null;
    return null;
  }
  return draft;
}

export function stashFirstSendDraft(input: {
  keys: Array<string | undefined | null>;
  messages: UIMessage[];
}): void {
  const keys = input.keys.map((k) => k?.trim()).filter((k): k is string => !!k);
  if (keys.length === 0 || input.messages.length === 0) return;
  draft = {
    keys: new Set(keys),
    messages: input.messages,
    at: Date.now(),
  };
}

/** Grow the in-flight draft as the live turn streams so remounts keep the answer. */
export function rememberLiveTurn(input: {
  keys?: Array<string | undefined | null>;
  messages: UIMessage[];
}): void {
  const live = prune();
  if (!live || input.messages.length === 0) return;
  const keys = new Set(live.keys);
  for (const key of input.keys ?? []) {
    const trimmed = key?.trim();
    if (trimmed) keys.add(trimmed);
  }
  draft = {
    keys,
    messages:
      input.messages.length >= live.messages.length
        ? input.messages
        : live.messages,
    at: Date.now(),
  };
}

export function peekFirstSendDraft(key?: string | null): UIMessage[] {
  const live = prune();
  if (!live) return [];
  if (!key) return live.messages;
  if (live.keys.has(key)) return live.messages;
  return [];
}

/** In-flight first send — remount may mint a new id that was not stashed. */
export function peekInFlightFirstSendDraft(): UIMessage[] {
  return prune()?.messages ?? [];
}

export function clearFirstSendDraft(): void {
  draft = null;
}

function hasAssistant(messages: UIMessage[]): boolean {
  return messages.some((message) => message.role === "assistant");
}

/** Merge localStorage seed with an in-flight first-send draft. */
export function mergeSeedWithDraft(
  key: string | undefined,
  stored: UIMessage[],
): UIMessage[] {
  const keyed = peekFirstSendDraft(key);
  const pending =
    keyed.length > 0
      ? keyed
      : stored.length === 0 || !hasAssistant(stored)
        ? peekInFlightFirstSendDraft()
        : [];
  if (pending.length === 0) return stored;
  if (stored.length === 0) return pending;
  const preferPending =
    pending.length > stored.length ||
    (hasAssistant(pending) && !hasAssistant(stored));
  const base = preferPending ? pending : stored;
  const other = preferPending ? stored : pending;
  return mergeStoredThreadWithIncoming(base, other).messages;
}
