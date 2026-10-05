import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { isBuzzChatModelId } from "@/lib/buzz/models";
import { isOpenRouterModelId } from "@/lib/openrouter/models";
import {
  hostedModelFqn,
  hostedTurnErrorCopy,
  shouldBackupHostedTurn,
  shouldRetryHostedTurn,
} from "@/lib/trueforge/chat-stream";
import {
  aetherProviderManifests,
  hostedOpenRouterManifest,
  modelProfile,
} from "@/lib/trueforge/providers";
import {
  HOSTED_DEFAULT_MODEL_FQN,
  HOSTED_DEFAULT_MODEL_ID,
  HOSTED_DEFAULT_MODEL_LABEL,
  buzzModelsEnabled,
  isHostedDefaultModel,
  resolveHostedTurnModel,
} from "./default-model";

const resolve = (requested: string, buzzEnabled = false) =>
  resolveHostedTurnModel({
    requested,
    buzzEnabled,
    isBuzzId: isBuzzChatModelId,
    isByokOpenRouterId: isOpenRouterModelId,
  });

describe("hosted default model", () => {
  it("is Qwen3.8 27B (free) on the sidecar's hosted provider", () => {
    assert.equal(HOSTED_DEFAULT_MODEL_ID, "qwen/qwen3.8-27b:free");
    assert.equal(HOSTED_DEFAULT_MODEL_LABEL, "Qwen3.8 27B");
    assert.equal(HOSTED_DEFAULT_MODEL_FQN, "openrouter/qwen3-8-27b-free");
    assert.equal(hostedModelFqn(HOSTED_DEFAULT_MODEL_ID), HOSTED_DEFAULT_MODEL_FQN);
    assert.equal(hostedModelFqn("gpt-5.6-luna"), "buzz/gpt-5-6-luna");
    assert.equal(isHostedDefaultModel(HOSTED_DEFAULT_MODEL_FQN), true);
    assert.equal(modelProfile(HOSTED_DEFAULT_MODEL_FQN).contextLength, 262_144);
    assert.deepEqual(modelProfile(HOSTED_DEFAULT_MODEL_FQN).reasoningEfforts, []);
  });

  it("keeps Buzz hidden unless the flag is on", () => {
    assert.equal(buzzModelsEnabled({}), false);
    assert.equal(buzzModelsEnabled({ AETHER_BUZZ_MODELS_ENABLED: "0" }), false);
    assert.equal(buzzModelsEnabled({ AETHER_BUZZ_MODELS_ENABLED: "1" }), true);
    assert.equal(buzzModelsEnabled({ AETHER_BUZZ_MODELS_ENABLED: "true" }), true);
  });

  it("routes empty, stale, and Buzz ids to the default while Buzz is hidden", () => {
    assert.deepEqual(resolve(""), { kind: "default" });
    assert.deepEqual(resolve(HOSTED_DEFAULT_MODEL_ID), { kind: "default" });
    assert.deepEqual(resolve("gpt-5.6-luna"), { kind: "default" });
    assert.deepEqual(resolve("claude-sonnet-5-5"), { kind: "default" });
    assert.deepEqual(resolve("expert"), { kind: "default" });
    assert.deepEqual(resolve("gpt-5.6-luna", true), { kind: "buzz", id: "gpt-5.6-luna" });
    assert.deepEqual(resolve("openai/gpt-4.1"), { kind: "byok-openrouter", id: "openai/gpt-4.1" });
  });

  it("seeds the hosted provider only from the explicit hosted key", () => {
    assert.equal(hostedOpenRouterManifest({ OPENROUTER_API_KEY: "plain" }), null);
    const manifest = hostedOpenRouterManifest({ AETHER_HOSTED_OPENROUTER_API_KEY: "hosted-secret" });
    assert.ok(manifest && manifest.type === "custom");
    assert.equal(manifest.name, "openrouter");
    assert.equal(manifest.baseUrl, "https://openrouter.ai/api/v1");
    assert.deepEqual(
      manifest.models.map((model) => [model.modelId, model.name]),
      [[HOSTED_DEFAULT_MODEL_ID, "qwen3-8-27b-free"]],
    );
    const withBuzz = aetherProviderManifests({
      AETHER_HOSTED_OPENROUTER_API_KEY: "hosted-secret",
      AETHER_HOSTED_BUZZ_API_KEY: "buzz-secret",
    });
    assert.equal(withBuzz[0]?.type === "custom" && withBuzz[0].name, "openrouter");
    assert.ok(withBuzz.length > 1);
    const onlyHosted = aetherProviderManifests({ AETHER_HOSTED_OPENROUTER_API_KEY: "hosted-secret" });
    assert.equal(onlyHosted.length, 1);
  });

  it("retries the default once on any early failure, then stops, with no Buzz backup", () => {
    const base = { modelId: HOSTED_DEFAULT_MODEL_ID, failedBeforeOutput: true, userAborted: false };
    assert.equal(shouldRetryHostedTurn({ ...base, errorText: "429 Too Many Requests", attempt: 0 }), true);
    assert.equal(shouldRetryHostedTurn({ ...base, errorText: "429 Too Many Requests", attempt: 1 }), false);
    assert.equal(shouldRetryHostedTurn({ ...base, errorText: "x", attempt: 0, userAborted: true }), false);
    assert.equal(
      shouldBackupHostedTurn({ modelId: HOSTED_DEFAULT_MODEL_ID, failedBeforeOutput: true, userAborted: false, hasKey: true }),
      false,
    );
    assert.equal(
      shouldBackupHostedTurn({ modelId: "gpt-5.6-luna", failedBeforeOutput: true, userAborted: false, hasKey: true }),
      true,
    );
  });

  it("gives an honest error that names no provider", () => {
    const copies = [
      hostedTurnErrorCopy("429 rate limit exceeded", HOSTED_DEFAULT_MODEL_ID),
      hostedTurnErrorCopy("The operation was aborted", HOSTED_DEFAULT_MODEL_ID),
      hostedTurnErrorCopy("boom", HOSTED_DEFAULT_MODEL_ID),
    ];
    assert.match(copies[0], /Qwen3\.8 27B is busy right now/);
    assert.match(copies[1], /timed out/);
    for (const copy of copies) assert.doesNotMatch(copy, /buzz|openrouter|trueforge/i);
  });

  it("keeps provider names out of the picker and the hosted models route", async () => {
    const picker = readFileSync("src/components/assistant-ui/buzz-model-picker.tsx", "utf8");
    const labels = picker.match(/const GROUP_LABELS[\s\S]*?\n};/)?.[0] ?? "";
    assert.ok(labels, "GROUP_LABELS present");
    assert.doesNotMatch(labels.replace(/^\s*\w+:/gm, ""), /buzz|openrouter|trueforge/i);
    assert.match(picker, /\{GROUP_LABELS\[group\]\}/);
    const previous = process.env.AETHER_BUZZ_MODELS_ENABLED;
    delete process.env.AETHER_BUZZ_MODELS_ENABLED;
    try {
      const { GET } = await import("@/app/api/hosted/models/route");
      const body = (await (await GET()).json()) as { defaultModel: string; models: { id: string; label: string }[] };
      assert.equal(body.defaultModel, HOSTED_DEFAULT_MODEL_ID);
      assert.deepEqual(body.models.map((model) => model.id), [HOSTED_DEFAULT_MODEL_ID]);
      assert.doesNotMatch(JSON.stringify(body), /buzz|openrouter|trueforge/i);
    } finally {
      if (previous === undefined) delete process.env.AETHER_BUZZ_MODELS_ENABLED;
      else process.env.AETHER_BUZZ_MODELS_ENABLED = previous;
    }
  });
});
