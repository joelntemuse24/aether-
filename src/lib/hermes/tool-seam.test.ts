import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hermesAetherToolSeamAddendum } from "./tool-seam";

describe("hermes Aether tool seam", () => {
  it("declares live Aether tools instead of not-live notes", () => {
    const text = hermesAetherToolSeamAddendum({
      toolsEnabled: true,
      hasDrive: true,
      hasGitHub: true,
      hasMemory: true,
      canPersistArtifacts: true,
    });
    assert.match(text, /memory_search/);
    assert.match(text, /memory_write/);
    assert.match(text, /create_artifact/);
    assert.match(text, /request_confirmation/);
    assert.match(text, /drive_search/);
    assert.match(text, /github_read_file/);
    assert.doesNotMatch(text, /not live tools this turn/i);
    assert.doesNotMatch(text, /not a live tool this turn/i);
    assert.doesNotMatch(text, /not live this turn/i);
    assert.doesNotMatch(text, /Hermes/i);
    assert.doesNotMatch(text, /Buzz/i);
    assert.doesNotMatch(text, /Railway/i);
    assert.doesNotMatch(text, /OpenRouter/i);
  });

  it("keeps unavailable connectors explicit instead of pretending they work", () => {
    const text = hermesAetherToolSeamAddendum({
      toolsEnabled: true,
      hasDrive: false,
      hasGitHub: false,
      hasMemory: false,
      canPersistArtifacts: false,
    });
    assert.doesNotMatch(text, /drive_search/);
    assert.doesNotMatch(text, /github_read_file/);
    assert.match(text, /not connected/i);
    assert.match(text, /create_artifact/);
    assert.match(text, /request_confirmation/);
  });

  it("mentions the fence fallback for same-turn Aether execution", () => {
    const text = hermesAetherToolSeamAddendum({
      toolsEnabled: true,
      hasMemory: true,
    });
    assert.match(text, /\[\[aether_tool\]\]/);
  });
});
