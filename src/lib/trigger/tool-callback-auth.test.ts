import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signAgentContextToken } from "./context-token";
import { resolveToolCallbackAuth } from "./tool-callback-auth";

describe("durable agent → Aether tool callback auth", () => {
  const secret = "auth-secret";

  it("accepts a signed context JWT and does not require the shared callback secret", async () => {
    const token = await signAgentContextToken(
      {
        userId: "user-1",
        conversationId: "c1",
        approvalMode: "ask",
        hasMemory: true,
        hasDrive: true,
        hasGitHub: false,
      },
      secret,
    );
    const resolved = await resolveToolCallbackAuth(
      { authorization: `Bearer ${token}` },
      { AUTH_SECRET: secret },
    );
    assert.equal(resolved.ok, true);
    if (resolved.ok && resolved.kind === "jwt") {
      assert.equal(resolved.ctx.userId, "user-1");
      assert.equal(resolved.ctx.conversationId, "c1");
      assert.equal(resolved.ctx.hasDrive, true);
    }
  });

  it("still accepts the existing shared callback bearer", async () => {
    const resolved = await resolveToolCallbackAuth(
      { authorization: "Bearer tool-secret" },
      { AETHER_TOOLS_TOKEN: "tool-secret", AUTH_SECRET: secret },
    );
    assert.equal(resolved.ok, true);
    if (resolved.ok) assert.equal(resolved.kind, "shared");
  });

  it("rejects random bearers", async () => {
    const resolved = await resolveToolCallbackAuth(
      { authorization: "Bearer nope" },
      { AETHER_TOOLS_TOKEN: "tool-secret", AUTH_SECRET: secret },
    );
    assert.equal(resolved.ok, false);
  });
});
