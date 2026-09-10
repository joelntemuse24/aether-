import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveHostedRoute } from "./router";
import {
  EXPERT_PRIMARY_MODEL,
  FAST_OPENROUTER_MODEL,
  hostedCloudRouteAdvertisement,
  resolveCloudTierModel,
  resolveEffectiveSpeedTier,
  threadNeedsLongContext,
} from "./speed-tiers";

function withEnv<T>(
  patch: Record<string, string | undefined>,
  fn: () => T,
): T {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(patch)) {
    prev[key] = process.env[key];
    const next = patch[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function withBuzzAndOpenRouter<T>(fn: () => T): T {
  return withEnv(
    {
      AETHER_HOSTED_BUZZ_API_KEY: "test-key",
      AETHER_HOSTED_BUZZ_BASE_URL: "https://api.buzzai.cc/v1",
      OPENROUTER_API_KEY: "test-or-key",
    },
    fn,
  );
}

describe("resolveCloudTierModel", () => {
  it("maps Fast to the paid OpenRouter Nemotron Ultra slug", () => {
    assert.equal(resolveCloudTierModel("fast"), FAST_OPENROUTER_MODEL);
    assert.equal(FAST_OPENROUTER_MODEL, "nvidia/nemotron-3-ultra-550b-a55b");
    assert.doesNotMatch(FAST_OPENROUTER_MODEL, /:free/);
  });

  it("maps Expert to Buzz Luna (gateway id)", () => {
    assert.equal(resolveCloudTierModel("expert"), EXPERT_PRIMARY_MODEL);
    assert.equal(EXPERT_PRIMARY_MODEL, "gpt-5.6-luna");
  });
});

describe("hostedCloudRouteAdvertisement", () => {
  it("advertises Fast as the Cloud default and Expert as catalog Luna", () => {
    const advertised = hostedCloudRouteAdvertisement();
    assert.equal(advertised.defaultModel, FAST_OPENROUTER_MODEL);
    assert.equal(advertised.routes.fast, FAST_OPENROUTER_MODEL);
    assert.equal(advertised.routes.expert, "openai/gpt-5.6-luna");
  });
});

describe("resolveEffectiveSpeedTier", () => {
  it("honors the composer Fast/Expert choice", () => {
    assert.equal(resolveEffectiveSpeedTier({ requested: "fast" }), "fast");
    assert.equal(resolveEffectiveSpeedTier({ requested: "expert" }), "expert");
    assert.equal(resolveEffectiveSpeedTier({}), "fast");
  });

  it("floors to Expert for deep harness or vision attachments", () => {
    assert.equal(
      resolveEffectiveSpeedTier({ requested: "fast", harnessDepth: "deep" }),
      "expert",
    );
    assert.equal(
      resolveEffectiveSpeedTier({
        requested: "fast",
        hasImageAttachment: true,
      }),
      "expert",
    );
  });
});

describe("resolveHostedRoute speed tiers", () => {
  it("Fast routes to OpenRouter Nemotron Ultra even when the client sent Luna", () => {
    withBuzzAndOpenRouter(() => {
      const route = resolveHostedRoute("gpt-5.6-luna", "fast");
      assert.ok(route, "route should resolve when OpenRouter is configured");
      assert.equal(route.primary.upstream.id, "openrouter");
      assert.equal(route.primary.modelId, FAST_OPENROUTER_MODEL);
    });
  });

  it("Fast overrides leftover catalog ids", () => {
    withBuzzAndOpenRouter(() => {
      const route = resolveHostedRoute("moonshotai/kimi-k3", "fast");
      assert.ok(route);
      assert.equal(route.primary.upstream.id, "openrouter");
      assert.equal(route.primary.modelId, FAST_OPENROUTER_MODEL);
    });
  });

  it("Expert routes to Buzz GPT Luna even when the client sent a default catalog id", () => {
    withBuzzAndOpenRouter(() => {
      const route = resolveHostedRoute("openai/gpt-5.5", "expert");
      assert.ok(route);
      assert.equal(route.primary.upstream.id, "gpt");
      assert.equal(route.primary.modelId, EXPERT_PRIMARY_MODEL);
      const last = [route.primary, ...route.fallbacks].at(-1);
      assert.equal(last?.upstream.id, "openrouter");
      assert.equal(last?.modelId, "openai/gpt-5.6-luna");
    });
  });

  it("Expert keeps Luna as the Buzz primary", () => {
    withBuzzAndOpenRouter(() => {
      const route = resolveHostedRoute("gpt-5.6-luna", "expert");
      assert.ok(route);
      assert.equal(route.primary.upstream.id, "gpt");
      assert.equal(route.primary.modelId, "gpt-5.6-luna");
    });
  });

  it("Expert without Buzz falls back to OpenRouter Luna", () => {
    withEnv(
      {
        AETHER_HOSTED_BUZZ_API_KEY: undefined,
        AETHER_HOSTED_BUZZ_BASE_URL: undefined,
        AETHER_HOSTED_CLAUDE_API_KEY: undefined,
        AETHER_HOSTED_GPT_API_KEY: undefined,
        AETHER_HOSTED_CHATGPT_API_KEY: undefined,
        ANTHROPIC_AUTH_TOKEN: undefined,
        OPENROUTER_API_KEY: "test-or-key",
      },
      () => {
        const route = resolveHostedRoute("openai/gpt-5.5", "expert");
        assert.ok(route);
        assert.equal(route.primary.upstream.id, "openrouter");
        assert.equal(route.primary.modelId, "openai/gpt-5.6-luna");
      },
    );
  });

  it("Fast without OpenRouter last-resorts to Buzz Luna so Cloud still answers", () => {
    withEnv(
      {
        AETHER_HOSTED_BUZZ_API_KEY: "test-key",
        AETHER_HOSTED_BUZZ_BASE_URL: "https://api.buzzai.cc/v1",
        OPENROUTER_API_KEY: undefined,
      },
      () => {
        const route = resolveHostedRoute("openai/gpt-5.5", "fast");
        assert.ok(route);
        assert.equal(route.primary.upstream.id, "gpt");
        assert.equal(route.primary.modelId, EXPERT_PRIMARY_MODEL);
      },
    );
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
