import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { UIMessage } from "ai";
import { CONTINUE_USER_TEXT } from "./chat-continue";
import {
  buildChatSendBody,
  hydrateThreadMessages,
  shouldBlockSend,
  shouldCopyDraftToRemoteId,
  shouldPersistTranscriptImmediately,
} from "./chat-transcript";

function user(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistant(id: string, text: string): UIMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

function toolWithOutput(id: string): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [
      {
        type: "tool-web_search",
        toolCallId: "t1",
        output: { hits: 1 },
      } as UIMessage["parts"][number],
    ],
  };
}

function installLocalStorage() {
  const map = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
  const globalWithWindow = globalThis as typeof globalThis & {
    window?: {
      localStorage: typeof localStorage;
      dispatchEvent: (event?: Event) => boolean;
    };
  };
  const previous = globalWithWindow.window;
  globalWithWindow.window = {
    localStorage,
    dispatchEvent: () => true,
  };
  return () => {
    if (previous === undefined) {
      delete globalWithWindow.window;
    } else {
      globalWithWindow.window = previous;
    }
  };
}

describe("chat transcript client helpers", () => {
  it("blocks send until history is ready or live caught up with stored", () => {
    assert.equal(
      shouldBlockSend({ historyReady: false, storedCount: 2, liveCount: 0 }),
      true,
    );
    assert.equal(
      shouldBlockSend({ historyReady: true, storedCount: 2, liveCount: 0 }),
      true,
    );
    assert.equal(
      shouldBlockSend({ historyReady: true, storedCount: 2, liveCount: 2 }),
      false,
    );
    assert.equal(
      shouldBlockSend({ historyReady: true, storedCount: 0, liveCount: 0 }),
      false,
    );
  });

  it("copies an optimistic draft when remoteId first appears", () => {
    assert.equal(
      shouldCopyDraftToRemoteId({
        previousKey: undefined,
        nextKey: "c1",
        liveCount: 1,
      }),
      true,
    );
    assert.equal(
      shouldCopyDraftToRemoteId({
        previousKey: "c1",
        nextKey: "c1",
        liveCount: 1,
      }),
      false,
    );
  });

  it("persists immediately on user append, tool result, abort/ready, and error", () => {
    assert.equal(
      shouldPersistTranscriptImmediately({
        last: user("u1", "A"),
        status: "submitted",
      }),
      true,
    );
    assert.equal(
      shouldPersistTranscriptImmediately({
        last: toolWithOutput("a1"),
        status: "streaming",
      }),
      true,
    );
    assert.equal(
      shouldPersistTranscriptImmediately({
        last: assistant("a1", "cut off"),
        status: "ready",
      }),
      true,
    );
    assert.equal(
      shouldPersistTranscriptImmediately({
        last: assistant("a1", "err"),
        status: "error",
      }),
      true,
    );
    assert.equal(
      shouldPersistTranscriptImmediately({
        last: assistant("a1", "token"),
        status: "streaming",
      }),
      false,
    );
  });
});

describe("transcript persist / reload / switch / continue", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("second POST after reload includes conversationId, A, assistant reply, and B", async () => {
    restore = installLocalStorage();
    const { persistThreadUIMessages, loadThreadUIMessages } = await import(
      "./local-thread-adapter"
    );
    const id = "thread-reload";
    persistThreadUIMessages(id, [
      user("u1", "My favourite number is 17."),
      assistant("a1", "Got it — 17."),
    ]);

    const reloaded = loadThreadUIMessages(id);
    const body = buildChatSendBody({
      conversationId: id,
      stored: reloaded,
      live: [user("u2", "What number?")],
    });

    assert.equal(body.conversationId, id);
    assert.deepEqual(
      body.messages.map((m) => m.id),
      ["u1", "a1", "u2"],
    );
  });

  it("sidebar switch away and back loads B from B's store, then A + B-turn on return", async () => {
    restore = installLocalStorage();
    const { persistThreadUIMessages, loadThreadUIMessages } = await import(
      "./local-thread-adapter"
    );
    persistThreadUIMessages("thread-a", [
      user("ua", "Favourite number is 17."),
      assistant("aa", "17"),
    ]);
    persistThreadUIMessages("thread-b", [
      user("ub", "Talking about cats"),
      assistant("ab", "meow"),
    ]);

    const liveFromA = loadThreadUIMessages("thread-a");
    const afterSwitch = hydrateThreadMessages({
      previousKey: "thread-a",
      nextKey: "thread-b",
      live: liveFromA,
      stored: loadThreadUIMessages("thread-b"),
    });
    assert.deepEqual(
      afterSwitch.map((m) => m.id),
      ["ub", "ab"],
    );

    const backToA = hydrateThreadMessages({
      previousKey: "thread-b",
      nextKey: "thread-a",
      live: afterSwitch,
      stored: loadThreadUIMessages("thread-a"),
    });
    const body = buildChatSendBody({
      conversationId: "thread-a",
      stored: backToA,
      live: [user("u2", "What number?")],
    });
    assert.equal(body.conversationId, "thread-a");
    assert.deepEqual(
      body.messages.map((m) => m.id),
      ["ua", "aa", "u2"],
    );
  });

  it("Continue POST body is full history plus CONTINUE_USER_TEXT", async () => {
    restore = installLocalStorage();
    const { persistThreadUIMessages, loadThreadUIMessages } = await import(
      "./local-thread-adapter"
    );
    persistThreadUIMessages("thread-cont", [
      user("u1", "Write a long answer"),
      assistant("a1", "Partial..."),
    ]);
    const stored = loadThreadUIMessages("thread-cont");
    const body = buildChatSendBody({
      conversationId: "thread-cont",
      stored,
      live: [user("cont", CONTINUE_USER_TEXT)],
    });
    assert.equal(body.conversationId, "thread-cont");
    assert.equal(body.messages.length, 3);
    assert.equal(body.messages[0]?.id, "u1");
    assert.equal(body.messages[1]?.id, "a1");
    assert.equal(body.messages[2]?.id, "cont");
    const lastText = body.messages[2]?.parts.find((p) => p.type === "text");
    assert.equal(
      lastText && "text" in lastText ? lastText.text : "",
      CONTINUE_USER_TEXT,
    );
  });

  it("local persist is synchronous — load after persist sees the full array", async () => {
    restore = installLocalStorage();
    const { persistThreadUIMessages, loadThreadUIMessages } = await import(
      "./local-thread-adapter"
    );
    persistThreadUIMessages("sync-id", [
      user("u1", "A"),
      assistant("a1", "ok"),
    ]);
    assert.deepEqual(
      loadThreadUIMessages("sync-id").map((m) => m.id),
      ["u1", "a1"],
    );
  });
});
