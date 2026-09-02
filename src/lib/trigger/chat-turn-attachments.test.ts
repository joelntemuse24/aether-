import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelMessage, UIMessage } from "ai";
import {
  enrichMessagesWithAttachments,
  enrichModelMessagesWithAttachments,
  lastUserText,
  lastUserTextFromModelMessages,
} from "../chat-turn";

describe("chat-turn attachments", () => {
  it("injects image parts into the last user UI message", () => {
    const messages: UIMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "look at this" }],
      },
    ];
    const next = enrichMessagesWithAttachments(messages, [
      { name: "shot.png", mime: "image/png", dataUrl: "data:image/png;base64,aaa" },
    ]);
    const parts = next[0].parts;
    assert.equal(parts.some((p) => p.type === "file"), true);
    assert.equal(lastUserText(next), "look at this");
  });

  it("injects image parts into last user model messages for the durable agent", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "look at this" },
    ];
    const next = enrichModelMessagesWithAttachments(
      messages,
      [{ name: "shot.png", mime: "image/png", dataUrl: "data:image/png;base64,aaa" }],
      "notes:\n",
    );
    const content = next[0].content;
    assert.equal(Array.isArray(content), true);
    if (!Array.isArray(content)) return;
    assert.equal(
      content.some((p) => p.type === "text" && p.text.startsWith("notes:")),
      true,
    );
    assert.equal(content.some((p) => p.type === "image"), true);
    assert.equal(lastUserTextFromModelMessages(next).startsWith("notes:"), true);
  });
});
