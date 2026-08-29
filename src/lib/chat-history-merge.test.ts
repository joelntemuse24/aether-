import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UIMessage } from "ai";
import {
  mergeStoredThreadWithIncoming,
  resolveChatMessages,
  uiMessagesFromFormatRepo,
} from "./chat-history-merge";

function user(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistant(id: string, text: string): UIMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

describe("mergeStoredThreadWithIncoming", () => {
  it("allows a single user message when stored history is empty", () => {
    const incoming = [user("u1", "Hello")];
    const result = mergeStoredThreadWithIncoming([], incoming);
    assert.equal(result.merged, false);
    assert.deepEqual(result.messages, incoming);
  });

  it("keeps incoming when it already contains the stored thread plus a new tail", () => {
    const stored = [user("u1", "A"), assistant("a1", "reply A")];
    const incoming = [...stored, user("u2", "B")];
    const result = mergeStoredThreadWithIncoming(stored, incoming);
    assert.equal(result.merged, false);
    assert.deepEqual(result.messages, incoming);
  });

  it("merges stored thread with a new user tail when incoming is shorter", () => {
    const stored = [user("u1", "A"), assistant("a1", "reply A")];
    const incoming = [user("u2", "B")];
    const result = mergeStoredThreadWithIncoming(stored, incoming);
    assert.equal(result.merged, true);
    assert.equal(result.messages.length, 3);
    assert.equal(result.messages[0]?.id, "u1");
    assert.equal(result.messages[1]?.id, "a1");
    assert.equal(result.messages[2]?.id, "u2");
  });

  it("merges when the stored tail is missing from a long incoming list", () => {
    const stored = [
      user("u1", "A"),
      assistant("a1", "reply A"),
      user("u2", "B"),
      assistant("a2", "reply B"),
    ];
    const incoming = [user("u1", "A"), user("u3", "C")];
    const result = mergeStoredThreadWithIncoming(stored, incoming);
    assert.equal(result.merged, true);
    assert.deepEqual(
      result.messages.map((m) => m.id),
      ["u1", "a1", "u2", "a2", "u3"],
    );
  });

  it("appends Continue onto stored history instead of replacing it", () => {
    const stored = [user("u1", "A"), assistant("a1", "partial")];
    const incoming = [user("cont", "Continue from where you left off.")];
    const result = mergeStoredThreadWithIncoming(stored, incoming);
    assert.equal(result.merged, true);
    assert.equal(result.messages.length, 3);
    assert.equal(result.messages[2]?.id, "cont");
  });

  it("prefers the incoming copy of a shared id (newer draft)", () => {
    const stored = [user("u1", "A"), assistant("a1", "part")];
    const incoming = [
      user("u1", "A"),
      assistant("a1", "part plus more"),
      user("u2", "B"),
    ];
    const result = mergeStoredThreadWithIncoming(stored, incoming);
    assert.equal(result.merged, false);
    const a1 = result.messages.find((m) => m.id === "a1");
    assert.ok(a1);
    const text = a1.parts.find((p) => p.type === "text");
    assert.equal(text && "text" in text ? text.text : "", "part plus more");
  });
});

describe("resolveChatMessages", () => {
  it("logs under_sent_history with id and lengths when merge happens", () => {
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const stored = [user("u1", "A"), assistant("a1", "reply A")];
    const incoming = [user("u2", "What number?")];
    const messages = resolveChatMessages({
      conversationId: "thread-17",
      incoming,
      stored,
      log: (event, details) => {
        events.push({ event, details });
      },
    });
    assert.equal(messages.length, 3);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.event, "under_sent_history");
    assert.deepEqual(events[0]?.details, {
      id: "thread-17",
      incoming: 1,
      stored: 2,
    });
  });

  it("does not log when incoming already has the stored thread", () => {
    const events: string[] = [];
    const stored = [user("u1", "A"), assistant("a1", "17")];
    const incoming = [...stored, user("u2", "What number?")];
    resolveChatMessages({
      conversationId: "thread-17",
      incoming,
      stored,
      log: (event) => {
        events.push(event);
      },
    });
    assert.deepEqual(events, []);
  });
});

describe("uiMessagesFromFormatRepo", () => {
  it("reads linear ai-sdk/v6 entries into UIMessage[]", () => {
    const messages = uiMessagesFromFormatRepo({
      entries: [
        {
          id: "u1",
          parent_id: null,
          format: "ai-sdk/v6",
          content: { role: "user", parts: [{ type: "text", text: "A" }] },
        },
        {
          id: "a1",
          parent_id: "u1",
          format: "ai-sdk/v6",
          content: { role: "assistant", parts: [{ type: "text", text: "17" }] },
        },
        {
          id: "skip",
          parent_id: "a1",
          format: "other",
          content: { role: "user", parts: [] },
        },
      ],
    });
    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.id, "u1");
    assert.equal(messages[1]?.role, "assistant");
  });
});
