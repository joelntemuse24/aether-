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

export function prepareContinueOutgoingMessages(
  stored: UIMessage[],
  continueUser: UIMessage,
): UIMessage[] {
  return mergeStoredThreadWithIncoming(stored, [continueUser]).messages;
}

/** A→B never carries A's live array. B comes from B's store (possibly empty). */
export function messagesAfterThreadSwitch(input: {
  previousKey: string | null;
  nextKey: string;
  live: UIMessage[];
  storedNext: UIMessage[];
}): UIMessage[] {
  if (input.previousKey && input.previousKey !== input.nextKey) {
    return input.storedNext;
  }
  return input.storedNext.length > 0 ? input.storedNext : input.live;
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
