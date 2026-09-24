import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTrueForgeUserContent } from "./user-content";

describe("TrueForge user content", () => {
  it("keeps a text-only turn as a string", () => {
    assert.equal(buildTrueForgeUserContent("hello"), "hello");
  });

  it("attaches data-URI files beside the user text", () => {
    const content = buildTrueForgeUserContent("see this", [
      { name: "note.png", mime: "image/png", dataUrl: "data:image/png;base64,abc" },
    ]);
    assert.deepEqual(content, [
      { type: "text", text: "see this" },
      { type: "file", data: "data:image/png;base64,abc", name: "note.png" },
    ]);
  });
});
