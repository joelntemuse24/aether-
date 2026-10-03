import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  KNOWN_BUZZ_CHAT_MODELS,
  buzzAgentFamily,
  buzzModelFqn,
  buzzModelLabel,
  filterBuzzChatModelIds,
  hostedBuzzModelChoice,
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

  it("classifies Buzz ids as GPT or Claude", () => {
    assert.equal(buzzAgentFamily("buzz/gpt-5-6-luna"), "gpt");
    assert.equal(buzzAgentFamily("claude-sonnet-5"), "claude");
    assert.equal(buzzAgentFamily("gemini-2.5-pro"), null);
  });

  it("falls back to Luna when the requested id is unknown", () => {
    const models = ["gpt-5.6-luna", "claude-sonnet-5"].map(toBuzzChatModel);
    assert.equal(resolveBuzzModelId("nope", models), "gpt-5.6-luna");
    assert.equal(resolveBuzzModelId("claude-sonnet-5", models), "claude-sonnet-5");
  });

  it("accepts newly listed GPT-6.1 and Sonnet 5.5 ids and rejects unknown ones", () => {
    assert.equal(KNOWN_BUZZ_CHAT_MODELS.includes("gpt-6.1-sol"), true);
    assert.equal(KNOWN_BUZZ_CHAT_MODELS.includes("claude-sonnet-5-5"), true);
    const models = KNOWN_BUZZ_CHAT_MODELS.map(toBuzzChatModel);
    assert.equal(
      hostedBuzzModelChoice({ bodyModel: "gpt-6.1-sol", headerModel: "gpt-5.6-luna", models }),
      "gpt-6.1-sol",
    );
    assert.equal(
      hostedBuzzModelChoice({ bodyModel: "not-a-model", headerModel: "claude-sonnet-5-5", models }),
      "claude-sonnet-5-5",
    );
    assert.equal(
      hostedBuzzModelChoice({ bodyModel: "nope", headerModel: "also-nope", models }),
      "gpt-5.6-luna",
    );
    assert.equal(buzzModelLabel("gpt-6.1-sol"), "GPT-6.1 Sol");
    assert.equal(buzzModelLabel("claude-sonnet-5-5"), "Claude Sonnet 5.5");
  });

  it("routes Claude through the Anthropic provider name", () => {
    assert.equal(buzzModelFqn("gpt-5.6-luna"), "buzz/gpt-5-6-luna");
    assert.equal(buzzModelFqn("claude-sonnet-5"), "anthropic/claude-sonnet-5");
  });
});