import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeTrueForgeApproval, encodeTrueForgeApproval } from "./approvals";

describe("TrueForge approval ids", () => {
  it("round-trips the session, thread, and tool call", () => {
    const id = encodeTrueForgeApproval({
      sessionId: "ses_1",
      threadId: "main",
      toolCallId: "call_1",
    });
    assert.equal(id.startsWith("tf_"), true);
    assert.deepEqual(decodeTrueForgeApproval(id), {
      sessionId: "ses_1",
      threadId: "main",
      toolCallId: "call_1",
    });
  });

  it("rejects ids that are not harness approvals", () => {
    assert.equal(decodeTrueForgeApproval("confirm_123"), null);
    assert.equal(decodeTrueForgeApproval("tf_not-json"), null);
  });
});
