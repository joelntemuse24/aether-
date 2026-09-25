import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buzzModelFqn,
  buzzModelLabel,
  filterBuzzChatModelIds,
  resolveBuzzModelId,
  toBuzzChatModel,
} from "./models";

describe("Buzz chat models", () => {
  it("names the live catalog and drops image models", () => {
    assert.equal(buzzModelLabel("gpt-5.6-luna"), "GPT-5.6 Luna");
    assert.equal(buzzModelLabel("claude-sonnet-4-5-20250929"), "Claude Sonnet 4.5");
    assert.equal(buzzModelLabel("claude-opus-5-5"), "Claude Opus 5.5");
    assert.deepEqual(
      filterBuzzChatModelIds(["gpt-image-1", "gpt-5.6-sol", "claude-sonnet-5", "whisper-1"]),
      ["claude-sonnet-5", "gpt-5.6-sol"],
    );
  });

  it("falls back to Luna when the requested id is unknown", () => {
    const models = ["gpt-5.6-luna", "claude-sonnet-5"].map(toBuzzChatModel);
    assert.equal(resolveBuzzModelId("nope", models), "gpt-5.6-luna");
    assert.equal(resolveBuzzModelId("claude-sonnet-5", models), "claude-sonnet-5");
  });

  it("routes Claude through the Anthropic provider name", () => {
    assert.equal(buzzModelFqn("gpt-5.6-luna"), "buzz/gpt-5-6-luna");
    assert.equal(buzzModelFqn("claude-sonnet-5"), "anthropic/claude-sonnet-5");
  });
});