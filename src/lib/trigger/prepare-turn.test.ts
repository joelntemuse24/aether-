import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXPERT_PRIMARY_MODEL,
  FAST_OPENROUTER_MODEL,
} from "../hosted/speed-tiers";
import { prepareDurableChatTurn } from "./prepare-turn";

describe("prepareDurableChatTurn Cloud Fast/Expert routing", () => {
  it("rewrites hosted Fast turns to OpenRouter Nemotron Ultra", async () => {
    const prepared = await prepareDurableChatTurn({
      clientData: {
        accessMode: "hosted",
        model: "openai/gpt-5.5",
        speedTier: "fast",
      },
      chatId: "c-fast",
      userText: "hello",
    });
    assert.equal(prepared.hosted, true);
    assert.equal(prepared.speedTier, "fast");
    assert.equal(prepared.requestedModel, FAST_OPENROUTER_MODEL);
  });

  it("rewrites hosted Expert turns to Buzz Luna", async () => {
    const prepared = await prepareDurableChatTurn({
      clientData: {
        accessMode: "hosted",
        model: "openai/gpt-5.5",
        speedTier: "expert",
      },
      chatId: "c-expert",
      userText: "hello",
    });
    assert.equal(prepared.hosted, true);
    assert.equal(prepared.speedTier, "expert");
    assert.equal(prepared.requestedModel, EXPERT_PRIMARY_MODEL);
  });

  it("floors Fast + image attachment to Expert Luna", async () => {
    const prepared = await prepareDurableChatTurn({
      clientData: {
        accessMode: "hosted",
        model: "openai/gpt-5.5",
        speedTier: "fast",
        attachments: [
          {
            name: "shot.png",
            mime: "image/png",
            dataUrl: "data:image/png;base64,aa",
          },
        ],
      },
      chatId: "c-vision",
      userText: "what is this",
    });
    assert.equal(prepared.speedTier, "expert");
    assert.equal(prepared.requestedModel, EXPERT_PRIMARY_MODEL);
  });

  it("leaves BYOK model and ignores Cloud remapping", async () => {
    const prepared = await prepareDurableChatTurn({
      clientData: {
        accessMode: "byok",
        model: "gpt-4o",
        provider: "openai",
        apiKey: "sk-test",
        speedTier: "expert",
      },
      chatId: "c-byok",
      userText: "hello",
    });
    assert.equal(prepared.hosted, false);
    assert.equal(prepared.requestedModel, "gpt-4o");
  });
});
