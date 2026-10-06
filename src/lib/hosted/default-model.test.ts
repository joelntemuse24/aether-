import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { isBuzzChatModelId } from "@/lib/buzz/models";
import { isOpenRouterModelId } from "@/lib/openrouter/models";
import {
  hostedModelFqn,
  HOSTED_RETRY_DELAY_MS,
  hostedTurnErrorCopy,
  shouldBackupHostedTurn,
  shouldRetryHostedTurn,
} from "@/lib/trueforge/chat-stream";
import {
  aetherProviderManifests,
  hostedOmniRouteManifest,
  hostedOpenRouterManifest,
  modelProfile,
} from "@/lib/trueforge/providers";
import {
  HOSTED_DEFAULT_MODEL_FQN,
  HOSTED_DEFAULT_MODEL_ID,
  HOSTED_DEFAULT_MODEL_LABEL,
  HOSTED_FREE_FALLBACK_MODEL_FQN,
  HOSTED_FREE_FALLBACK_MODEL_ID,
  HOSTED_FREE_FALLBACK_MODEL_RESOURCE,
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
  it("is Free auto (OmniRoute auto) on the sidecar's hosted provider", () => {
    assert.equal(HOSTED_DEFAULT_MODEL_ID, "auto");
    assert.equal(HOSTED_DEFAULT_MODEL_LABEL, "Free auto");
    assert.equal(HOSTED_DEFAULT_MODEL_FQN, "omniroute/auto");
    assert.equal(hostedModelFqn(HOSTED_DEFAULT_MODEL_ID), HOSTED_DEFAULT_MODEL_FQN);
    assert.equal(hostedModelFqn("gpt-5.6-luna"), "buzz/gpt-5-6-luna");
    assert.equal(isHostedDefaultModel("auto"), true);
    assert.equal(isHostedDefaultModel("omniroute/auto"), true);
    assert.equal(isHostedDefaultModel("qwen/qwen3.8-27b:free"), false);
    assert.equal(modelProfile(HOSTED_DEFAULT_MODEL_FQN).contextLength, 262_144);
    assert.deepEqual(modelProfile(HOSTED_DEFAULT_MODEL_FQN).reasoningEfforts, []);
    assert.equal(modelProfile(HOSTED_DEFAULT_MODEL_FQN).reasoningEffort, undefined);
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
    assert.deepEqual(resolve("omniroute/auto"), { kind: "default" });
    assert.deepEqual(resolve("qwen/qwen3.8-27b:free"), { kind: "byok-openrouter", id: "qwen/qwen3.8-27b:free" });
    assert.deepEqual(resolve("gpt-5.6-luna"), { kind: "default" });
    assert.deepEqual(resolve("claude-sonnet-5-5"), { kind: "default" });
    assert.deepEqual(resolve("expert"), { kind: "default" });
    assert.deepEqual(resolve("gpt-5.6-luna", true), { kind: "buzz", id: "gpt-5.6-luna" });
    assert.deepEqual(resolve("openai/gpt-4.1"), { kind: "byok-openrouter", id: "openai/gpt-4.1" });
  });

  it("seeds OmniRoute auto on loopback with a dummy key when none is set", () => {
    const manifest = hostedOmniRouteManifest({});
    assert.ok(manifest.type === "custom");
    assert.equal(manifest.name, "omniroute");
    assert.equal(manifest.baseUrl, "http://127.0.0.1:20128/v1");
    assert.equal(manifest.auth.apiKey, "local");
    assert.deepEqual(
      manifest.models.map((model) => [model.modelId, model.name]),
      [["auto", "auto"]],
    );
    assert.equal(manifest.models[0]?.properties.reasoningEfforts, undefined);
    const custom = hostedOmniRouteManifest({
      AETHER_HOSTED_OMNIROUTE_BASE_URL: " http://127.0.0.1:9999/v1 ",
      AETHER_HOSTED_OMNIROUTE_API_KEY: "omni-secret",
    });
    assert.equal(custom.type === "custom" && custom.baseUrl, "http://127.0.0.1:9999/v1");
    assert.equal(custom.auth.apiKey, "omni-secret");
    const urlAsKey = hostedOmniRouteManifest({ AETHER_HOSTED_OMNIROUTE_API_KEY: "http://127.0.0.1:20128/v1" });
    assert.equal(urlAsKey.auth.apiKey, "local");
  });

  it("puts OmniRoute first and keeps hosted OpenRouter optional", () => {
    assert.equal(hostedOpenRouterManifest({ OPENROUTER_API_KEY: "plain" }), null);
    const manifest = hostedOpenRouterManifest({ AETHER_HOSTED_OPENROUTER_API_KEY: "hosted-secret" });
    assert.ok(manifest && manifest.type === "custom");
    assert.equal(manifest.name, "openrouter");
    assert.deepEqual(
      manifest.models.map((model) => [model.modelId, model.name]),
      [[HOSTED_FREE_FALLBACK_MODEL_ID, "gemma-4-31b-it-free"]],
    );
    const none = aetherProviderManifests({});
    assert.deepEqual(none.map((m) => m.type === "custom" && m.name), ["omniroute"]);
    const withBuzz = aetherProviderManifests({
      AETHER_HOSTED_OPENROUTER_API_KEY: "hosted-secret",
      AETHER_HOSTED_BUZZ_API_KEY: "buzz-secret",
    });
    assert.equal(withBuzz[0]?.type === "custom" && withBuzz[0].name, "omniroute");
    assert.equal(withBuzz[1]?.type === "custom" && withBuzz[1].name, "openrouter");
    assert.ok(withBuzz.length > 2);
    const onlyHosted = aetherProviderManifests({ AETHER_HOSTED_OPENROUTER_API_KEY: "hosted-secret" });
    assert.equal(onlyHosted.length, 2);
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

  it("keeps the optional OpenRouter free model out of the default path", () => {
    assert.equal(HOSTED_FREE_FALLBACK_MODEL_ID, "google/gemma-4-31b-it:free");
    assert.doesNotMatch(HOSTED_FREE_FALLBACK_MODEL_RESOURCE, /[./:]/);
    assert.equal(HOSTED_FREE_FALLBACK_MODEL_FQN, "openrouter/gemma-4-31b-it-free");
    assert.equal(isHostedDefaultModel(HOSTED_FREE_FALLBACK_MODEL_FQN), false);
    assert.equal(modelProfile(HOSTED_FREE_FALLBACK_MODEL_FQN).reasoningEffort, undefined);
  });

  it("waits 10-20s before the default's retry", () => {
    assert.ok(HOSTED_RETRY_DELAY_MS >= 10_000 && HOSTED_RETRY_DELAY_MS <= 20_000);
  });

  it("gives an honest error that names no provider", () => {
    const copies = [
      hostedTurnErrorCopy("429 rate limit exceeded", HOSTED_DEFAULT_MODEL_ID),
      hostedTurnErrorCopy("The operation was aborted", HOSTED_DEFAULT_MODEL_ID),
      hostedTurnErrorCopy("boom", HOSTED_DEFAULT_MODEL_ID),
    ];
    assert.match(copies[0], /Free auto is busy right now/);
    assert.match(copies[1], /timed out/);
    for (const copy of copies) assert.doesNotMatch(copy, /buzz|openrouter|omniroute|trueforge/i);
  });

  it("keeps provider names out of the picker and the hosted models route", async () => {
    const picker = readFileSync("src/components/assistant-ui/buzz-model-picker.tsx", "utf8");
    const labels = picker.match(/const GROUP_LABELS[\s\S]*?\n};/)?.[0] ?? "";
    assert.ok(labels, "GROUP_LABELS present");
    assert.doesNotMatch(labels.replace(/^\s*\w+:/gm, ""), /buzz|openrouter|omniroute|trueforge/i);
    assert.match(picker, /\{GROUP_LABELS\[group\]\}/);
    const previous = process.env.AETHER_BUZZ_MODELS_ENABLED;
    delete process.env.AETHER_BUZZ_MODELS_ENABLED;
    try {
      const { GET } = await import("@/app/api/hosted/models/route");
      const body = (await (await GET()).json()) as { defaultModel: string; models: { id: string; label: string }[] };
      assert.equal(body.defaultModel, HOSTED_DEFAULT_MODEL_ID);
      assert.deepEqual(body.models.map((model) => model.id), [HOSTED_DEFAULT_MODEL_ID]);
      assert.doesNotMatch(JSON.stringify(body), /buzz|openrouter|omniroute|trueforge/i);
    } finally {
      if (previous === undefined) delete process.env.AETHER_BUZZ_MODELS_ENABLED;
      else process.env.AETHER_BUZZ_MODELS_ENABLED = previous;
    }
  });
  it("serves only the hosted default from /api/hosted/status while Buzz is off, without fetching the catalog", async () => {
    const previous = process.env.AETHER_BUZZ_MODELS_ENABLED;
    const realFetch = globalThis.fetch;
    let fetchCalls = 0;
    delete process.env.AETHER_BUZZ_MODELS_ENABLED;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("network disabled in test");
    }) as typeof fetch;
    try {
      const { GET } = await import("@/app/api/hosted/status/route");
      const body = (await (await GET()).json()) as {
        defaultModel: string;
        routes: { expert: string };
        failover: { expert: string[] };
        models: { id: string }[];
      };
      assert.equal(body.defaultModel, HOSTED_DEFAULT_MODEL_ID);
      assert.deepEqual(body.models.map((model) => model.id), [HOSTED_DEFAULT_MODEL_ID]);
      assert.equal(body.routes.expert, HOSTED_DEFAULT_MODEL_ID);
      assert.deepEqual(body.failover.expert, []);
      const json = JSON.stringify(body);
      assert.doesNotMatch(json, /gpt-6-astra|claude-fable|gpt-5\.6-luna|gpt-5\.6-sol|deepseek/i);
      assert.doesNotMatch(json, /buzz|openrouter|omniroute|trueforge/i);
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = realFetch;
      if (previous === undefined) delete process.env.AETHER_BUZZ_MODELS_ENABLED;
      else process.env.AETHER_BUZZ_MODELS_ENABLED = previous;
    }
  });
});
