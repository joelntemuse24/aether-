/**
 * Same-turn Aether tool loop on the hosted chat path.
 *
 * Hermes cannot take per-request custom tools. Aether therefore:
 * 1. Displays native host tool progress as today
 * 2. Executes Aether-owned tools when the model emits OpenAI tool_calls
 *    or [[aether_tool]] fences (or when a callback already ran — we skip)
 * 3. Feeds results back into another completions request on the same HTTP turn
 */

import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
} from "ai";
import { friendlyChatError } from "@/lib/chat-errors";
import { streamHermesChatCompletions } from "./client";
import type { HermesConfig } from "./config";
import type { OpenAIChatMessage } from "./messages";
import {
  consumeAetherToolFences,
  formatAetherToolResultsForModel,
  type ParsedAetherToolCall,
} from "./aether-tool-fence";
import {
  executeAetherTool,
  isAetherOwnedToolName,
  type AetherToolContext,
} from "./aether-tools";
import {
  accumulateToolCallDeltas,
  consumeSseBuffer,
  contentDeltaFromChunk,
  isToolProgressDone,
  parseChatCompletionChunk,
  parseHermesToolProgress,
  parsedToolCallArguments,
  toolCallIdFromProgress,
  toolNameFromProgress,
  type AccumulatedToolCall,
  type HermesToolProgress,
} from "./sse";
import { extractHermesRunId } from "./stop";

const MAX_AETHER_CONTINUES = 4;

export type HermesAetherLoopArgs = {
  config: HermesConfig;
  messages: OpenAIChatMessage[];
  model: string;
  provider?: string;
  sessionId: string | null;
  sessionKey: string;
  idempotencyKey?: string;
  abortSignal?: AbortSignal;
  aether: AetherToolContext;
  onRunId?: (id: string) => void;
  onCompletionId?: (id: string) => void;
  onError?: (error: unknown) => string;
  onEnd?: (info: {
    completionId?: string;
    aborted?: boolean;
    runId?: string;
  }) => void;
};

type PendingAetherCall = {
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
};

function parseAccumulatedCalls(
  acc: AccumulatedToolCall[],
): PendingAetherCall[] {
  const out: PendingAetherCall[] = [];
  for (const call of acc) {
    if (!call.name || !isAetherOwnedToolName(call.name)) continue;
    out.push({
      toolCallId: call.id || `aether-${call.name}`,
      name: call.name,
      arguments: parsedToolCallArguments(call.arguments),
    });
  }
  return out;
}

export function pendingCallsFromFences(
  calls: ParsedAetherToolCall[],
): PendingAetherCall[] {
  return calls
    .filter((c) => isAetherOwnedToolName(c.name))
    .map((c, i) => ({
      toolCallId: `aether-fence-${i}-${c.name}`,
      name: c.name,
      arguments: c.arguments,
    }));
}

export async function runHermesAetherToolLoop(
  args: HermesAetherLoopArgs,
): Promise<Response> {
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
      const executedAether = new Set<string>();
      let messages = args.messages;

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
          if (isAetherOwnedToolName(toolName)) {
            executedAether.add(`${toolName}:${JSON.stringify(input)}`);
          }
        }
      };

      const writeAetherExecution = (
        call: PendingAetherCall,
        output: unknown,
      ) => {
        ensureStart();
        writer.write({
          type: "tool-input-start",
          toolCallId: call.toolCallId,
          toolName: call.name,
          providerExecuted: true,
        });
        writer.write({
          type: "tool-input-available",
          toolCallId: call.toolCallId,
          toolName: call.name,
          input: call.arguments,
          providerExecuted: true,
        });
        writer.write({
          type: "tool-output-available",
          toolCallId: call.toolCallId,
          output,
          providerExecuted: true,
        });
      };

      const consumeUpstream = async (
        body: ReadableStream<Uint8Array>,
      ): Promise<{
        pending: PendingAetherCall[];
        assistantText: string;
      }> => {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fenceBuffer = "";
        let assistantText = "";
        let toolCalls: AccumulatedToolCall[] = [];
        const fenceCalls: ParsedAetherToolCall[] = [];

        const handleFrames = (frames: ReturnType<typeof consumeSseBuffer>["frames"]) => {
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
            toolCalls = accumulateToolCallDeltas(
              toolCalls,
              chunk.choices?.[0]?.delta?.tool_calls,
            );
            const delta = contentDeltaFromChunk(chunk);
            if (!delta) continue;
            fenceBuffer += delta;
            const scanned = consumeAetherToolFences(fenceBuffer);
            fenceBuffer = scanned.rest;
            fenceCalls.push(...scanned.calls);
            if (scanned.visible) {
              assistantText += scanned.visible;
              ensureTextStart();
              writer.write({
                type: "text-delta",
                id: textId,
                delta: scanned.visible,
              });
            }
          }
        };

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
            handleFrames(frames);
          }
          if (buffer.trim()) {
            const { frames } = consumeSseBuffer(buffer + "\n\n");
            handleFrames(frames);
          }
          if (fenceBuffer && !fenceBuffer.includes("[[aether_tool]]")) {
            assistantText += fenceBuffer;
            ensureTextStart();
            writer.write({
              type: "text-delta",
              id: textId,
              delta: fenceBuffer,
            });
          }
        } finally {
          try {
            reader.releaseLock();
          } catch {
            /* ignore */
          }
        }

        const fromTools = parseAccumulatedCalls(toolCalls).filter((call) => {
          const key = `${call.name}:${JSON.stringify(call.arguments)}`;
          return !executedAether.has(key);
        });
        const fromFences = pendingCallsFromFences(fenceCalls).filter((call) => {
          const key = `${call.name}:${JSON.stringify(call.arguments)}`;
          return !executedAether.has(key);
        });
        return { pending: [...fromTools, ...fromFences], assistantText };
      };

      try {
        for (let step = 0; step < MAX_AETHER_CONTINUES; step++) {
          const upstream = await streamHermesChatCompletions({
            config: args.config,
            body: {
              model: args.model,
              messages,
              stream: true,
              ...(args.provider ? { provider: args.provider } : {}),
            },
            sessionId: args.sessionId,
            sessionKey: args.sessionKey,
            idempotencyKey:
              step === 0
                ? args.idempotencyKey
                : args.idempotencyKey
                  ? `${args.idempotencyKey}:${step}`
                  : undefined,
            abortSignal: args.abortSignal,
          });

          noteRunId(extractHermesRunId({ headers: upstream.headers }));

          if (!upstream.ok || !upstream.body) {
            const detail = await upstream.text().catch(() => "");
            console.error(
              "[hermes] upstream error",
              upstream.status,
              detail.slice(0, 500),
            );
            const message = onError(new Error(`Hermes ${upstream.status}`));
            if (message) writer.write({ type: "error", errorText: message });
            args.onEnd?.({ completionId, runId, aborted: false });
            return;
          }

          const { pending, assistantText } = await consumeUpstream(upstream.body);
          if (aborted) break;
          if (pending.length === 0) break;

          const results: Array<{ name: string; output: unknown }> = [];
          for (const call of pending) {
            const output = await executeAetherTool({
              name: call.name,
              args: call.arguments,
              ctx: args.aether,
            });
            writeAetherExecution(call, output);
            executedAether.add(`${call.name}:${JSON.stringify(call.arguments)}`);
            results.push({ name: call.name, output });
          }

          messages = [
            ...messages,
            ...(assistantText.trim()
              ? [{ role: "assistant" as const, content: assistantText }]
              : []),
            {
              role: "user" as const,
              content: formatAetherToolResultsForModel(results),
            },
          ];
        }

        if (aborted) {
          if (textStarted) writer.write({ type: "text-end", id: textId });
          if (started) writer.write({ type: "finish-step" });
          writer.write({ type: "abort" });
          args.onEnd?.({ completionId, runId, aborted: true });
          return;
        }

        if (!started) {
          ensureStart();
          ensureTextStart();
        }
        if (textStarted) writer.write({ type: "text-end", id: textId });
        writer.write({ type: "finish-step" });
        writer.write({ type: "finish", finishReason: "stop" });
        args.onEnd?.({ completionId, runId, aborted: false });
      } catch (error) {
        if (args.abortSignal?.aborted) {
          writer.write({ type: "abort" });
          args.onEnd?.({ completionId, runId, aborted: true });
          return;
        }
        const message = onError(error);
        if (message) writer.write({ type: "error", errorText: message });
        args.onEnd?.({ completionId, runId, aborted: false });
      }
    },
    onError,
  });

  return createUIMessageStreamResponse({ stream });
}
