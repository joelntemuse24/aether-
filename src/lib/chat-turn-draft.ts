import type { UIMessage } from "ai";

/**
 * Survive the first-send remount: initialize() assigns a remoteId and
 * assistant-ui remounts useChat before persist can flush. Keep the user
 * turn in module memory keyed by local + durable + remote ids.
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

/** Merge localStorage seed with an in-flight first-send draft. */
export function mergeSeedWithDraft(
  key: string | undefined,
  stored: UIMessage[],
): UIMessage[] {
  const pending =
    peekFirstSendDraft(key).length > 0
      ? peekFirstSendDraft(key)
      : stored.length === 0
        ? peekInFlightFirstSendDraft()
        : [];
  if (pending.length === 0) return stored;
  if (stored.length === 0) return pending;
  const seen = new Set(stored.map((m) => m.id).filter(Boolean));
  const extra = pending.filter((m) => !m.id || !seen.has(m.id));
  return extra.length === 0 ? stored : [...stored, ...extra];
}
