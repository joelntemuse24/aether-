import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aetherProviderManifests } from "@/lib/trueforge/providers";
import { boundedOpenRouterMessages, shouldBackupBuzzWithOpenRouter, textHistoryFromUiMessages } from "./stream";
import {
  filterOpenRouterChatModels,
  isOpenRouterModelId,
  openRouterFallbackModel,
  redactSecret,
} from "./models";

describe("OpenRouter BYOK catalog", () => {
  it("keeps chat models that can call tools", () => {
    const models = filterOpenRouterChatModels([
      { id: "openai/gpt-4.1", name: "GPT-4.1", supported_parameters: ["tools", "temperature"] },
      { id: "openai/text-embedding-3-small", supported_parameters: ["tools"] },
      { id: "anthropic/claude-sonnet-4.6", name: "Sonnet", supported_parameters: ["tools"] },
      { id: "meta/llama-vision", architecture: { modality: "image->text" }, supported_parameters: ["tools"] },
      { id: "openai/gpt-4.1-mini", supported_parameters: ["temperature"] },
    ]);
    assert.deepEqual(models.map((model) => model.id), ["openai/gpt-4.1", "anthropic/claude-sonnet-4.6"]);
  });

  it("maps Buzz models onto OpenRouter and does not seed a user key", () => {
    assert.equal(openRouterFallbackModel("gpt-5.6-luna"), "openai/gpt-4.1");
    assert.equal(openRouterFallbackModel("claude-sonnet-4-6"), "anthropic/claude-sonnet-4-6");
    assert.equal(
      openRouterFallbackModel("gpt-5.6-luna", { AETHER_OPENROUTER_MODEL_MAP: "{\"gpt-5.6-luna\":\"openai/gpt-4.1-mini\"}" }),
      "openai/gpt-4.1-mini",
    );
    assert.equal(isOpenRouterModelId("openai/gpt-4.1"), true);
    assert.equal(isOpenRouterModelId("gpt-5.6-luna"), false);
    const manifests = aetherProviderManifests({
      AETHER_HOSTED_BUZZ_API_KEY: "buzz-secret",
      OPENROUTER_API_KEY: "user-should-not-be-seeded",
    });
    assert.equal(manifests.some((manifest) => manifest.type === "custom" && manifest.name === "openrouter"), false);
    assert.equal(JSON.stringify(manifests).includes("user-should-not-be-seeded"), false);
  });

  it("backs up a failed Buzz turn only when the user supplied a key", () => {
    assert.equal(
      shouldBackupBuzzWithOpenRouter({ failedBeforeOutput: true, userAborted: false, hasKey: true }),
      true,
    );
    assert.equal(
      shouldBackupBuzzWithOpenRouter({ failedBeforeOutput: true, userAborted: false, hasKey: false }),
      false,
    );
    assert.equal(
      shouldBackupBuzzWithOpenRouter({ failedBeforeOutput: false, userAborted: false, hasKey: true }),
      false,
    );
  });

  it("removes the user key from an error string", () => {
    assert.equal(redactSecret("bad key sk-or-secret in body", "sk-or-secret"), "bad key [redacted] in body");
  });

  it("sends bounded conversation history, not only the last user line", () => {
    const history = textHistoryFromUiMessages([
      { role: "user", parts: [{ type: "text", text: "Earlier question" }] },
      { role: "assistant", parts: [{ type: "text", text: "Earlier answer" }] },
      { role: "user", parts: [{ type: "text", text: "Follow up" }, { type: "file", text: "skip" }] },
    ]);
    assert.deepEqual(history, [
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer" },
      { role: "user", content: "Follow up" },
    ]);
    const messages = boundedOpenRouterMessages({
      system: "Be brief.",
      history,
      userText: "Follow up",
    });
    assert.deepEqual(
      messages.map((row) => row.content),
      ["Be brief.", "Earlier question", "Earlier answer", "Follow up"],
    );
    const trimmed = boundedOpenRouterMessages({
      system: "Be brief.",
      history: Array.from({ length: 30 }, (_, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: `turn ${index}`,
      })),
      limit: 4,
    });
    assert.equal(trimmed.length, 5);
    assert.equal(trimmed[0]?.content, "Be brief.");
    assert.equal(trimmed.at(-1)?.content, "turn 29");
    assert.deepEqual(boundedOpenRouterMessages({ system: "Be brief.", userText: "Only this" }), [
      { role: "system", content: "Be brief." },
      { role: "user", content: "Only this" },
    ]);
  });
});
