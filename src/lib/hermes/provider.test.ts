import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HERMES_HOSTED_BUZZ_PROVIDER,
  resolveHermesModelRequest,
} from "./provider";

describe("resolveHermesModelRequest", () => {
  it("routes hosted ChatGPT picker ids to the Buzz custom provider slug", () => {
    assert.deepEqual(
      resolveHermesModelRequest({
        requestedModel: "openai/gpt-4o",
        accessMode: "hosted",
        env: {},
      }),
      { model: "openai/gpt-4o", provider: HERMES_HOSTED_BUZZ_PROVIDER },
    );
    assert.deepEqual(
      resolveHermesModelRequest({
        requestedModel: "gpt-4o",
        accessMode: "hosted",
        env: {},
      }),
      { model: "gpt-4o", provider: HERMES_HOSTED_BUZZ_PROVIDER },
    );
    assert.deepEqual(
      resolveHermesModelRequest({
        requestedModel: "o3",
        accessMode: "hosted",
        env: {},
      }),
      { model: "o3", provider: HERMES_HOSTED_BUZZ_PROVIDER },
    );
  });

  it("routes hosted Claude picker ids to the Buzz custom provider slug", () => {
    assert.deepEqual(
      resolveHermesModelRequest({
        requestedModel: "anthropic/claude-sonnet-4",
        accessMode: "hosted",
        env: {},
      }),
      {
        model: "anthropic/claude-sonnet-4",
        provider: HERMES_HOSTED_BUZZ_PROVIDER,
      },
    );
    assert.deepEqual(
      resolveHermesModelRequest({
        requestedModel: "claude-sonnet-4",
        accessMode: "hosted",
        env: {},
      }),
      { model: "claude-sonnet-4", provider: HERMES_HOSTED_BUZZ_PROVIDER },
    );
  });

  it("does not map hosted Claude to Hermes native anthropic", () => {
    const resolved = resolveHermesModelRequest({
      requestedModel: "anthropic/claude-opus-4.5",
      accessMode: "hosted",
      env: {},
    });
    assert.equal(resolved.provider, HERMES_HOSTED_BUZZ_PROVIDER);
    assert.notEqual(resolved.provider, "anthropic");
  });

  it("sends openrouter for other hosted Cloud models", () => {
    assert.deepEqual(
      resolveHermesModelRequest({
        requestedModel: "google/gemini-2.5-pro",
        accessMode: "hosted",
        env: {},
      }),
      { model: "google/gemini-2.5-pro", provider: "openrouter" },
    );
    assert.deepEqual(
      resolveHermesModelRequest({
        requestedModel: "x-ai/grok-4.5",
        accessMode: "hosted",
        env: {},
      }),
      { model: "x-ai/grok-4.5", provider: "openrouter" },
    );
    assert.deepEqual(
      resolveHermesModelRequest({
        requestedModel: "deepseek/deepseek-r1",
        accessMode: "hosted",
        env: {},
      }),
      { model: "deepseek/deepseek-r1", provider: "openrouter" },
    );
  });

  it("honors HERMES_PROVIDER override over family routing", () => {
    assert.deepEqual(
      resolveHermesModelRequest({
        requestedModel: "claude-sonnet-4",
        accessMode: "hosted",
        env: { HERMES_PROVIDER: "anthropic" },
      }),
      { model: "claude-sonnet-4", provider: "anthropic" },
    );
    assert.deepEqual(
      resolveHermesModelRequest({
        requestedModel: "openai/gpt-4o",
        accessMode: "hosted",
        env: { HERMES_PROVIDER: "openrouter" },
      }),
      { model: "openai/gpt-4o", provider: "openrouter" },
    );
    assert.deepEqual(
      resolveHermesModelRequest({
        requestedModel: "google/gemini-2.5-pro",
        accessMode: "hosted",
        env: { HERMES_PROVIDER: "custom:buzz" },
      }),
      { model: "google/gemini-2.5-pro", provider: HERMES_HOSTED_BUZZ_PROVIDER },
    );
    assert.deepEqual(
      resolveHermesModelRequest({
        requestedModel: "google/gemini-2.5-pro",
        accessMode: "hosted",
        env: { HERMES_PROVIDER: "buzz" },
      }),
      { model: "google/gemini-2.5-pro", provider: HERMES_HOSTED_BUZZ_PROVIDER },
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
    assert.deepEqual(
      resolveHermesModelRequest({
        requestedModel: "claude-sonnet-4",
        accessMode: "byok",
        byokProvider: "anthropic",
        env: {},
      }),
      { model: "claude-sonnet-4", provider: "anthropic" },
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
