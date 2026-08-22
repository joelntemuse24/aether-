import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  forgetAetherToolSession,
  getAetherToolSession,
  parseUserIdFromSessionKey,
  registerAetherToolSession,
} from "./tool-session";

describe("Aether tool session", () => {
  it("registers and looks up a turn session without exposing a store API to the host", () => {
    registerAetherToolSession({
      sessionKey: "aether:user:u1",
      userId: "u1",
      conversationId: "c1",
      projectId: null,
      runId: null,
      approvalMode: "auto",
      hasMemory: true,
      hasDrive: true,
      hasGitHub: false,
      driveAccessToken: "secret-token",
    });
    const row = getAetherToolSession("aether:user:u1");
    assert.equal(row?.userId, "u1");
    assert.equal(row?.approvalMode, "auto");
    assert.equal(row?.driveAccessToken, "secret-token");
    forgetAetherToolSession("aether:user:u1");
    assert.equal(getAetherToolSession("aether:user:u1"), null);
  });

  it("parses user id from the session key", () => {
    assert.equal(parseUserIdFromSessionKey("aether:user:abc"), "abc");
    assert.equal(parseUserIdFromSessionKey("aether:anon:c1"), null);
  });
});
