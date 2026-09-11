import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { storeBrowserScreenshot } from "./browser";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("browser screenshot artifacts", () => {
  it("stores a screenshot as an image artifact the next step can see", async () => {
    const saved = await storeBrowserScreenshot({
      url: "https://example.com/portal",
      title: "Example portal",
      dataUrl: TINY_PNG,
      persistImage: async (input) => ({
        id: "art-shot-1",
        persisted: true,
        kind: "image",
        title: input.title,
        content: input.dataUrl,
      }),
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.kind, "image");
    assert.equal(saved.id, "art-shot-1");
    assert.equal(saved.persisted, true);
    assert.equal(saved.mime, "image/png");
    assert.ok(saved.content?.startsWith("data:image/png"));
    assert.ok(saved.forNextModelStep?.mediaType === "image/png");
    assert.ok(typeof saved.forNextModelStep?.data === "string");
    assert.ok(saved.forNextModelStep.data.length > 8);
  });

  it("keeps the screenshot in-thread when persist is a guest no-op", async () => {
    const saved = await storeBrowserScreenshot({
      url: "https://example.com",
      title: "Example",
      dataUrl: TINY_PNG,
      persistImage: async () => ({ persisted: false }),
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.persisted, false);
    assert.ok(saved.content?.startsWith("data:image/"));
    assert.ok(saved.forNextModelStep);
  });
});
