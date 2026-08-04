import type { UIMessage } from "ai";

/** Cap auto-continues so a stuck loop can't burn unbounded segments. */
export const MAX_AUTO_CONTINUES = 3;

/** Ignore short disconnects (flaky network); long runs are likely platform kills. */
export const MIN_DISCONNECT_RUN_MS = 45_000;

/**
 * User-visible continue turn. Kept explicit so the model (and history) know
 * this is a resume, not a new request.
 */
export const CONTINUE_USER_TEXT =
  "Continue from where you left off. The previous reply was cut off by a platform time limit — do not restart the task; finish incomplete artifacts/tools and avoid repeating completed work.";

/** Injected into /api/chat system prompt for continue segments. */
export const CONTINUE_SYSTEM_ADDENDUM = [
  "## Continue segment",
  "The previous assistant turn was interrupted by a platform time limit.",
  "Resume the same job from the latest messages.",
  "Do not restart the whole task or re-ask clarifying questions already answered.",
  "If an artifact or tool call was incomplete, finish or recreate it completely.",
  "Prefer appending/completing over repeating content the user already saw.",
].join("\n");

export function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    if (error.name === "AbortError") return true;
  }
  if (error instanceof Error && error.name === "AbortError") return true;
  const raw = error instanceof Error ? error.message : String(error);
  return /^(AbortError|The operation was aborted|aborted)$/i.test(raw.trim());
}

/** True when the platform (e.g. Vercel maxDuration) likely killed the run. */
export function isServerTimeoutError(error: unknown): boolean {
  if (isAbortError(error)) return false;
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return /timed out after|Task timed out|Runtime Timeout|FUNCTION_INVOCATION_TIMEOUT|deadline exceeded|WS_TIMEOUT|function.*timeout|timeout of \d+ms exceeded/i.test(
    raw,
  );
}

export function hasContinuableAssistant(messages: UIMessage[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return false;
  const parts = Array.isArray(last.parts) ? last.parts : [];
  return parts.some((part) => {
    if (part.type === "text") {
      return typeof part.text === "string" && part.text.trim().length > 0;
    }
    if (typeof part.type === "string" && part.type.startsWith("tool-")) {
      return true;
    }
    return false;
  });
}

export function shouldAutoContinue(input: {
  isAbort: boolean;
  isDisconnect: boolean;
  isError: boolean;
  error?: unknown;
  messages: UIMessage[];
  runDurationMs: number;
  continueCount: number;
}): boolean {
  if (input.isAbort) return false;
  if (input.continueCount >= MAX_AUTO_CONTINUES) return false;
  if (!hasContinuableAssistant(input.messages)) return false;

  if (isServerTimeoutError(input.error)) return true;

  // Abrupt stream drop after a long run ≈ serverless wall clock.
  if (
    (input.isDisconnect || input.isError) &&
    input.runDurationMs >= MIN_DISCONNECT_RUN_MS
  ) {
    return true;
  }

  return false;
}
