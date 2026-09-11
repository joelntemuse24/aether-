import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import { isAbortError } from "@/lib/chat-continue";

/**
 * After the first-turn Head Start SSE ends, the SDK sets `isStreaming=false`
 * (`clearStreaming` on flush) even when the durable agent is still executing
 * tools on `session.out`. `reconnectToStream()` then no-ops.
 *
 * Head Start also never sets `activeInputSeq`, so a naive reconnect sends
 * `X-Peek-Settled` and can close before the first post-handover chunk.
 *
 * Follow the live session instead of treating the 60s Vercel stitch as the
 * end of the turn. Skip chunks the browser already applied so we don't
 * replay step 1.
 */

/** Dummy `.in` seq so reconnect does not peek-settled while the worker is live. */
export const HEAD_START_LIVE_INPUT_SEQ = 1;

export type HeadStartStreamChunk = {
  type?: string;
  toolCallId?: string;
};

export type DurableSessionSnapshot = {
  publicAccessToken: string;
  lastEventId?: string;
  activeInputSeq?: number;
  isStreaming?: boolean;
};

type ReconnectOptions = {
  chatId: string;
  abortSignal?: AbortSignal;
  stopOnAbort?: boolean;
};

export type DurableChatTransportLike = {
  sendMessages: ChatTransport<UIMessage>["sendMessages"];
  reconnectToStream: (
    options: ReconnectOptions,
  ) => ReturnType<ChatTransport<UIMessage>["reconnectToStream"]>;
  getSession?: (chatId: string) => DurableSessionSnapshot | undefined;
  setSession?: (chatId: string, session: DurableSessionSnapshot) => void;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function describeHeadStartChunk(
  chunk: unknown,
): HeadStartStreamChunk {
  const rec = asRecord(chunk);
  const type = typeof rec.type === "string" ? rec.type : undefined;
  const toolCallId =
    typeof rec.toolCallId === "string"
      ? rec.toolCallId
      : typeof rec.id === "string" && type?.startsWith("tool-")
        ? rec.id
        : undefined;
  return { type, toolCallId };
}

export function headStartChunksHaveOpenTools(
  chunks: readonly HeadStartStreamChunk[],
): boolean {
  const open = new Set<string>();
  let anonymous = 0;
  for (const chunk of chunks) {
    const type = chunk.type ?? "";
    const id = chunk.toolCallId ?? "";
    const opens =
      type === "tool-input-start" ||
      type === "tool-input-delta" ||
      type === "tool-input-available" ||
      type === "tool-call";
    const closes =
      type === "tool-output-available" ||
      type === "tool-output-error" ||
      type === "tool-result";
    if (opens) {
      if (id) open.add(id);
      else if (type !== "tool-input-delta") anonymous += 1;
    }
    if (closes) {
      if (id) open.delete(id);
      else if (anonymous > 0) anonymous -= 1;
    }
  }
  return open.size > 0 || anonymous > 0;
}

export function headStartChunksLookFinished(
  chunks: readonly HeadStartStreamChunk[],
): boolean {
  if (headStartChunksHaveOpenTools(chunks)) return false;
  return chunks.some((chunk) => {
    const type = chunk.type ?? "";
    return type === "finish" || type === "text-end" || type === "finish-step";
  });
}

export function shouldFollowHeadStartOnRealtime(input: {
  aborted: boolean;
  hasSession: boolean;
  chunks: readonly HeadStartStreamChunk[];
}): boolean {
  if (input.aborted || !input.hasSession) return false;
  if (headStartChunksHaveOpenTools(input.chunks)) return true;
  // Killed during thinking / before step 1 finished — parked agent may
  // still take the turn after handover.
  return !headStartChunksLookFinished(input.chunks);
}

export function armLiveDurableSession(
  transport: DurableChatTransportLike,
  chatId: string,
): DurableSessionSnapshot | null {
  const session = transport.getSession?.(chatId);
  if (!session?.publicAccessToken) return null;
  const next: DurableSessionSnapshot = {
    ...session,
    isStreaming: true,
    activeInputSeq: session.activeInputSeq ?? HEAD_START_LIVE_INPUT_SEQ,
  };
  transport.setSession?.(chatId, next);
  return next;
}

export async function reconnectLiveDurableStream(
  transport: DurableChatTransportLike,
  options: {
    chatId: string;
    abortSignal?: AbortSignal;
  },
): Promise<ReadableStream<UIMessageChunk> | null> {
  if (!armLiveDurableSession(transport, options.chatId)) return null;
  return transport.reconnectToStream({
    chatId: options.chatId,
    abortSignal: options.abortSignal,
    stopOnAbort: true,
  });
}

export function skipAlreadyDeliveredChunks<T>(
  deliveredCount: number,
): TransformStream<T, T> {
  let skipped = 0;
  return new TransformStream<T, T>({
    transform(chunk, controller) {
      if (skipped < deliveredCount) {
        skipped += 1;
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

async function pipeStream<T>(
  stream: ReadableStream<T>,
  controller: ReadableStreamDefaultController<T>,
  onChunk?: (chunk: T) => void,
): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      onChunk?.(value);
      controller.enqueue(value);
    }
  } finally {
    reader.releaseLock();
  }
}

export function followHeadStartOnRealtime(
  transport: DurableChatTransportLike,
  options: {
    chatId: string;
    abortSignal?: AbortSignal;
  },
  headStartStream: ReadableStream<UIMessageChunk>,
): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    async start(controller) {
      const chunks: HeadStartStreamChunk[] = [];
      let delivered = 0;
      let aborted = false;
      let headStartError: unknown;

      try {
        await pipeStream(headStartStream, controller, (chunk) => {
          delivered += 1;
          chunks.push(describeHeadStartChunk(chunk));
        });
      } catch (error) {
        if (options.abortSignal?.aborted || isAbortError(error)) {
          aborted = true;
        } else {
          headStartError = error;
        }
      }

      if (options.abortSignal?.aborted) aborted = true;

      const hasSession = Boolean(
        transport.getSession?.(options.chatId)?.publicAccessToken,
      );
      const follow = shouldFollowHeadStartOnRealtime({
        aborted,
        hasSession,
        chunks,
      });

      if (!follow) {
        if (headStartError && !aborted) {
          controller.error(headStartError);
          return;
        }
        controller.close();
        return;
      }

      const live = await reconnectLiveDurableStream(transport, options).catch(
        () => null,
      );
      if (!live) {
        if (headStartError && !aborted) {
          controller.error(headStartError);
          return;
        }
        controller.close();
        return;
      }

      try {
        const trimmed =
          delivered > 0 ? live.pipeThrough(skipAlreadyDeliveredChunks(delivered)) : live;
        await pipeStream(trimmed, controller);
        controller.close();
      } catch (error) {
        if (options.abortSignal?.aborted || isAbortError(error)) {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          return;
        }
        controller.error(error);
      }
    },
    cancel(reason) {
      return headStartStream.cancel(reason);
    },
  });
}

export function wrapDurableChatTransport(
  transport: DurableChatTransportLike,
): ChatTransport<UIMessage> {
  return {
    sendMessages: async (options) => {
      const chatId = options.chatId;
      const hadSession = Boolean(transport.getSession?.(chatId)?.publicAccessToken);
      const stream = await transport.sendMessages(options);
      // Later turns already subscribe to session.out with EOF resubscribe.
      if (hadSession) return stream;
      if (!transport.getSession?.(chatId)?.publicAccessToken) return stream;
      return followHeadStartOnRealtime(transport, options, stream);
    },
    reconnectToStream: (options) => transport.reconnectToStream(options),
  };
}
