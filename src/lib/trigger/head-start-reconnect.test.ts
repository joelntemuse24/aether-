import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UIMessage, UIMessageChunk } from "ai";
import {
  HEAD_START_LIVE_INPUT_SEQ,
  armLiveDurableSession,
  describeHeadStartChunk,
  followHeadStartOnRealtime,
  headStartChunksHaveOpenTools,
  headStartChunksLookFinished,
  shouldFollowHeadStartOnRealtime,
  skipAlreadyDeliveredChunks,
  wrapDurableChatTransport,
  type DurableChatTransportLike,
  type DurableSessionSnapshot,
} from "./head-start-reconnect";

function streamOf<T>(chunks: T[]): ReadableStream<T> {
  return new ReadableStream<T>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function collect<T>(stream: ReadableStream<T>): Promise<T[]> {
  const out: T[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) return out;
    out.push(value);
  }
}

describe("head-start live follow", () => {
  it("follows when tools are still open or step 1 never finished", () => {
    const open = [
      describeHeadStartChunk({ type: "tool-input-available", toolCallId: "c1" }),
    ];
    assert.equal(headStartChunksHaveOpenTools(open), true);
    assert.equal(headStartChunksLookFinished(open), false);
    assert.equal(
      shouldFollowHeadStartOnRealtime({
        aborted: false,
        hasSession: true,
        chunks: open,
      }),
      true,
    );
    assert.equal(
      shouldFollowHeadStartOnRealtime({
        aborted: true,
        hasSession: true,
        chunks: open,
      }),
      false,
    );
    assert.equal(
      shouldFollowHeadStartOnRealtime({
        aborted: false,
        hasSession: true,
        chunks: [describeHeadStartChunk({ type: "start" })],
      }),
      true,
    );
  });

  it("does not follow a finished text turn or a user Stop", () => {
    const done = [
      describeHeadStartChunk({ type: "text-delta" }),
      describeHeadStartChunk({ type: "text-end" }),
      describeHeadStartChunk({ type: "finish" }),
    ];
    assert.equal(headStartChunksLookFinished(done), true);
    assert.equal(
      shouldFollowHeadStartOnRealtime({
        aborted: false,
        hasSession: true,
        chunks: done,
      }),
      false,
    );
  });

  it("does not peek-settled when arming a live session after Head Start flush", () => {
    let stored: DurableSessionSnapshot | undefined = {
      publicAccessToken: "pat",
      isStreaming: false,
    };
    const transport: DurableChatTransportLike = {
      sendMessages: async () => streamOf([]),
      reconnectToStream: async () => null,
      getSession: () => stored,
      setSession: (_id, session) => {
        stored = session;
      },
    };
    const armed = armLiveDurableSession(transport, "chat-1");
    assert.equal(armed?.isStreaming, true);
    assert.equal(armed?.activeInputSeq, HEAD_START_LIVE_INPUT_SEQ);
    assert.equal(stored?.isStreaming, true);
  });

  it("skips chunks the Head Start SSE already delivered", async () => {
    const out = await collect(
      streamOf(["a", "b", "c", "d"]).pipeThrough(skipAlreadyDeliveredChunks(2)),
    );
    assert.deepEqual(out, ["c", "d"]);
  });

  it("stitches session.out after Head Start ends with open tools", async () => {
    let session: DurableSessionSnapshot | undefined;
    let reconnects = 0;
    const transport: DurableChatTransportLike = {
      sendMessages: async () => {
        session = { publicAccessToken: "pat", isStreaming: false };
        return streamOf<UIMessageChunk>([
          { type: "start", messageId: "m1" } as UIMessageChunk,
          {
            type: "tool-input-available",
            toolCallId: "c1",
          } as UIMessageChunk,
        ]);
      },
      reconnectToStream: async () => {
        reconnects += 1;
        assert.equal(session?.isStreaming, true);
        assert.equal(session?.activeInputSeq, HEAD_START_LIVE_INPUT_SEQ);
        return streamOf<UIMessageChunk>([
          { type: "start", messageId: "m1" } as UIMessageChunk,
          {
            type: "tool-input-available",
            toolCallId: "c1",
          } as UIMessageChunk,
          {
            type: "tool-output-available",
            toolCallId: "c1",
            output: { ok: true },
          } as UIMessageChunk,
          { type: "text-delta", id: "t1", delta: " done" } as UIMessageChunk,
        ]);
      },
      getSession: () => session,
      setSession: (_id, next) => {
        session = { ...next };
      },
    };

    const wrapped = wrapDurableChatTransport(transport);
    const first = await wrapped.sendMessages({
      chatId: "cb94ad27-c835-4740-9c38-1c97f3764a65",
      messageId: undefined,
      messages: [] as UIMessage[],
      abortSignal: undefined,
      trigger: "submit-message",
    });
    const chunks = await collect(first);
    assert.equal(reconnects, 1);
    assert.equal(chunks.length, 4);
    assert.equal(
      chunks.filter((c) => (c as { type?: string }).type === "tool-input-available")
        .length,
      1,
    );
    assert.equal(
      (chunks.at(-1) as { type?: string; delta?: string }).delta,
      " done",
    );
  });

  it("does not reconnect later turns that already have a session", async () => {
    const session: DurableSessionSnapshot = {
      publicAccessToken: "pat",
      isStreaming: true,
      activeInputSeq: 4,
    };
    let reconnects = 0;
    const transport: DurableChatTransportLike = {
      sendMessages: async () =>
        streamOf<UIMessageChunk>([{ type: "finish" } as UIMessageChunk]),
      reconnectToStream: async () => {
        reconnects += 1;
        return streamOf([]);
      },
      getSession: () => session,
      setSession: () => {},
    };
    const wrapped = wrapDurableChatTransport(transport);
    await collect(
      await wrapped.sendMessages({
        chatId: "chat-2",
        messageId: undefined,
        messages: [] as UIMessage[],
        abortSignal: undefined,
        trigger: "submit-message",
      }),
    );
    assert.equal(reconnects, 0);
  });

  it("does not follow after a user Stop", async () => {
    const session: DurableSessionSnapshot = {
      publicAccessToken: "pat",
      isStreaming: true,
    };
    let reconnects = 0;
    const abort = new AbortController();
    abort.abort();
    const transport: DurableChatTransportLike = {
      sendMessages: async () =>
        streamOf<UIMessageChunk>([
          {
            type: "tool-input-available",
            toolCallId: "c1",
          } as UIMessageChunk,
        ]),
      reconnectToStream: async () => {
        reconnects += 1;
        return streamOf([]);
      },
      getSession: () => session,
      setSession: () => {},
    };
    const stream = followHeadStartOnRealtime(
      transport,
      { chatId: "chat-3", abortSignal: abort.signal },
      await transport.sendMessages({
        chatId: "chat-3",
        messageId: undefined,
        messages: [] as UIMessage[],
        abortSignal: abort.signal,
        trigger: "submit-message",
      }),
    );
    await collect(stream);
    assert.equal(reconnects, 0);
  });
});
