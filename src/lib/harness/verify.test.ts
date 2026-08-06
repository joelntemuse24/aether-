import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runVerifyChecklist, verifySystemAddendum } from "./verify";

describe("runVerifyChecklist", () => {
  it("passes when ready and all checks ok", () => {
    const out = runVerifyChecklist({
      summary: "Draft essay ready",
      ready_for_user: true,
      checks: [
        { item: "Prompt covered", ok: true },
        { item: "Citations present", ok: true },
      ],
    });
    assert.equal(out.verified, true);
    assert.equal(out.failed.length, 0);
  });

  it("fails when checks fail", () => {
    const out = runVerifyChecklist({
      summary: "Draft",
      ready_for_user: true,
      checks: [{ item: "Word count", ok: false, note: "too short" }],
    });
    assert.equal(out.verified, false);
    assert.ok(out.failed.includes("Word count"));
  });
});

describe("verifySystemAddendum", () => {
  it("requires verify for deep write", () => {
    const block = verifySystemAddendum({
      depth: "deep",
      intent: "write",
    });
    assert.ok(block);
    assert.match(block!, /verify_checklist/);
  });

  it("skips for shallow chat", () => {
    const block = verifySystemAddendum({
      depth: "shallow",
      intent: "chat",
    });
    assert.equal(block, null);
  });
});
