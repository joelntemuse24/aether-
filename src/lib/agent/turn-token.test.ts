import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mintTurnToken, verifyTurnToken } from "./turn-token";

const secret = "test-secret";

const claims = {
  sub: "user-1",
  conversationId: "c1",
  tools: ["web_search"],
  approvalMode: "ask" as const,
  requestId: "r1",
};

describe("turn token", () => {
  it("round-trips the claims and ignores a short bearer", async () => {
    const token = await mintTurnToken(claims, secret);
    assert.equal(token.split(".").length, 3);
    const verified = await verifyTurnToken(token, secret);
    assert.deepEqual(verified, claims);
    assert.equal(await verifyTurnToken(token, "other-secret"), null);
  });

  it("rejects an expired token", async () => {
    const token = await mintTurnToken(claims, secret, {
      now: new Date(Date.now() - 120_000),
      expiresAt: new Date(Date.now() - 60_000),
    });
    assert.equal(await verifyTurnToken(token, secret), null);
  });
});
