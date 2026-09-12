import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveHostedRoute, toOpenRouterModelId } from "./router";
import { HOSTED_CLOUD_UNAVAILABLE_MESSAGE } from "./errors";
import {
  EXPERT_BUZZ_FALLBACK_MODEL,
  EXPERT_OPENROUTER_FALLBACK_MODEL,
  EXPERT_PRIMARY_MODEL,
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
  it("always maps Cloud chats to the Expert primary (legacy fast included)", () => {
    assert.equal(resolveCloudTierModel("expert"), EXPERT_PRIMARY_MODEL);
    assert.equal(resolveCloudTierModel("fast"), EXPERT_PRIMARY_MODEL);
    assert.equal(EXPERT_PRIMARY_MODEL, "gpt-5.6-luna");
  });
});

describe("hostedCloudRouteAdvertisement", () => {
  it("advertises Expert as the only Cloud route", () => {
    const advertised = hostedCloudRouteAdvertisement();
    assert.equal(advertised.defaultModel, "openai/gpt-5.6-luna");
    assert.equal(advertised.routes.expert, "openai/gpt-5.6-luna");
    assert.equal(advertised.routes.fast, undefined);
    assert.equal(advertised.failover.fast, undefined);
    assert.deepEqual(advertised.failover.expert, [
      "openai/gpt-5.6-luna",
      "openai/gpt-5.6-sol",
      "deepseek/deepseek-v4-flash",
    ]);
    assert.doesNotMatch(
      advertised.failover.expert.join(" "),
      /openai\/gpt-5\.6-luna$/,
    );
  });
});

describe("resolveEffectiveSpeedTier", () => {
  it("always resolves to Expert, including leftover Fast requests", () => {
    assert.equal(resolveEffectiveSpeedTier({ requested: "fast" }), "expert");
    assert.equal(resolveEffectiveSpeedTier({ requested: "expert" }), "expert");
    assert.equal(resolveEffectiveSpeedTier({}), "expert");
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

describe("resolveHostedRoute Cloud Expert path", () => {
  it("is Buzz Luna, then Buzz Sol, then OpenRouter DeepSeek V4 Flash", () => {
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

  it("maps leftover Fast requests onto the same Expert chain", () => {
    withBuzzAndOpenRouter(() => {
      for (const leftover of [
        "anthropic/claude-sonnet-5",
        "moonshotai/kimi-k3",
        "",
        "   ",
      ]) {
        const route = resolveHostedRoute(leftover, "fast");
        assert.ok(route, `Expert must resolve when leftover model is ${JSON.stringify(leftover)}`);
        assert.deepEqual(hopIds(route).map((h) => h.model), [
          EXPERT_PRIMARY_MODEL,
          EXPERT_BUZZ_FALLBACK_MODEL,
          EXPERT_OPENROUTER_FALLBACK_MODEL,
        ]);
        assert.equal(
          hopIds(route).some((h) => /nemotron|lightning/i.test(h.model)),
          false,
        );
      }
    });
  });

  it("preserves OpenRouter provider prefixes through id mapping", () => {
    assert.equal(toOpenRouterModelId("gpt-4o"), "openai/gpt-4o");
    assert.equal(
      toOpenRouterModelId("deepseek/deepseek-v4-flash"),
      "deepseek/deepseek-v4-flash",
    );
  });

  it("keeps Luna as the Buzz primary", () => {
    withBuzzAndOpenRouter(() => {
      const route = resolveHostedRoute("gpt-5.6-luna", "expert");
      assert.ok(route);
      assert.equal(route.primary.upstream.id, "gpt");
      assert.equal(route.primary.modelId, "gpt-5.6-luna");
    });
  });

  it("without Buzz goes to OpenRouter DeepSeek, not an OpenRouter Fast hop", () => {
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
        const route = resolveHostedRoute("openai/gpt-5.5", "fast");
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

  it("without Buzz or OpenRouter surfaces a loud Cloud error", () => {
    withEnv(
      {
        AETHER_HOSTED_BUZZ_API_KEY: undefined,
        AETHER_HOSTED_BUZZ_BASE_URL: undefined,
        AETHER_HOSTED_CLAUDE_API_KEY: undefined,
        AETHER_HOSTED_GPT_API_KEY: undefined,
        AETHER_HOSTED_CHATGPT_API_KEY: undefined,
        ANTHROPIC_AUTH_TOKEN: undefined,
        OPENROUTER_API_KEY: undefined,
      },
      () => {
        const route = resolveHostedRoute("anthropic/claude-sonnet-5", "expert");
        assert.equal(route, null);
        assert.match(HOSTED_CLOUD_UNAVAILABLE_MESSAGE, /Aether Cloud/);
        assert.match(HOSTED_CLOUD_UNAVAILABLE_MESSAGE, /Bring your own key/i);
        assert.doesNotMatch(
          HOSTED_CLOUD_UNAVAILABLE_MESSAGE,
          /OpenRouter|Buzz|Nemotron|NVIDIA|Claude|dropdown/i,
        );
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
