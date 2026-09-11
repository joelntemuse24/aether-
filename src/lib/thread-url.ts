/** Conversation URL helpers — `/` is a new chat; `/c/<id>` is a stored thread. */

export const NEW_CHAT_PATH = "/";

export function threadPath(threadId: string): string {
  return `/c/${encodeURIComponent(threadId)}`;
}

export function parseThreadIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/c\/([^/]+)\/?$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** Read thread id from the current location (client-only). */
export function readThreadIdFromLocation(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return parseThreadIdFromPath(window.location.pathname) ?? undefined;
}

// ─── Sticky canonical id ───

export type CanonicalThreadState = { key: string; id: string | null };

/**
 * Keep the last known canonical thread id for a runtime item across
 * transient drops (cloud list refreshes can briefly omit a remoteId).
 * A different item key always recomputes; an upgrade (null → id) applies.
 */
export function stickyCanonicalId(
  prev: CanonicalThreadState,
  itemKey: string,
  rawId: string | null,
): CanonicalThreadState {
  if (prev.key !== itemKey) return { key: itemKey, id: rawId };
  if (rawId !== null) return { key: itemKey, id: rawId };
  return prev;
}

// ─── Bidirectional URL sync ───
//
// Two races caused UI glitching:
// 1. New chat: Active→URL ran while the runtime still reported the old
//    thread and wrote `/c/<old-id>` back (even after the path was `/`).
// 2. Refresh / deep link: the runtime constructor always switchToNewThread()
//    first, so Active→URL replaced `/c/<id>` with `/` before restore.

export type ActiveToUrlInput = {
  urlThreadId: string | null;
  canonicalId: string | null;
  /** Runtime list item status === "new" (empty chat, no remote id yet). */
  itemIsNew: boolean;
  pendingNewChat: boolean;
  /** URL thread we are applying; hold writes until the runtime matches. */
  applyingUrlThread: string | null;
};

export type UrlWrite = { action: "hold" } | { action: "write"; path: string };

export function planActiveThreadToUrl(input: ActiveToUrlInput): UrlWrite {
  // New-chat in flight wins: never write the previous thread back.
  if (input.pendingNewChat && !input.itemIsNew) {
    return { action: "write", path: NEW_CHAT_PATH };
  }
  if (input.applyingUrlThread && input.canonicalId !== input.applyingUrlThread) {
    return { action: "hold" };
  }
  return {
    action: "write",
    path: input.canonicalId ? threadPath(input.canonicalId) : NEW_CHAT_PATH,
  };
}

/** Latch clears only when the runtime reports the new empty thread. */
export function shouldClearPendingNewChat(input: {
  pendingNewChat: boolean;
  itemIsNew: boolean;
}): boolean {
  return input.pendingNewChat && input.itemIsNew;
}

export function shouldClearApplyingUrlThread(input: {
  applyingUrlThread: string | null;
  canonicalId: string | null;
  urlThreadId: string | null;
}): boolean {
  if (!input.applyingUrlThread) return false;
  if (input.canonicalId === input.applyingUrlThread) return true;
  return input.urlThreadId !== input.applyingUrlThread;
}

export type UrlToThreadAction = "ignore" | "switch-thread" | "switch-new";

export function planUrlToThread(input: {
  pathname: string;
  urlThreadId: string | null;
  pendingPath: string | null;
  pendingNewChat: boolean;
  itemIsNew: boolean;
  /** Already-mounted conversation — remounting blanks Fast failover transcripts. */
  canonicalId?: string | null;
}): UrlToThreadAction {
  if (input.urlThreadId) {
    if (input.pendingPath === input.pathname) return "ignore";
    if (input.canonicalId && input.canonicalId === input.urlThreadId) {
      return "ignore";
    }
    return "switch-thread";
  }
  // First send: initialize() writes `/c/<id>` while the path is still `/`.
  // Treating that as switch-new wipes the guest turn (blank New chat).
  if (
    input.pendingPath &&
    input.pendingPath !== NEW_CHAT_PATH &&
    input.pendingPath !== input.pathname
  ) {
    return "ignore";
  }
  // `/` must switch unless the runtime is already a new empty chat.
  // Skipping whenever pendingNewChat is set left the old thread mounted
  // (sidebar New conversation does not switchToNewThread itself).
  if (input.itemIsNew) return "ignore";
  return "switch-new";
}

export function didUrlBecomeNewChat(
  previousUrlThreadId: string | null,
  urlThreadId: string | null,
): boolean {
  return previousUrlThreadId !== null && urlThreadId === null;
}

/** Welcome / empty-canvas hold. Live URL only — never a boot-time snapshot. */
export function shouldHoldEmptyWelcome(input: {
  hasMessages: boolean;
  urlThreadId: string | null;
  hasInFlightDraft?: boolean;
}): boolean {
  if (input.hasMessages) return false;
  if (input.hasInFlightDraft) return true;
  return input.urlThreadId !== null;
}

/**
 * Arm / clear latches from the live URL during render — before Active→URL
 * can write a stale canonical id. Effect-only latching is too late.
 */
export function nextUrlSyncLatches(input: {
  urlThreadId: string | null;
  canonicalId: string | null;
  itemIsNew: boolean;
  pendingNewChat: boolean;
  applyingUrlThread: string | null;
  /** True when the path just changed from `/c/<id>` to `/`. */
  urlBecameNewChat: boolean;
}): { pendingNewChat: boolean; applyingUrlThread: string | null } {
  let pendingNewChat = input.pendingNewChat || input.urlBecameNewChat;
  let applyingUrlThread = input.applyingUrlThread;

  if (pendingNewChat) {
    applyingUrlThread = null;
  } else if (
    input.urlThreadId &&
    input.urlThreadId !== input.canonicalId
  ) {
    applyingUrlThread = input.urlThreadId;
  }

  if (shouldClearPendingNewChat({ pendingNewChat, itemIsNew: input.itemIsNew })) {
    pendingNewChat = false;
  }
  if (
    shouldClearApplyingUrlThread({
      applyingUrlThread,
      canonicalId: input.canonicalId,
      urlThreadId: input.urlThreadId,
    })
  ) {
    applyingUrlThread = null;
  }

  return { pendingNewChat, applyingUrlThread };
}
