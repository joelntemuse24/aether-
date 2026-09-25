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

  it("prefers the Buzz Luna FQN over catalog order", () => {
    const picked = preferAetherExpertModel([
      { name: "openrouter/gpt-5-6-sol" },
      { name: AETHER_EXPERT_MODEL_FQN },
    ]);
    assert.equal(picked?.name, AETHER_EXPERT_MODEL_FQN);
  });
});
