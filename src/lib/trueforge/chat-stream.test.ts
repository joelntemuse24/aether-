import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldFailoverTrueForgeTurn } from "./chat-stream";

describe("TrueForge model failover", () => {
  it("retries OpenRouter only when the primary failed before any output", () => {
    assert.equal(
      shouldFailoverTrueForgeTurn({
        failedBeforeOutput: true,
        fallback: "openrouter/gpt-5-6-luna",
        usedFallback: false,
      }),
      true,
    );
    assert.equal(
      shouldFailoverTrueForgeTurn({
        failedBeforeOutput: false,
        fallback: "openrouter/gpt-5-6-luna",
        usedFallback: false,
      }),
      false,
    );
    assert.equal(
      shouldFailoverTrueForgeTurn({
        failedBeforeOutput: true,
        fallback: null,
        usedFallback: false,
      }),
      false,
    );
  });
});
