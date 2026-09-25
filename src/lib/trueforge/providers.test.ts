import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AETHER_EXPERT_MODEL_FQN,
  DEFAULT_BUZZ_BASE_URL,
  aetherProviderManifests,
  modelProfile,
  normalizeBuzzBaseUrl,
  preferAetherExpertModel,
} from "./providers";

describe("aether TrueForge providers", () => {
  it("appends /v1 when the Buzz dashboard host is copied without it", () => {
    assert.equal(normalizeBuzzBaseUrl("https://api.buzzai.cc"), DEFAULT_BUZZ_BASE_URL);
    assert.equal(normalizeBuzzBaseUrl(""), DEFAULT_BUZZ_BASE_URL);
    assert.equal(normalizeBuzzBaseUrl("https://api.buzzai.cc/v1/"), DEFAULT_BUZZ_BASE_URL);
  });

  it("seeds GPT on the OpenAI-compatible host and Claude on the Anthropic host", () => {
    const manifests = aetherProviderManifests(
      {
        AETHER_HOSTED_BUZZ_API_KEY: "buzz-secret",
        OPENROUTER_API_KEY: "or-secret",
      },
      ["gpt-5.6-luna", "claude-sonnet-5", "gpt-image-1"],
    );
    assert.equal(manifests[0]?.type, "custom");
    assert.equal(manifests[0]?.type === "custom" ? manifests[0].name : "", "buzz");
    assert.equal(manifests[0]?.models[0]?.modelId, "gpt-5.6-luna");
    assert.equal(manifests[0]?.models[0]?.name, "gpt-5-6-luna");
    assert.equal(manifests[0]?.baseUrl, DEFAULT_BUZZ_BASE_URL);
    assert.equal(manifests[1]?.type, "anthropic");
    assert.equal(manifests[1]?.baseUrl, "https://api.buzzai.cc/v1");
    assert.equal(manifests[1]?.models[0]?.modelId, "claude-sonnet-5");
    assert.equal(manifests.some((manifest) => manifest.type === "custom" && manifest.name === "openrouter"), false);
  });

  it("accepts the legacy Claude env aliases for the Buzz key", () => {
    const manifests = aetherProviderManifests({
      AETHER_HOSTED_CLAUDE_API_KEY: "legacy",
      AETHER_HOSTED_CLAUDE_BASE_URL: "https://api.buzzai.cc",
    });
    assert.equal(manifests[0]?.type === "custom" ? manifests[0].name : "", "buzz");
    assert.equal(manifests[0]?.baseUrl, DEFAULT_BUZZ_BASE_URL);
    assert.equal(manifests.some((manifest) => manifest.type === "anthropic"), true);
  });

  it("keeps a custom Buzz base URL", () => {
    const manifests = aetherProviderManifests({
      AETHER_HOSTED_BUZZ_API_KEY: "buzz-secret",
      AETHER_HOSTED_BUZZ_BASE_URL: "https://buzz.example/v1/",
    });
    assert.equal(manifests[0]?.baseUrl, "https://buzz.example/v1");
  });

  it("skips a key that is actually a URL", () => {
    assert.deepEqual(
      aetherProviderManifests({ OPENROUTER_API_KEY: "https://openrouter.ai/api/v1" }),
      [],
    );
  });

  it("skips a provider whose key is absent", () => {
    assert.deepEqual(
      aetherProviderManifests({ OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1" }),
      [],
    );
  });

  it("uses a per-family context, output limit, and reasoning effort", () => {
    const luna = modelProfile("buzz/gpt-5-6-luna");
    assert.equal(luna.reasoningEffort, "none");
    assert.equal(luna.maxOutputTokens, 128_000);
    assert.equal(luna.reasoningEfforts.includes("none"), true);
    const astra = modelProfile("gpt-6-astra");
    assert.equal(astra.reasoningEffort, "low");
    assert.equal(astra.reasoningEfforts.includes("none"), false);
    const haiku = modelProfile("claude-haiku-4-5-20251001");
    assert.equal(haiku.maxOutputTokens, 64_000);
    assert.equal(haiku.reasoningEffort, undefined);
    const sonnet = modelProfile("anthropic/claude-sonnet-5");
    assert.equal(sonnet.maxOutputTokens, 64_000);
    assert.equal(sonnet.reasoningEffort, undefined);
    const opus = modelProfile("claude-opus-5-5");
    assert.equal(opus.maxOutputTokens, 128_000);
    assert.equal(opus.reasoningEffort, undefined);
    const fable = modelProfile("claude-fable-5");
    assert.equal(fable.maxOutputTokens, 128_000);
    const unknown = modelProfile("mystery-model");
    assert.equal(unknown.maxOutputTokens, 64_000);
    assert.equal(unknown.reasoningEffort, undefined);
    const manifests = aetherProviderManifests(
      { AETHER_HOSTED_BUZZ_API_KEY: "buzz-secret" },
      ["gpt-6-astra", "claude-haiku-4-5-20251001"],
    );
    assert.equal(manifests[0]?.models[0]?.properties.maxOutputTokens, 128_000);
    assert.equal(manifests[0]?.models[0]?.properties.reasoningEfforts.includes("none"), false);
    assert.equal(manifests[1]?.models[0]?.properties.maxOutputTokens, 64_000);
    assert.deepEqual(manifests[1]?.models[0]?.properties.reasoningEfforts, []);
  });

  it("prefers the Buzz Luna FQN over catalog order", () => {
    const picked = preferAetherExpertModel([
      { name: "openrouter/gpt-5-6-sol" },
      { name: AETHER_EXPERT_MODEL_FQN },
    ]);
    assert.equal(picked?.name, AETHER_EXPERT_MODEL_FQN);
  });
});
