import type { UIMessage } from "ai";

/** Cap auto-continues so a stuck loop can't burn unbounded segments. */
export const MAX_AUTO_CONTINUES = 5;

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
  return /timed out after|Task timed out|Runtime Timeout|FUNCTION_INVOCATION_TIMEOUT|deadline exceeded|WS_TIMEOUT|function.*timeout|timeout of \d+ms exceeded|server time limit/i.test(
    raw,
  );
}

/** True when copy or status suggests the user should hit Continue. */
export function looksLikeTimeoutCopy(text: string | undefined | null): boolean {
  if (!text) return false;
  return /time limit|timed out|timeout|cut off|interrupted by a platform/i.test(
    text,
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

function asPartRecord(part: UIMessage["parts"][number]): Record<string, unknown> {
  if (!part || typeof part !== "object") return {};
  return part as Record<string, unknown>;
}

function isToolPart(part: UIMessage["parts"][number]): boolean {
  const type = typeof part.type === "string" ? part.type : "";
  return type === "tool-call" || type.startsWith("tool-");
}

function toolPartIsComplete(part: UIMessage["parts"][number]): boolean {
  const rec = asPartRecord(part);
  if (rec.state === "output-available" || rec.state === "output-error") {
    return true;
  }
  if (rec.output != null || rec.result !== undefined) return true;
  const status = rec.status as { type?: string } | undefined;
  const t = status?.type;
  if (t === "complete" || t === "incomplete" || t === "cancelled") return true;
  return false;
}

/** Last assistant still has a tool call that never produced a result. */
export function hasIncompleteToolWork(messages: UIMessage[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return false;
  const parts = Array.isArray(last.parts) ? last.parts : [];
  return parts.some((part) => isToolPart(part) && !toolPartIsComplete(part));
}

/** Stream ended between tools, or tools never resolved — not a finished answer. */
export function looksLikeUnfinishedTurn(messages: UIMessage[]): boolean {
  if (hasIncompleteToolWork(messages)) return true;
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return false;
  const parts = Array.isArray(last.parts) ? last.parts : [];
  const hasTools = parts.some((part) => isToolPart(part));
  if (!hasTools) return false;
  const text = parts
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("")
    .trim();
  return text.length === 0;
}

/** Head Start is 60s; treat a long abort with open tools as a platform kill. */
export const PLATFORM_ABORT_MIN_MS = 50_000;

export type ContinueDecisionInput = {
  isAbort: boolean;
  isDisconnect: boolean;
  isError: boolean;
  error?: unknown;
  messages: UIMessage[];
  runDurationMs: number;
  continueCount: number;
};

/** Fallback after live session follow ends with unfinished work. */
export function shouldAutoContinue(input: ContinueDecisionInput): boolean {
  if (input.continueCount >= MAX_AUTO_CONTINUES) return false;
  const unfinished = looksLikeUnfinishedTurn(input.messages);
  if (input.isAbort) {
    return (
      unfinished &&
      input.runDurationMs >= PLATFORM_ABORT_MIN_MS &&
      hasContinuableAssistant(input.messages)
    );
  }
  if (!hasContinuableAssistant(input.messages) && !unfinished) return false;

  if (unfinished) return true;
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

/** Show the Continue bar even when auto-continue budget is spent. */
export function shouldOfferContinue(input: ContinueDecisionInput): boolean {
  const unfinished = looksLikeUnfinishedTurn(input.messages);
  if (input.isAbort && !unfinished) return false;
  if (unfinished) return true;
  if (!hasContinuableAssistant(input.messages)) return false;
  if (isServerTimeoutError(input.error)) return true;
  if (input.isDisconnect || input.isError) return true;
  return false;
}
