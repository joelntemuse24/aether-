import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AETHER_EXPERT_MODEL_FQN,
  DEFAULT_BUZZ_BASE_URL,
  aetherProviderManifests,
  normalizeBuzzBaseUrl,
  preferAetherExpertModel,
} from "./providers";

describe("aether TrueForge providers", () => {
  it("appends /v1 when the Buzz dashboard host is copied without it", () => {
    assert.equal(normalizeBuzzBaseUrl("https://api.buzzai.cc"), DEFAULT_BUZZ_BASE_URL);
    assert.equal(normalizeBuzzBaseUrl(""), DEFAULT_BUZZ_BASE_URL);
    assert.equal(normalizeBuzzBaseUrl("https://api.buzzai.cc/v1/"), DEFAULT_BUZZ_BASE_URL);
  });

  it("seeds Buzz Luna first and OpenRouter second when both keys are set", () => {
    const manifests = aetherProviderManifests({
      AETHER_HOSTED_BUZZ_API_KEY: "buzz-secret",
      OPENROUTER_API_KEY: "or-secret",
    });
    assert.deepEqual(
      manifests.map((manifest) => manifest.name),
      ["buzz", "openrouter"],
    );
    assert.equal(manifests[0]?.models[0]?.modelId, "gpt-5.6-luna");
    assert.equal(manifests[0]?.baseUrl, DEFAULT_BUZZ_BASE_URL);
    assert.equal(manifests[1]?.models[0]?.modelId, "openai/gpt-5.6-luna");
    assert.equal(manifests[1]?.baseUrl, "https://openrouter.ai/api/v1");
    assert.equal(manifests[0]?.auth.apiKey, "buzz-secret");
  });

  it("accepts the legacy Claude env aliases for the Buzz key", () => {
    const manifests = aetherProviderManifests({
      AETHER_HOSTED_CLAUDE_API_KEY: "legacy",
      AETHER_HOSTED_CLAUDE_BASE_URL: "https://api.buzzai.cc",
    });
    assert.equal(manifests.length, 1);
    assert.equal(manifests[0]?.name, "buzz");
    assert.equal(manifests[0]?.baseUrl, DEFAULT_BUZZ_BASE_URL);
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

  it("prefers the Buzz Luna FQN over catalog order", () => {
    const picked = preferAetherExpertModel([
      { name: "openrouter/gpt-5-6-sol" },
      { name: AETHER_EXPERT_MODEL_FQN },
    ]);
    assert.equal(picked?.name, AETHER_EXPERT_MODEL_FQN);
  });
});
