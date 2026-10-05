import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { composerFootnote, composerPlaceholder } from "./composer-chrome";

describe("composer chrome", () => {
  it("chooses placeholders for mic and turn states", () => {
    assert.equal(composerPlaceholder({ micState: "listening", isFirstTurn: true }), "Listening…");
    assert.equal(composerPlaceholder({ micState: "transcribing", isFirstTurn: false }), "Transcribing…");
    assert.equal(composerPlaceholder({ micState: "idle", isFirstTurn: true }), "How can I help you today?");
    assert.equal(composerPlaceholder({ micState: "idle", isFirstTurn: false }), "Write a message…");
  });

  it("shows the footnote after the first turn", () => {
    assert.equal(composerFootnote({ isFirstTurn: true }), null);
    assert.equal(composerFootnote({ isFirstTurn: false }), "Aether can make mistakes. Check important details.");
  });

  it("keeps the composer in one tree position and uses the new chrome", () => {
    const source = readFileSync(new URL("../../components/assistant-ui/thread.tsx", import.meta.url), "utf8");
    assert.match(source, /composerPlaceholder/);
    assert.match(source, /gap-y-6/);
    assert.equal(source.match(/<Composer \/>/g)?.length, 1);
    assert.doesNotMatch(source, /PaperclipIcon/);
  });
});
