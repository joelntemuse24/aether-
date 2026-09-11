import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toVisionToolModelOutput } from "./vision-tool-output";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("toVisionToolModelOutput", () => {
  it("feeds stored screenshot bytes to the next model step", () => {
    const out = toVisionToolModelOutput({
      title: "Example portal",
      text: "Login form and dashboard nav.",
      content: TINY_PNG,
      mime: "image/png",
    });
    assert.equal(out.type, "content");
    const text = out.value.find((p) => p.type === "text");
    const media = out.value.find((p) => p.type === "image-data");
    assert.ok(text && text.type === "text");
    assert.match(text.text, /Login form/);
    assert.ok(media && media.type === "image-data");
    assert.equal(media.mediaType, "image/png");
    assert.ok(media.data.length > 8);
    assert.doesNotMatch(media.data, /^data:/);
  });
});
