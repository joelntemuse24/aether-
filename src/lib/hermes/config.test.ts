import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildHermesSessionKey,
  getHermesConfig,
  hermesChatCompletionsUrl,
  isHermesConfigured,
  normalizeHermesBaseUrl,
} from "./config";

describe("hermes config", () => {
  it("normalizes base URL without trailing slash or /v1", () => {
    assert.equal(
      normalizeHermesBaseUrl("https://h.example/v1/"),
      "https://h.example",
    );
    assert.equal(
      normalizeHermesBaseUrl("https://h.example/"),
      "https://h.example",
    );
  });

  it("builds chat completions URL", () => {
    assert.equal(
      hermesChatCompletionsUrl("https://h.example/v1"),
      "https://h.example/v1/chat/completions",
    );
  });

  it("builds scoped session keys under 256 chars", () => {
    const key = buildHermesSessionKey({
      userId: "user-1",
      conversationId: "c1",
    });
    assert.equal(key, "aether:user:user-1");
    assert.ok(key.length <= 256);
    assert.equal(
      buildHermesSessionKey({ userId: null, conversationId: "thread-9" }),
      "aether:anon:thread-9",
    );
  });

  it("strips control characters from session keys", () => {
    assert.equal(
      buildHermesSessionKey({ userId: "a\nb\0c", conversationId: null }),
      "aether:user:abc",
    );
  });

  it("is configured only when URL and key are set", () => {
    assert.equal(isHermesConfigured({}), false);
    assert.equal(
      isHermesConfigured({
        HERMES_BASE_URL: "https://h.example",
        HERMES_API_KEY: "secret",
      }),
      true,
    );
    assert.equal(
      isHermesConfigured({
        HERMES_BASE_URL: "https://h.example",
        HERMES_API_KEY: "secret",
        HERMES_ENABLED: "0",
      }),
      false,
    );
  });

  it("reads model name default", () => {
    const cfg = getHermesConfig({
      HERMES_BASE_URL: "https://h.example/v1",
      HERMES_API_KEY: "k",
    });
    assert.deepEqual(cfg, {
      baseUrl: "https://h.example",
      apiKey: "k",
      modelName: "hermes-agent",
    });
  });
});
