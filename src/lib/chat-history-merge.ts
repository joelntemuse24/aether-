import type { UIMessage } from "ai";

export const AI_SDK_MESSAGE_FORMAT = "ai-sdk/v6";

export type FormatRepoEntry = {
  id: string;
  parent_id: string | null;
  format: string;
  content: Record<string, unknown>;
};

export type FormatRepoLike = {
  headId?: string | null;
  entries: FormatRepoEntry[];
};

export type HistoryMergeResult = {
  messages: UIMessage[];
  merged: boolean;
};

function textOf(message: UIMessage): string {
  if (!Array.isArray(message.parts)) return "";
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function sameMessage(a: UIMessage, b: UIMessage): boolean {
  if (a.id && b.id && a.id === b.id) return true;
  return a.role === b.role && textOf(a) === textOf(b) && textOf(a).length > 0;
}

function incomingHas(stored: UIMessage, incoming: UIMessage[]): boolean {
  return incoming.some((message) => sameMessage(stored, message));
}

/**
 * Rebuild the model transcript when the client under-sends.
 * Stored prefix wins; incoming copies of the same id win (newer draft);
 * incoming messages not already in stored are appended as the new tail.
 */
export function mergeStoredThreadWithIncoming(
  stored: UIMessage[],
  incoming: UIMessage[],
): HistoryMergeResult {
  const incomingList = Array.isArray(incoming) ? incoming : [];
  const storedList = Array.isArray(stored) ? stored : [];

  if (storedList.length === 0) {
    return { messages: incomingList, merged: false };
  }

  const incomingShorter = incomingList.length < storedList.length;
  const storedTail = storedList[storedList.length - 1];
  const tailMissing = storedTail ? !incomingHas(storedTail, incomingList) : false;

  if (!incomingShorter && !tailMissing) {
    return { messages: incomingList, merged: false };
  }

  const merged: UIMessage[] = storedList.map((message) => {
    const newer = incomingList.find((item) => item.id && item.id === message.id);
    return newer ?? message;
  });

  for (const message of incomingList) {
    if (merged.some((existing) => sameMessage(existing, message))) continue;
    merged.push(message);
  }

  return { messages: merged, merged: true };
}

export type UnderSentHistoryDetails = {
  id: string | null;
  incoming: number;
  stored: number;
};

export function resolveChatMessages(input: {
  conversationId: string | null;
  incoming: UIMessage[];
  stored: UIMessage[];
  log?: (event: "under_sent_history", details: UnderSentHistoryDetails) => void;
}): UIMessage[] {
  const incoming = Array.isArray(input.incoming) ? input.incoming : [];
  const stored = Array.isArray(input.stored) ? input.stored : [];
  const result = mergeStoredThreadWithIncoming(stored, incoming);
  if (result.merged) {
    input.log?.("under_sent_history", {
      id: input.conversationId,
      incoming: incoming.length,
      stored: stored.length,
    });
  }
  return result.messages;
}

export function uiMessagesFromFormatRepo(repo: FormatRepoLike | null | undefined): UIMessage[] {
  const entries = repo?.entries;
  if (!Array.isArray(entries)) return [];

  const messages: UIMessage[] = [];
  for (const entry of entries) {
    if (entry.format !== AI_SDK_MESSAGE_FORMAT) continue;
    if (!entry.id || !entry.content || typeof entry.content !== "object") continue;
    try {
      messages.push({
        id: entry.id,
        ...(entry.content as Omit<UIMessage, "id">),
      });
    } catch {
      // skip corrupt rows
    }
  }
  return messages;
}

export function formatRepoFromUIMessages(messages: UIMessage[]): FormatRepoLike {
  const list = Array.isArray(messages) ? messages : [];
  return {
    headId: list[list.length - 1]?.id ?? null,
    entries: list.map((message, idx) => {
      const { id, ...content } = message;
      return {
        id,
        parent_id: idx === 0 ? null : list[idx - 1]!.id,
        format: AI_SDK_MESSAGE_FORMAT,
        content: content as Record<string, unknown>,
      };
    }),
  };
}
