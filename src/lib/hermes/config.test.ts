import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildHermesSessionKey,
  getHermesConfig,
  hermesChatCompletionsUrl,
  isHermesConfigured,
  normalizeHermesBaseUrl,
  shouldProxyChatToHermes,
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

  it("is off by default even when URL and key are set", () => {
    assert.equal(isHermesConfigured({}), false);
    assert.equal(
      isHermesConfigured({
        HERMES_BASE_URL: "https://h.example",
        HERMES_API_KEY: "secret",
      }),
      false,
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

  it("is live only with an explicit enable flag plus URL and key", () => {
    assert.equal(
      isHermesConfigured({
        HERMES_BASE_URL: "https://h.example",
        HERMES_API_KEY: "secret",
        HERMES_ENABLED: "1",
      }),
      true,
    );
    assert.equal(
      isHermesConfigured({
        HERMES_BASE_URL: "https://h.example",
        HERMES_API_KEY: "secret",
        HERMES_ENABLED: "true",
      }),
      true,
    );
    assert.equal(
      isHermesConfigured({
        HERMES_ENABLED: "1",
        HERMES_API_KEY: "secret",
      }),
      false,
    );
  });

  it("does not proxy hosted chat through Hermes unless the flag is on", () => {
    const creds = {
      HERMES_BASE_URL: "https://h.example",
      HERMES_API_KEY: "secret",
    };
    assert.equal(shouldProxyChatToHermes({ hosted: true, env: creds }), false);
    assert.equal(
      shouldProxyChatToHermes({
        hosted: true,
        env: { ...creds, HERMES_ENABLED: "1" },
      }),
      true,
    );
    assert.equal(
      shouldProxyChatToHermes({
        hosted: false,
        env: { ...creds, HERMES_ENABLED: "1" },
      }),
      false,
    );
  });

  it("reads model name default when opted in", () => {
    const cfg = getHermesConfig({
      HERMES_BASE_URL: "https://h.example/v1",
      HERMES_API_KEY: "k",
      HERMES_ENABLED: "1",
    });
    assert.deepEqual(cfg, {
      baseUrl: "https://h.example",
      apiKey: "k",
      modelName: "hermes-agent",
    });
    assert.equal(
      getHermesConfig({
        HERMES_BASE_URL: "https://h.example/v1",
        HERMES_API_KEY: "k",
      }),
      null,
    );
  });
});
