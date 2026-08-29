import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { UIMessage } from "ai";
import { CONTINUE_USER_TEXT } from "./chat-continue";
import {
  messagesAfterThreadSwitch,
  prepareContinueOutgoingMessages,
  prepareOutgoingChatMessages,
  shouldBlockSend,
  shouldCopyDraftToRemoteId,
} from "./chat-transcript";

function user(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistant(id: string, text: string): UIMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
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
    window?: { localStorage: typeof localStorage; dispatchEvent: (event?: Event) => boolean };
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
});

describe("transcript persist / reload / switch / continue", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("second POST after reload includes A, assistant reply, and B", async () => {
    restore = installLocalStorage();
    const { persistThreadUIMessages, loadThreadUIMessages } = await import(
      "./local-thread-adapter"
    );
    const id = "thread-reload";
    const storedTurn = [
      user("u1", "My favourite number is 17."),
      assistant("a1", "Got it — 17."),
    ];
    persistThreadUIMessages(id, storedTurn);

    const reloaded = loadThreadUIMessages(id);
    const outgoing = prepareOutgoingChatMessages({
      stored: reloaded,
      // Simulate the buggy client that only sends the new user turn.
      live: [user("u2", "What number?")],
    });

    assert.equal(outgoing.length, 3);
    assert.equal(outgoing[0]?.id, "u1");
    assert.equal(outgoing[1]?.id, "a1");
    assert.equal(outgoing[2]?.id, "u2");
  });

  it("sidebar switch away and back loads B from B's store, not A", async () => {
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
    const storedB = loadThreadUIMessages("thread-b");
    const afterSwitch = messagesAfterThreadSwitch({
      previousKey: "thread-a",
      nextKey: "thread-b",
      live: liveFromA,
      storedNext: storedB,
    });
    assert.deepEqual(
      afterSwitch.map((m) => m.id),
      ["ub", "ab"],
    );

    const backToA = messagesAfterThreadSwitch({
      previousKey: "thread-b",
      nextKey: "thread-a",
      live: afterSwitch,
      storedNext: loadThreadUIMessages("thread-a"),
    });
    const outgoing = prepareOutgoingChatMessages({
      stored: backToA,
      live: [...backToA, user("u2", "What number?")],
    });
    assert.equal(outgoing.length, 3);
    assert.equal(outgoing[0]?.id, "ua");
    assert.equal(outgoing[1]?.id, "aa");
    assert.equal(outgoing[2]?.id, "u2");
  });

  it("Continue resends full history, not only CONTINUE_USER_TEXT", async () => {
    restore = installLocalStorage();
    const { persistThreadUIMessages, loadThreadUIMessages } = await import(
      "./local-thread-adapter"
    );
    persistThreadUIMessages("thread-cont", [
      user("u1", "Write a long answer"),
      assistant("a1", "Partial..."),
    ]);
    const stored = loadThreadUIMessages("thread-cont");
    const outgoing = prepareContinueOutgoingMessages(
      stored,
      user("cont", CONTINUE_USER_TEXT),
    );
    assert.equal(outgoing.length, 3);
    assert.equal(outgoing[0]?.id, "u1");
    assert.equal(outgoing[1]?.id, "a1");
    assert.equal(outgoing[2]?.id, "cont");
    const lastText = outgoing[2]?.parts.find((p) => p.type === "text");
    assert.equal(
      lastText && "text" in lastText ? lastText.text : "",
      CONTINUE_USER_TEXT,
    );
  });
});
