import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { UIMessage } from "ai";
import {
  clearFirstSendDraft,
  mergeSeedWithDraft,
  rememberLiveTurn,
  stashFirstSendDraft,
} from "./chat-turn-draft";

function user(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistant(id: string, text: string): UIMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

afterEach(() => {
  clearFirstSendDraft();
});

describe("first-send remount keeps the live turn visible", () => {
  it("seeds initialize remount with the assistant, not only the stashed user bubble", () => {
    const liveUser = user("u-live", "Hey, are you still there?");
    const liveAssistant = assistant("a-live", "Yes — still here.");
    stashFirstSendDraft({
      keys: ["__LOCALID_abc"],
      messages: [user("u-stash", "Hey, are you still there?")],
    });
    rememberLiveTurn({
      keys: ["durable-chat-id"],
      messages: [liveUser, liveAssistant],
    });

    const remounted = mergeSeedWithDraft("brand-new-after-initialize", [
      user("u-stash", "Hey, are you still there?"),
    ]);
    assert.equal(remounted.some((m) => m.role === "assistant"), true);
    const text = remounted
      .find((m) => m.role === "assistant")
      ?.parts.find((p) => p.type === "text");
    assert.equal(text && "text" in text ? text.text : "", "Yes — still here.");
    assert.equal(remounted.filter((m) => m.role === "user").length, 1);
  });

  it("does not duplicate the user turn when stash and live ids differ", () => {
    stashFirstSendDraft({
      keys: ["__LOCALID_abc", "durable-chat-id"],
      messages: [
        user("u-chat", "Hey, are you still there?"),
        assistant("a-live", "Yes — still here."),
      ],
    });
    const remounted = mergeSeedWithDraft("durable-chat-id", [
      user("u-stash", "Hey, are you still there?"),
    ]);
    assert.equal(remounted.length, 2);
    assert.equal(remounted[0]?.role, "user");
    assert.equal(remounted[1]?.role, "assistant");
  });
});
