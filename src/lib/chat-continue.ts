import type { UIMessage } from "ai";

/** Cap auto-continues so a stuck loop can't burn unbounded segments. */
export const MAX_AUTO_CONTINUES = 5;

/**
 * Ignore very short disconnects (flaky network). Platform kills are usually
 * much longer — but Vercel/hobby/proxy cuts can land earlier than 45s.
 */
export const MIN_DISCONNECT_RUN_MS = 20_000;

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
  // Exact-ish abort messages only — don't treat "aborted by server timeout" as user stop.
  return /^(AbortError|The operation was aborted\.?|aborted|signal is aborted without reason)$/i.test(
    raw.trim(),
  );
}

function errorText(error: unknown): string {
  if (!error) return "";
  if (error instanceof Error) {
    return `${error.name} ${error.message} ${error.cause ?? ""}`;
  }
  if (typeof error === "object") {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

/** True when the platform (e.g. Vercel maxDuration) likely killed the run. */
export function isServerTimeoutError(error: unknown): boolean {
  if (isAbortError(error)) return false;
  const raw = errorText(error);
  return /timed out after|Task timed out|Runtime Timeout|FUNCTION_INVOCATION_TIMEOUT|deadline exceeded|WS_TIMEOUT|function.*timeout|timeout of \d+ms exceeded|server time limit|Gateway Timeout|504|524|ERR_SOCKET_TIMEOUT|network.?timeout|body.?timeout|stream.?timeout/i.test(
    raw,
  );
}

/**
 * Stream died mid-turn without a clean user stop — proxy kill, network drop,
 * empty provider error, etc. Broader than pure "timeout" strings.
 */
export function isLikelyStreamCutOffError(error: unknown): boolean {
  if (error == null || error === false) return false;
  if (isAbortError(error)) return false;
  if (isServerTimeoutError(error)) return true;
  const raw = errorText(error);
  // Present error with no useful message (common after stream drops).
  if (error instanceof Error && !error.message.trim()) return true;
  if (typeof error === "string" && !error.trim()) return true;
  return /Failed to fetch|NetworkError|network error|Load failed|ECONNRESET|ECONNREFUSED|socket hang up|other side closed|connection (?:closed|reset|lost)|ERR_CONNECTION|BodyStreamBuffer|Unexpected end of JSON|undici|fetch failed|stream (?:ended|closed|aborted)|incomplete response|HTTP 50[234]|502|503|504|524/i.test(
    raw,
  );
}

/** True when copy or status suggests the user should hit Continue. */
export function looksLikeTimeoutCopy(text: string | undefined | null): boolean {
  if (!text) return false;
  return /time limit|timed out|timeout|cut off|interrupted by a platform|server (?:time )?limit|paused|continue from/i.test(
    text,
  );
}

function partHasContinuableWork(part: {
  type?: string;
  text?: string;
  toolName?: string;
  state?: string;
}): boolean {
  if (!part || typeof part.type !== "string") return false;
  if (part.type === "text") {
    return typeof part.text === "string" && part.text.trim().length > 0;
  }
  // AI SDK UI: `tool-call`, `tool-<name>`, dynamic tools
  if (part.type === "tool-call" || part.type === "dynamic-tool") return true;
  if (part.type.startsWith("tool-")) return true;
  // Reasoning / step markers still mean partial work exists
  if (part.type === "reasoning" || part.type === "step-start") return true;
  return false;
}

export function hasContinuableAssistant(messages: UIMessage[]): boolean {
  // Prefer last assistant; also scan back a few messages if stream ordered oddly.
  for (let i = messages.length - 1; i >= 0 && i >= messages.length - 4; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== "assistant") continue;
    const parts = Array.isArray(msg.parts) ? msg.parts : [];
    if (parts.some((p) => partHasContinuableWork(p as { type?: string }))) {
      return true;
    }
    // Some stores keep text on the message itself
    const anyMsg = msg as { content?: string };
    if (typeof anyMsg.content === "string" && anyMsg.content.trim()) {
      return true;
    }
  }
  return false;
}

/**
 * Whether the UI should show Continue (even if we don't auto-fire).
 * Broader than shouldAutoContinue — invite resume when the turn looks cut off.
 * Does NOT use duration alone (that false-triggers on successful long replies).
 */
export function shouldOfferContinue(input: {
  isAbort: boolean;
  isDisconnect: boolean;
  isError: boolean;
  error?: unknown;
  messages: UIMessage[];
  runDurationMs: number;
}): boolean {
  if (input.isAbort) return false;
  if (!hasContinuableAssistant(input.messages)) return false;

  if (isServerTimeoutError(input.error) || isLikelyStreamCutOffError(input.error)) {
    return true;
  }
  // Any error / disconnect with partial work → offer Continue.
  if (input.isDisconnect || input.isError) return true;

  return false;
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
  if (isLikelyStreamCutOffError(input.error) && input.isError) return true;

  // Abrupt stream drop after a meaningful run ≈ serverless / proxy wall clock.
  if (
    (input.isDisconnect || input.isError) &&
    input.runDurationMs >= MIN_DISCONNECT_RUN_MS
  ) {
    return true;
  }

  return false;
}
