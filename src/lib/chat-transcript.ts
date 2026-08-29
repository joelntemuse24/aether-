import type { UIMessage } from "ai";
import { mergeStoredThreadWithIncoming } from "./chat-history-merge";

/** Send stays disabled until hydrate finished and live is not empty when storage has history. */
export function shouldBlockSend(input: {
  historyReady: boolean;
  storedCount: number;
  liveCount: number;
}): boolean {
  if (!input.historyReady) return true;
  if (input.storedCount > 0 && input.liveCount === 0) return true;
  return false;
}

/** First durable id for this chat — copy the in-memory draft onto that key. */
export function shouldCopyDraftToRemoteId(input: {
  previousKey: string | undefined;
  nextKey: string | undefined;
  liveCount: number;
}): boolean {
  return Boolean(
    input.nextKey &&
      input.liveCount > 0 &&
      input.previousKey !== input.nextKey,
  );
}

export function prepareOutgoingChatMessages(input: {
  stored: UIMessage[];
  live: UIMessage[];
}): UIMessage[] {
  return mergeStoredThreadWithIncoming(input.stored, input.live).messages;
}

/**
 * Same function the transport uses: conversationId is set before POST,
 * and messages are stored + new tail (never a lone Continue / lone B).
 */
export function buildChatSendBody(input: {
  conversationId: string | undefined;
  stored: UIMessage[];
  live: UIMessage[];
}): { conversationId: string | undefined; messages: UIMessage[] } {
  return {
    conversationId: input.conversationId,
    messages: prepareOutgoingChatMessages({
      stored: input.stored,
      live: input.live,
    }),
  };
}

/** A→B replaces live with B's store. Same thread merges stored + live tail. */
export function hydrateThreadMessages(input: {
  previousKey: string | null;
  nextKey: string;
  live: UIMessage[];
  stored: UIMessage[];
}): UIMessage[] {
  const switched =
    input.previousKey != null && input.previousKey !== input.nextKey;
  if (switched) return input.stored;
  if (input.stored.length > 0) {
    return mergeStoredThreadWithIncoming(input.stored, input.live).messages;
  }
  return input.live;
}

export function shouldPersistTranscriptImmediately(input: {
  last: UIMessage | undefined;
  status: string;
}): boolean {
  return (
    input.last?.role === "user" ||
    hasCompletedToolResult(input.last) ||
    input.status === "ready" ||
    input.status === "error"
  );
}

export function hasCompletedToolResult(message: UIMessage | undefined): boolean {
  if (!message || !Array.isArray(message.parts)) return false;
  return message.parts.some((part) => {
    if (typeof part.type !== "string" || !part.type.startsWith("tool-")) {
      return false;
    }
    return "output" in part && part.output != null;
  });
}
