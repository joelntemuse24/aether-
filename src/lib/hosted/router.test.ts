import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveHostedRoute } from "./router";
import {
  EXPERT_BUZZ_FALLBACK_MODEL,
  EXPERT_OPENROUTER_FALLBACK_MODEL,
  EXPERT_PRIMARY_MODEL,
  FAST_OPENROUTER_FALLBACK_MODEL,
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

function hopIds(route: NonNullable<ReturnType<typeof resolveHostedRoute>>) {
  return [route.primary, ...route.fallbacks].map((r) => ({
    upstream: r.upstream.id,
    model: r.modelId,
  }));
}

describe("resolveCloudTierModel", () => {
  it("maps Fast to the free OpenRouter Nemotron Ultra slug", () => {
    assert.equal(resolveCloudTierModel("fast"), FAST_OPENROUTER_MODEL);
    assert.equal(FAST_OPENROUTER_MODEL, "nvidia/nemotron-3-ultra-550b-a55b:free");
    assert.match(FAST_OPENROUTER_MODEL, /:free$/);
  });

  it("maps Expert to Buzz Luna (gateway id)", () => {
    assert.equal(resolveCloudTierModel("expert"), EXPERT_PRIMARY_MODEL);
    assert.equal(EXPERT_PRIMARY_MODEL, "gpt-5.6-luna");
  });
});

describe("hostedCloudRouteAdvertisement", () => {
  it("advertises Fast/Expert primaries and the confirmed failover order", () => {
    const advertised = hostedCloudRouteAdvertisement();
    assert.equal(advertised.defaultModel, FAST_OPENROUTER_MODEL);
    assert.equal(advertised.routes.fast, FAST_OPENROUTER_MODEL);
    assert.equal(advertised.routes.expert, "openai/gpt-5.6-luna");
    assert.deepEqual(advertised.failover.fast, [
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      "nvidia/nemotron-3.5-lightning",
    ]);
    assert.deepEqual(advertised.failover.expert, [
      "openai/gpt-5.6-luna",
      "openai/gpt-5.6-sol",
      "deepseek/deepseek-v4-flash",
    ]);
    assert.match(advertised.failover.fast[0], /:free$/);
    assert.doesNotMatch(advertised.failover.fast[1], /:free/);
    assert.doesNotMatch(
      advertised.failover.expert.join(" "),
      /openai\/gpt-5\.6-luna$/,
    );
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
  it("Fast is OpenRouter free Ultra then paid Lightning, never Buzz", () => {
    withBuzzAndOpenRouter(() => {
      const route = resolveHostedRoute("gpt-5.6-luna", "fast");
      assert.ok(route, "route should resolve when OpenRouter is configured");
      assert.deepEqual(hopIds(route), [
        { upstream: "openrouter", model: FAST_OPENROUTER_MODEL },
        { upstream: "openrouter", model: FAST_OPENROUTER_FALLBACK_MODEL },
      ]);
      assert.equal(FAST_OPENROUTER_FALLBACK_MODEL, "nvidia/nemotron-3.5-lightning");
      assert.doesNotMatch(FAST_OPENROUTER_FALLBACK_MODEL, /:free/);
      assert.equal(
        hopIds(route).some((h) => h.upstream === "gpt" || h.upstream === "claude"),
        false,
      );
    });
  });

  it("Fast overrides leftover catalog ids and stays on OpenRouter", () => {
    withBuzzAndOpenRouter(() => {
      const route = resolveHostedRoute("moonshotai/kimi-k3", "fast");
      assert.ok(route);
      assert.deepEqual(hopIds(route).map((h) => h.model), [
        FAST_OPENROUTER_MODEL,
        FAST_OPENROUTER_FALLBACK_MODEL,
      ]);
    });
  });

  it("Expert is Buzz Luna, then Buzz Sol, then OpenRouter DeepSeek V4 Flash", () => {
    withBuzzAndOpenRouter(() => {
      const route = resolveHostedRoute("openai/gpt-5.5", "expert");
      assert.ok(route);
      assert.deepEqual(hopIds(route), [
        { upstream: "gpt", model: EXPERT_PRIMARY_MODEL },
        { upstream: "gpt", model: EXPERT_BUZZ_FALLBACK_MODEL },
        { upstream: "openrouter", model: EXPERT_OPENROUTER_FALLBACK_MODEL },
      ]);
      assert.equal(EXPERT_BUZZ_FALLBACK_MODEL, "gpt-5.6-sol");
      assert.equal(
        EXPERT_OPENROUTER_FALLBACK_MODEL,
        "deepseek/deepseek-v4-flash",
      );
      assert.equal(
        hopIds(route).some((h) => h.model === "openai/gpt-5.6-luna"),
        false,
      );
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

  it("Expert without Buzz goes to OpenRouter DeepSeek, not OpenRouter Luna", () => {
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
        assert.deepEqual(hopIds(route), [
          {
            upstream: "openrouter",
            model: EXPERT_OPENROUTER_FALLBACK_MODEL,
          },
        ]);
      },
    );
  });

  it("Fast without OpenRouter does not fall back to Buzz", () => {
    withEnv(
      {
        AETHER_HOSTED_BUZZ_API_KEY: "test-key",
        AETHER_HOSTED_BUZZ_BASE_URL: "https://api.buzzai.cc/v1",
        OPENROUTER_API_KEY: undefined,
      },
      () => {
        const route = resolveHostedRoute("openai/gpt-5.5", "fast");
        assert.equal(route, null);
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
