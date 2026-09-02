import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  signAgentContextToken,
  verifyAgentContextToken,
  AGENT_CONTEXT_PURPOSE,
} from "./context-token";

describe("agent context JWT", () => {
  const secret = "test-auth-secret-for-agent-context";

  it("round-trips user/conversation context without cookies", async () => {
    const token = await signAgentContextToken(
      {
        userId: "user-1",
        conversationId: "c1",
        projectId: "p1",
        approvalMode: "ask",
        hasMemory: true,
        hasDrive: true,
        hasGitHub: false,
        driveAccessToken: "ya29.drive-access",
        driveRefreshToken: "1//drive-refresh",
        driveExpiresAt: Date.now() + 60_000,
      },
      secret,
    );
    const parsed = await verifyAgentContextToken(token, secret);
    assert.ok(parsed);
    assert.equal(parsed.purpose, AGENT_CONTEXT_PURPOSE);
    assert.equal(parsed.userId, "user-1");
    assert.equal(parsed.conversationId, "c1");
    assert.equal(parsed.projectId, "p1");
    assert.equal(parsed.hasDrive, true);
    assert.equal(parsed.hasGitHub, false);
    assert.equal(parsed.driveAccessToken, "ya29.drive-access");
    assert.equal(parsed.driveRefreshToken, "1//drive-refresh");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signAgentContextToken(
      {
        userId: "user-1",
        conversationId: "c1",
        approvalMode: "auto",
        hasMemory: false,
        hasDrive: false,
        hasGitHub: false,
      },
      secret,
    );
    assert.equal(await verifyAgentContextToken(token, "other-secret"), null);
    assert.equal(await verifyAgentContextToken("not-a-jwt", secret), null);
  });
});
