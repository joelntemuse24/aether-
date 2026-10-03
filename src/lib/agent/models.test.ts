import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LanguageModel } from "ai";
import { AGENT_MODEL_UNAVAILABLE, buildAgentLanguageModels } from "./models";

function modelId(model: LanguageModel): string {
  return typeof model === "string" ? model : model.modelId;
}

describe("agent language models", () => {
  it("uses Buzz for a hosted id and OpenRouter only as the per-turn fallback", () => {
    const built = buildAgentLanguageModels({
      modelId: "gpt-5.6-luna",
      env: {
        AETHER_HOSTED_BUZZ_API_KEY: "buzz-secret",
        AETHER_HOSTED_BUZZ_BASE_URL: "https://api.buzzai.cc",
        OPENROUTER_API_KEY: "server-openrouter-secret",
      },
      openRouterKey: "user-openrouter-secret",
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(modelId(built.model), "gpt-5.6-luna");
    assert.equal(built.fallbacks.length, 1);
    assert.equal(modelId(built.fallbacks[0]!), "openai/gpt-4.1");
  });

  it("does not use the VM OpenRouter key when the turn has none", () => {
    const built = buildAgentLanguageModels({
      modelId: "gpt-5.6-luna",
      env: {
        AETHER_HOSTED_BUZZ_API_KEY: "buzz-secret",
        OPENROUTER_API_KEY: "server-openrouter-secret",
      },
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.fallbacks.length, 0);
  });

  it("fails closed without a fixed sentence that echoes a key", () => {
    const built = buildAgentLanguageModels({
      modelId: "gpt-5.6-luna",
      env: { AETHER_HOSTED_BUZZ_API_KEY: "https://not-a-key.example" },
      openRouterKey: null,
    });
    assert.deepEqual(built, { ok: false, error: AGENT_MODEL_UNAVAILABLE });
    const openRouter = buildAgentLanguageModels({
      modelId: "openai/gpt-4.1",
      env: {},
    });
    assert.equal(openRouter.ok, false);
  });
});
