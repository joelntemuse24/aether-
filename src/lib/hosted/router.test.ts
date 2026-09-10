import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveHostedRoute } from "./router";
import { threadNeedsLongContext } from "./speed-tiers";

function withBuzzEnv<T>(fn: () => T): T {
  const prevKey = process.env.AETHER_HOSTED_BUZZ_API_KEY;
  const prevBase = process.env.AETHER_HOSTED_BUZZ_BASE_URL;
  const prevOr = process.env.OPENROUTER_API_KEY;
  process.env.AETHER_HOSTED_BUZZ_API_KEY = "test-key";
  process.env.AETHER_HOSTED_BUZZ_BASE_URL = "https://api.buzzai.cc/v1";
  process.env.OPENROUTER_API_KEY = "test-or-key";
  try {
    return fn();
  } finally {
    if (prevKey === undefined) delete process.env.AETHER_HOSTED_BUZZ_API_KEY;
    else process.env.AETHER_HOSTED_BUZZ_API_KEY = prevKey;
    if (prevBase === undefined) delete process.env.AETHER_HOSTED_BUZZ_BASE_URL;
    else process.env.AETHER_HOSTED_BUZZ_BASE_URL = prevBase;
    if (prevOr === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prevOr;
  }
}

describe("resolveHostedRoute speed tiers", () => {
  it("fast tier puts the BUZZ free cascade before premium ChatGPT", () => {
    withBuzzEnv(() => {
      const route = resolveHostedRoute("gpt-5.6-luna", "fast");
      assert.ok(route, "route should resolve when BUZZ is configured");
      assert.equal(route.primary.modelId, "glm-5.3-flash-free");
      const ids = [route.primary, ...route.fallbacks].map((r) => r.modelId);
      assert.ok(ids.includes("deepseek-v4-flash-free"), "second free hop present");
      assert.ok(ids.includes("gpt-5.6-luna"), "premium kept in chain");
      const last = ids[ids.length - 1];
      assert.equal(last, "openai/gpt-5.6-luna", "premium is the last OpenRouter fallback");
    });
  });

  it("expert tier keeps the premium model primary", () => {
    withBuzzEnv(() => {
      const route = resolveHostedRoute("gpt-5.6-luna", "expert");
      assert.ok(route);
      assert.equal(route.primary.modelId, "gpt-5.6-luna");
    });
  });

  it("fast reroutes long-tail catalog ids through the BUZZ cascade", () => {
    withBuzzEnv(() => {
      const route = resolveHostedRoute("moonshotai/kimi-k3", "fast");
      assert.ok(route);
      assert.equal(route.primary.modelId, "glm-5.3-flash-free");
      const ids = [route.primary, ...route.fallbacks].map((r) => r.modelId);
      assert.ok(
        ids.includes("moonshotai/kimi-k3"),
        "original catalog id stays as last resort",
      );
      assert.equal(ids[ids.length - 1], "moonshotai/kimi-k3");
    });
  });

  it("expert keeps long-tail ids on OpenRouter directly", () => {
    withBuzzEnv(() => {
      const route = resolveHostedRoute("moonshotai/kimi-k3", "expert");
      assert.ok(route);
      assert.equal(route.primary.modelId, "moonshotai/kimi-k3");
      assert.equal(route.fallbacks.length, 0);
    });
  });
});

describe("threadNeedsLongContext", () => {
  it("short threads stay short-context", () => {
    assert.equal(threadNeedsLongContext("hello".repeat(100)), false);
  });
  it("very long threads flip to long-context", () => {
    assert.equal(threadNeedsLongContext("x".repeat(272_000 * 4)), true);
  });
});
