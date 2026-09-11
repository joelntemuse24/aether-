import type { FinishReason, ModelMessage } from "ai";

/**
 * SDK `chat.headStart` treats a rejected `finishReason` as `handover-skip`:
 * the parked `handover-prepare` run exits with no tools and no turn hooks.
 * Vercel `maxDuration = 60` and the SDK's wall-clock idle timer both abort
 * that promise — including Expert thinking and in-flight tool-call emission.
 *
 * Map abort to a real handover so the durable agent owns the rest of the turn.
 */

export type HeadStartStreamLike = {
  finishReason: PromiseLike<FinishReason>;
  response: PromiseLike<{ messages: ModelMessage[] }>;
};

export function isHeadStartAbort(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "object" && "name" in error) {
    const name = String((error as { name?: unknown }).name ?? "");
    if (name === "AbortError" || name === "TimeoutError") return true;
  }
  const raw = error instanceof Error ? error.message : String(error);
  return /abort|idle timeout|chat\.handover|FUNCTION_INVOCATION_TIMEOUT|timed out after/i.test(
    raw,
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function modelMessagesNeedToolHandover(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false;
  for (const message of messages) {
    const rec = asRecord(message);
    if (rec.role !== "assistant") continue;
    const content = rec.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const type = asRecord(part).type;
      if (type === "tool-call" || type === "tool-approval-request") return true;
    }
  }
  return false;
}

export function modelMessagesHaveAssistantContent(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false;
  for (const message of messages) {
    const rec = asRecord(message);
    if (rec.role !== "assistant") continue;
    const content = rec.content;
    if (typeof content === "string" && content.trim()) return true;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const p = asRecord(part);
      if (p.type === "text" && typeof p.text === "string" && p.text.trim()) {
        return true;
      }
      if (p.type === "reasoning" && typeof p.text === "string" && p.text.trim()) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Abort before a finishReason:
 * - pending tool calls → agent executes them (`isFinal: false`)
 * - empty step 1 (killed while thinking) → agent runs the turn (`isFinal: false`)
 * - partial text/reasoning only → persist as final (`isFinal: true`) so we
 *   don't duplicate a nearly-finished answer
 */
export function finishReasonAfterHeadStartAbort(
  messages: unknown,
): FinishReason {
  if (modelMessagesNeedToolHandover(messages)) return "tool-calls";
  if (modelMessagesHaveAssistantContent(messages)) return "stop";
  return "tool-calls";
}

export function wrapHeadStartStreamResult<T extends HeadStartStreamLike>(
  result: T,
): T {
  const patchedFinish: Promise<FinishReason> = Promise.resolve(
    result.finishReason,
  ).then(
    (reason) => reason,
    async (error) => {
      if (!isHeadStartAbort(error)) throw error;
      const messages = await Promise.resolve(result.response)
        .then((r) => r.messages)
        .catch(() => [] as ModelMessage[]);
      return finishReasonAfterHeadStartAbort(messages);
    },
  );

  return new Proxy(result, {
    get(target, prop, receiver) {
      if (prop === "finishReason") return patchedFinish;
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  }) as T;
}
