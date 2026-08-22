import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { confirmActionCopy } from "./confirm-copy";

describe("confirmActionCopy", () => {
  it("uses a verb plus consequence, with Cancel beside it", () => {
    assert.equal(confirmActionCopy({ tool: "create_artifact" }).confirm, "Save artifact");
    assert.equal(confirmActionCopy({ tool: "memory_write" }).confirm, "Save memory");
    assert.equal(
      confirmActionCopy({ action: "delete_resource" }).confirm,
      "Delete this",
    );
    assert.equal(confirmActionCopy({}).confirm, "Allow this");
    for (const row of [
      confirmActionCopy({ tool: "create_artifact" }),
      confirmActionCopy({ action: "delete_resource" }),
      confirmActionCopy({}),
    ]) {
      assert.equal(row.cancel, "Cancel");
      assert.doesNotMatch(row.confirm, /^(OK|Yes|Approve|Decline)$/i);
    }
  });

  it("keeps sentence case and never names host vendors", () => {
    const row = confirmActionCopy({ tool: "create_artifact" });
    const blob = Object.values(row).join(" ");
    assert.doesNotMatch(blob, /Hermes/i);
    assert.doesNotMatch(blob, /Buzz/i);
    assert.doesNotMatch(blob, /Railway/i);
    assert.doesNotMatch(blob, /OpenRouter/i);
    assert.match(row.approvedNotice, /^You /);
    assert.match(row.cancelledNotice, /^You /);
  });

  it("marks deletes and third-party submits as destructive", () => {
    assert.equal(confirmActionCopy({ action: "delete_resource" }).destructive, true);
    assert.equal(confirmActionCopy({ action: "submit_form" }).destructive, true);
    assert.equal(confirmActionCopy({ tool: "create_artifact" }).destructive, false);
  });
});
