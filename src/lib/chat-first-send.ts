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

export type ClassifyBeforeSendDecision = {
  /** When true, composer send awaits POST /api/harness/classify. */
  awaitModelClassify: boolean;
  /** When true, needsClarify must not delay composer.send() / Head Start. */
  skipClarifyGate: boolean;
};

/**
 * First send must not wait on model classify. Head Start fires on Send;
 * classify is skipped for the first turn (do not run it in parallel — that
 * would contend with the hosted first-token call). Later turns may still
 * await classify for clarify cards and plan quality.
 */
export function planClassifyBeforeSend(input: {
  isFirstTurn: boolean;
  heuristicSkipsModel: boolean;
}): ClassifyBeforeSendDecision {
  if (input.isFirstTurn) {
    return { awaitModelClassify: false, skipClarifyGate: true };
  }
  if (input.heuristicSkipsModel) {
    return { awaitModelClassify: false, skipClarifyGate: false };
  }
  return { awaitModelClassify: true, skipClarifyGate: false };
}

export type ComposerSendPlan =
  | { action: "send" }
  | { action: "ignore" }
  | { action: "keep-and-explain"; keepComposerText: true; message: string };

/**
 * Guest / first-send must never look like a successful send that vanished.
 * Keep the composer text and say why when the runtime cannot start the turn.
 */
export function planComposerSend(input: {
  hasKey: boolean;
  canSend: boolean;
  hostedLoading: boolean;
  isRunning: boolean;
  classifying: boolean;
  hasText: boolean;
  /** User turn already left the composer — never swap it for Preferences. */
  turnAlreadyStarted?: boolean;
}): ComposerSendPlan {
  if (input.isRunning || input.classifying) return { action: "ignore" };
  if (!input.hasText) return { action: "ignore" };
  if (
    !input.turnAlreadyStarted &&
    (input.hostedLoading || !input.hasKey)
  ) {
    return {
      action: "keep-and-explain",
      keepComposerText: true,
      message:
        "Chat isn’t ready yet — open Preferences, or wait a moment for Cloud.",
    };
  }
  if (!input.canSend) {
    return {
      action: "keep-and-explain",
      keepComposerText: true,
      message: "Couldn’t send that turn. Your message is still here — try again.",
    };
  }
  return { action: "send" };
}
