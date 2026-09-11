import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateImageForUser, parseGeneratedImageDataUrl } from "./image";

describe("generate_image provider", () => {
  it("is honest when no hosted image key is configured", async () => {
    const prevImage = process.env.AETHER_HOSTED_IMAGE_API_KEY;
    const prevOr = process.env.OPENROUTER_API_KEY;
    delete process.env.AETHER_HOSTED_IMAGE_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      const result = await generateImageForUser({ prompt: "a cream workspace" });
      assert.equal(result.ok, false);
      assert.match(String(result.error), /unavailable/i);
      assert.doesNotMatch(String(result.error), /OpenRouter|Gemini|DALL|vendor/i);
    } finally {
      if (prevImage !== undefined) process.env.AETHER_HOSTED_IMAGE_API_KEY = prevImage;
      if (prevOr !== undefined) process.env.OPENROUTER_API_KEY = prevOr;
    }
  });

  it("accepts a data-URL image from a real provider response", () => {
    const parsed = parseGeneratedImageDataUrl(
      "data:image/png;base64,aaa",
    );
    assert.ok(parsed);
    assert.equal(parsed.mime, "image/png");
    assert.equal(parsed.content, "data:image/png;base64,aaa");
  });
});
