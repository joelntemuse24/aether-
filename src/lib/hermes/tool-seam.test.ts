import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hermesAetherToolSeamAddendum } from "./tool-seam";

describe("hermes Aether tool seam", () => {
  it("documents Aether-owned tools as prompt-only this slice", () => {
    const text = hermesAetherToolSeamAddendum({
      toolsEnabled: true,
      hasDrive: true,
      hasGitHub: true,
      hasMemory: true,
    });
    assert.match(text, /memory/i);
    assert.match(text, /Drive/);
    assert.match(text, /GitHub/);
    assert.match(text, /artifact/i);
    assert.match(text, /confirm/i);
    assert.doesNotMatch(text, /memory_search/);
    assert.doesNotMatch(text, /create_artifact/);
    assert.doesNotMatch(text, /request_confirmation/);
  });
});
