import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hermesFallbackPickerModels,
  isHostedChatAvailable,
} from "./availability";

describe("hosted chat availability", () => {
  it("is available when only Hermes is configured", () => {
    assert.equal(
      isHostedChatAvailable({
        HERMES_BASE_URL: "https://h.example",
        HERMES_API_KEY: "secret",
      }, false),
      true,
    );
    assert.equal(isHostedChatAvailable({}, false), false);
    assert.equal(isHostedChatAvailable({}, true), true);
  });

  it("offers a picker fallback that does not name Hermes", () => {
    const models = hermesFallbackPickerModels({
      HERMES_BASE_URL: "https://h.example",
      HERMES_API_KEY: "secret",
      HERMES_MODEL_NAME: "hermes-agent",
    });
    assert.equal(models.length, 1);
    assert.equal(models[0].id, "hermes-agent");
    assert.match(models[0].label, /Aether/i);
    assert.doesNotMatch(models[0].label, /hermes/i);
    assert.doesNotMatch(models[0].description ?? "", /hermes/i);
  });
});
