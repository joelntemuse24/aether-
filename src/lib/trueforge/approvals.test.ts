import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeTrueForgeApproval, encodeTrueForgeApproval, trueForgeResumeInput } from "./approvals";

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
      kind: "approval",
    });
  });

  it("rejects ids that are not harness approvals", () => {
    assert.equal(decodeTrueForgeApproval("confirm_123"), null);
    assert.equal(decodeTrueForgeApproval("tf_not-json"), null);
  });
});

it("decodes legacy approvals and response ids and builds the response turn", () => {
  const row = { sessionId: "ses_1", threadId: "main", toolCallId: "call_1" };
  const legacy = `tf_${Buffer.from(JSON.stringify(row)).toString("base64url")}`;
  assert.equal(decodeTrueForgeApproval(legacy)?.kind, "approval");
  const response = decodeTrueForgeApproval(encodeTrueForgeApproval({ ...row, kind: "response" }));
  assert.equal(response?.kind, "response");
  assert.deepEqual(trueForgeResumeInput(response!, { content: "Option A" }), {
    input: [{ type: "user.tool_response", threadId: "main", toolCallId: "call_1", content: "Option A" }],
  });
  assert.deepEqual(trueForgeResumeInput(row, { approved: false }).input[0], {
    type: "user.tool_approval", threadId: "main", toolCallId: "call_1", approval: { status: "deny" },
  });
});
