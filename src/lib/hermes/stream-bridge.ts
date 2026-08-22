import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
} from "ai";
import { friendlyChatError } from "@/lib/chat-errors";
import {
  consumeSseBuffer,
  contentDeltaFromChunk,
  isToolProgressDone,
  parseChatCompletionChunk,
  parseHermesToolProgress,
  toolCallIdFromProgress,
  toolNameFromProgress,
  type HermesToolProgress,
} from "./sse";
import { extractHermesRunId } from "./stop";

export type BridgeHermesStreamArgs = {
  body: ReadableStream<Uint8Array>;
  abortSignal?: AbortSignal;
  onError?: (error: unknown) => string;
  /** Optional correlation callback when Hermes completion id is known */
  onCompletionId?: (id: string) => void;
  /** Hermes Runs API id when present on SSE payloads */
  onRunId?: (runId: string) => void;
  /** Called after the upstream stream is fully consumed (success, abort, or error). */
  onEnd?: (info: { completionId?: string; aborted?: boolean; runId?: string }) => void;
};

/**
 * Convert a Hermes OpenAI Chat Completions SSE body into an AI SDK
 * UIMessage stream Response for assistant-ui / useChat.
 */
export function bridgeHermesChatCompletionToUIMessageResponse(
  args: BridgeHermesStreamArgs,
): Response {
  const onError = args.onError ?? friendlyChatError;

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const textId = generateId();
      let started = false;
      let textStarted = false;
      let toolSeq = 0;
      let completionId: string | undefined;
      let runId: string | undefined;
      let aborted = false;
      const openTools = new Set<string>();

      const noteRunId = (json: unknown) => {
        if (runId) return;
        const found = extractHermesRunId({ json });
        if (!found) return;
        runId = found;
        args.onRunId?.(found);
      };

      const ensureStart = () => {
        if (started) return;
        started = true;
        writer.write({ type: "start" });
        writer.write({ type: "start-step" });
      };

      const ensureTextStart = () => {
        ensureStart();
        if (textStarted) return;
        textStarted = true;
        writer.write({ type: "text-start", id: textId });
      };

      const writeToolProgress = (p: HermesToolProgress) => {
        ensureStart();
        const toolName = toolNameFromProgress(p);
        const toolCallId = toolCallIdFromProgress(
          p,
          `hermes-tool-${++toolSeq}`,
        );
        const done = isToolProgressDone(p);
        const input = p.arguments ?? p.input ?? {};

        if (!openTools.has(toolCallId)) {
          openTools.add(toolCallId);
          writer.write({
            type: "tool-input-start",
            toolCallId,
            toolName,
            providerExecuted: true,
          });
          writer.write({
            type: "tool-input-available",
            toolCallId,
            toolName,
            input,
            providerExecuted: true,
          });
        }

        if (done) {
          writer.write({
            type: "tool-output-available",
            toolCallId,
            output: p.output ?? p.result ?? p.message ?? { status: "done" },
            providerExecuted: true,
          });
          openTools.delete(toolCallId);
        }
      };

      const reader = args.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          if (args.abortSignal?.aborted) {
            aborted = true;
            await reader.cancel("aborted");
            break;
          }
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { frames, rest } = consumeSseBuffer(buffer);
          buffer = rest;

          for (const frame of frames) {
            if (frame.data === "[DONE]") continue;

            if (frame.event === "hermes.tool.progress") {
              const progress = parseHermesToolProgress(frame.data);
              if (progress) {
                noteRunId(progress);
                writeToolProgress(progress);
              }
              continue;
            }

            const chunk = parseChatCompletionChunk(frame.data);
            if (!chunk) continue;
            noteRunId(chunk);
            if (chunk.id) {
              completionId = chunk.id;
              args.onCompletionId?.(chunk.id);
            }

            const delta = contentDeltaFromChunk(chunk);
            if (delta) {
              ensureTextStart();
              writer.write({
                type: "text-delta",
                id: textId,
                delta,
              });
            }
          }
        }

        // Flush any trailing complete frame without final blank line
        if (buffer.trim()) {
          const { frames } = consumeSseBuffer(buffer + "\n\n");
          for (const frame of frames) {
            if (frame.data === "[DONE]") continue;
            if (frame.event === "hermes.tool.progress") {
              const progress = parseHermesToolProgress(frame.data);
              if (progress) {
                noteRunId(progress);
                writeToolProgress(progress);
              }
              continue;
            }
            const chunk = parseChatCompletionChunk(frame.data);
            if (!chunk) continue;
            noteRunId(chunk);
            const delta = contentDeltaFromChunk(chunk);
            if (delta) {
              ensureTextStart();
              writer.write({ type: "text-delta", id: textId, delta });
            }
          }
        }

        if (aborted) {
          if (textStarted) {
            writer.write({ type: "text-end", id: textId });
          }
          if (started) {
            writer.write({ type: "finish-step" });
          }
          writer.write({ type: "abort" });
          args.onEnd?.({ completionId, runId, aborted: true });
          return;
        }

        if (!started) {
          // Empty successful stream — still emit a minimal assistant turn
          ensureStart();
          ensureTextStart();
        }
        if (textStarted) {
          writer.write({ type: "text-end", id: textId });
        }
        writer.write({ type: "finish-step" });
        writer.write({ type: "finish", finishReason: "stop" });
        args.onEnd?.({ completionId, runId, aborted: false });
      } catch (error) {
        if (args.abortSignal?.aborted) {
          aborted = true;
          writer.write({ type: "abort" });
          args.onEnd?.({ completionId, runId, aborted: true });
          return;
        }
        const message = onError(error);
        if (message) {
          writer.write({ type: "error", errorText: message });
        }
        args.onEnd?.({ completionId, runId, aborted: false });
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* ignore */
        }
      }
    },
    onError,
  });

  return createUIMessageStreamResponse({ stream });
}
