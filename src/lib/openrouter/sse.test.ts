import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { textFromOpenRouterSse } from "./sse";

describe("OpenRouter SSE", () => {
  it("reads content deltas and ignores the done marker", () => {
    const chunk = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      "",
      'data: {"choices":[{"delta":{"content":" there"}}]}',
      "data: [DONE]",
    ].join("\n");
    assert.equal(textFromOpenRouterSse(chunk), "Hello there");
  });
});
