/**
 * Scripted model for offline loop tests. Not a production provider.
 */

import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { APICallError } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

export type ScriptedModelStep =
  | { kind: "text"; text: string; reasoning?: string }
  | { kind: "tools"; calls: Array<{ id?: string; name: string; input: string }> }
  | { kind: "midstream-error"; statusCode: number; text?: string }
  | { kind: "throw"; statusCode: number };

function finish(reason: "stop" | "tool-calls" | "error"): LanguageModelV3StreamPart {
  return {
    type: "finish",
    finishReason: { unified: reason, raw: reason },
    usage,
  };
}

function textChunks(text: string, reasoning?: string): LanguageModelV3StreamPart[] {
  const chunks: LanguageModelV3StreamPart[] = [{ type: "stream-start", warnings: [] }];
  if (reasoning) {
    chunks.push(
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", delta: reasoning },
      { type: "reasoning-end", id: "r1" },
    );
  }
  chunks.push(
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: text },
    { type: "text-end", id: "t1" },
    finish("stop"),
  );
  return chunks;
}

function streamResult(chunks: LanguageModelV3StreamPart[]) {
  return {
    stream: simulateReadableStream({
      chunks,
      initialDelayInMs: null,
      chunkDelayInMs: null,
    }),
  };
}

function providerError(statusCode: number) {
  return new APICallError({
    message: "provider error",
    url: "https://mock.invalid/v1/chat",
    requestBodyValues: {},
    statusCode,
    isRetryable: statusCode === 408 || statusCode === 409 || statusCode === 429 || statusCode >= 500,
  });
}

export function scriptedMockModel(options: {
  modelId: string;
  steps: readonly ScriptedModelStep[];
}): MockLanguageModelV3 {
  let index = 0;
  return new MockLanguageModelV3({
    provider: "mock",
    modelId: options.modelId,
    doStream: async (call) => {
      const step = options.steps[Math.min(index, Math.max(0, options.steps.length - 1))];
      index += 1;
      const forcedText = call.toolChoice?.type === "none";
      if (!step || (forcedText && step.kind === "tools")) {
        return streamResult(textChunks("Here is the answer."));
      }
      if (step.kind === "throw") {
        throw providerError(step.statusCode);
      }
      if (step.kind === "midstream-error") {
        const chunks: LanguageModelV3StreamPart[] = [{ type: "stream-start", warnings: [] }];
        if (step.text) {
          chunks.push(
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: step.text },
            { type: "text-end", id: "t1" },
          );
        }
        chunks.push({ type: "error", error: providerError(step.statusCode) });
        return streamResult(chunks);
      }
      if (step.kind === "tools") {
        const chunks: LanguageModelV3StreamPart[] = [
          { type: "stream-start", warnings: [] },
          ...step.calls.map(
            (toolCall, i): LanguageModelV3StreamPart => ({
              type: "tool-call",
              toolCallId: toolCall.id ?? `call_${index}_${i}`,
              toolName: toolCall.name,
              input: toolCall.input,
            }),
          ),
          finish("tool-calls"),
        ];
        return streamResult(chunks);
      }
      return streamResult(textChunks(step.text, step.reasoning));
    },
  });
}
