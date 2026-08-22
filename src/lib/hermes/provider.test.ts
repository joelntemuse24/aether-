import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveHermesModelRequest } from "./provider";

describe("resolveHermesModelRequest", () => {
  it("sends openrouter with the picker model for hosted Cloud", () => {
    assert.deepEqual(
      resolveHermesModelRequest({
        requestedModel: "openai/gpt-4o",
        accessMode: "hosted",
        env: {},
      }),
      { model: "openai/gpt-4o", provider: "openrouter" },
    );
  });

  it("honors HERMES_PROVIDER override", () => {
    assert.deepEqual(
      resolveHermesModelRequest({
        requestedModel: "claude-sonnet-4",
        accessMode: "hosted",
        env: { HERMES_PROVIDER: "anthropic" },
      }),
      { model: "claude-sonnet-4", provider: "anthropic" },
    );
  });

  it("passes through a known BYOK provider", () => {
    assert.deepEqual(
      resolveHermesModelRequest({
        requestedModel: "gpt-4o",
        accessMode: "byok",
        byokProvider: "openai",
        env: {},
      }),
      { model: "gpt-4o", provider: "openai" },
    );
  });

  it("omits provider for custom BYOK so we do not invent a slug", () => {
    assert.deepEqual(
      resolveHermesModelRequest({
        requestedModel: "my-local",
        accessMode: "byok",
        byokProvider: "custom",
        env: {},
      }),
      { model: "my-local" },
    );
  });
});
