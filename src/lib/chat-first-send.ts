/**
 * First-send orchestration: do not block hosted TTFB on /c/ navigation,
 * conversation create, or the old 8s history-hydrate timeout.
 */

export const HISTORY_WAIT_BEFORE_SEND_MS = 250;

export function isNewEmptyChat(input: {
  pathnameHasThread: boolean;
  hasRemoteId: boolean;
  storedCount: number;
}): boolean {
  return !input.pathnameHasThread && !input.hasRemoteId && input.storedCount === 0;
}

/** True only when an existing thread still needs its stored transcript. */
export function shouldAwaitHistoryBeforeSend(input: {
  pathnameHasThread: boolean;
  hasRemoteId: boolean;
  storedCount: number;
  historyReady: boolean;
}): boolean {
  if (isNewEmptyChat(input)) return false;
  if (input.historyReady) return false;
  return input.storedCount > 0 || input.pathnameHasThread || input.hasRemoteId;
}

/** URL + remoteId assignment must run in the background after send. */
export function shouldAwaitThreadInitializeBeforeSend(): boolean {
  return false;
}
