import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approvalDecisionForAetherTool,
  isAlwaysConfirmAetherCall,
  parseToolApprovalMode,
  shouldConfirmAetherTool,
} from "./tool-approval";

describe("parseToolApprovalMode", () => {
  it("defaults to ask", () => {
    assert.equal(parseToolApprovalMode(undefined), "ask");
    assert.equal(parseToolApprovalMode("nope"), "ask");
    assert.equal(parseToolApprovalMode("ASK"), "ask");
  });

  it("accepts auto", () => {
    assert.equal(parseToolApprovalMode("auto"), "auto");
  });
});

describe("Ask vs Auto policy", () => {
  it("lets safe reads run without a card in Ask", () => {
    for (const name of [
      "memory_search",
      "drive_search",
      "drive_read",
      "github_get_repo",
      "github_list_contents",
      "github_read_file",
    ]) {
      assert.equal(
        shouldConfirmAetherTool({ name, mode: "ask" }),
        false,
        name,
      );
    }
  });

  it("gates routine mutations in Ask and allows them in Auto", () => {
    assert.equal(
      shouldConfirmAetherTool({ name: "memory_write", mode: "ask" }),
      true,
    );
    assert.equal(
      shouldConfirmAetherTool({ name: "memory_write", mode: "auto" }),
      false,
    );
  });

  it("does not pause ordinary create_artifact in Ask or Auto", () => {
    assert.equal(
      shouldConfirmAetherTool({ name: "create_artifact", mode: "ask" }),
      false,
    );
    assert.equal(
      shouldConfirmAetherTool({
        name: "create_artifact",
        mode: "ask",
        args: { kind: "data", title: "Q3 costs" },
      }),
      false,
    );
    assert.equal(
      shouldConfirmAetherTool({ name: "create_artifact", mode: "auto" }),
      false,
    );
    assert.equal(
      shouldConfirmAetherTool({
        name: "create_artifact",
        mode: "ask",
        args: { foreignOwner: true },
      }),
      true,
    );
  });

  it("always confirms destructive / spend / submit / foreign writes", () => {
    assert.equal(
      shouldConfirmAetherTool({
        name: "request_confirmation",
        mode: "auto",
      }),
      true,
    );
    assert.equal(
      shouldConfirmAetherTool({
        name: "browser_act",
        args: { action: "submit" },
        mode: "auto",
      }),
      true,
    );
    assert.equal(
      shouldConfirmAetherTool({
        name: "memory_write",
        args: { action: "delete_resource" },
        mode: "auto",
      }),
      true,
    );
    assert.equal(
      isAlwaysConfirmAetherCall("drive_write", { foreignOwner: true }),
      true,
    );
    assert.equal(
      shouldConfirmAetherTool({
        name: "github_write_file",
        args: { targetOwner: "other" },
        mode: "auto",
      }),
      true,
    );
  });

  it("honors skipGate after the user already approved", () => {
    const decision = approvalDecisionForAetherTool({
      name: "memory_write",
      mode: "ask",
      skipGate: true,
    });
    assert.deepEqual(decision, { confirm: false, reason: "skip_gate" });
  });
});
