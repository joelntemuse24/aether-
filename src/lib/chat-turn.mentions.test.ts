import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeChatSystem } from "./chat-turn";

const base = {
  toolsEnabled: true,
  hermesLive: false,
  harnessDepth: "standard" as const,
  harnessIntent: "chat" as const,
  timeBudget: null,
  continueSegment: false,
  hasDrive: true,
  hasGitHub: true,
  hasGmail: true,
  hasBrowserless: false,
  signedIn: true,
  hasMemory: true,
  canPersistArtifacts: true,
  approvalMode: "ask" as const,
};

describe("composeChatSystem connector mentions", () => {
  it("injects a forced Drive/Gmail tool-family note from @ mentions", () => {
    const { system } = composeChatSystem({
      ...base,
      userText: "Save the deck to @Drive and draft it in @Gmail",
    });
    assert.match(system, /Connected-app mentions/);
    assert.match(system, /drive_upload/);
    assert.match(system, /gmail_create_draft/);
    assert.match(system, /never silent-send/);
  });

  it("stays quiet when the user did not @-mention an app", () => {
    const { system } = composeChatSystem({
      ...base,
      userText: "Summarize this thread",
    });
    assert.doesNotMatch(system, /Connected-app mentions/);
  });
});
