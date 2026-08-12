import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UIMessage } from "ai";
import { toOpenAIChatMessages } from "./messages";

describe("toOpenAIChatMessages", () => {
  it("prepends system and maps text parts", () => {
    const messages = [
      {
        id: "1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
      {
        id: "2",
        role: "assistant",
        parts: [
          { type: "text", text: "Hi" },
          { type: "tool-web_search", toolCallId: "t1", state: "output-available" },
        ],
      },
    ] as unknown as UIMessage[];

    const out = toOpenAIChatMessages(messages, "Be helpful");
    assert.deepEqual(out, [
      { role: "system", content: "Be helpful" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi" },
    ]);
  });

  it("maps image file parts to multimodal content", () => {
    const messages = [
      {
        id: "1",
        role: "user",
        parts: [
          { type: "text", text: "What is this?" },
          {
            type: "file",
            url: "data:image/png;base64,aaa",
            mediaType: "image/png",
          },
        ],
      },
    ] as unknown as UIMessage[];

    const out = toOpenAIChatMessages(messages);
    assert.equal(out.length, 1);
    assert.equal(out[0].role, "user");
    assert.ok(Array.isArray(out[0].content));
    const parts = out[0].content as Array<Record<string, unknown>>;
    assert.equal(parts[0].type, "text");
    assert.equal(parts[1].type, "image_url");
  });
});
