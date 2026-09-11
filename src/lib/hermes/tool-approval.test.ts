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
      "github_list_issues",
      "github_get_issue",
      "github_list_pull_requests",
      "github_get_pull_request",
      "github_list_commits",
      "workspace_read_file",
      "workspace_list_files",
      "gmail_search",
      "gmail_read",
      "calendar_list_events",
      "contacts_search",
    ]) {
      assert.equal(
        shouldConfirmAetherTool({ name, mode: "ask" }),
        false,
        name,
      );
    }
  });

  it("gates routine mutations in Ask and allows them in Auto", () => {
    for (const name of [
      "memory_write",
      "gmail_send",
      "gmail_create_draft",
      "calendar_create_event",
      "contacts_create",
    ]) {
      assert.equal(shouldConfirmAetherTool({ name, mode: "ask" }), true, name);
      assert.equal(shouldConfirmAetherTool({ name, mode: "auto" }), false, name);
    }
  });

  it("always confirms image generation (spend)", () => {
    for (const mode of ["ask", "auto"] as const) {
      assert.equal(shouldConfirmAetherTool({ name: "generate_image", mode }), true);
    }
  });

  it("always confirms GitHub publishing actions", () => {
    for (const name of [
      "github_create_issue",
      "github_add_issue_comment",
      "github_create_pull_request",
      "github_merge_pull_request",
    ]) {
      for (const mode of ["ask", "auto"] as const) {
        assert.equal(shouldConfirmAetherTool({ name, mode }), true, `${name}/${mode}`);
      }
    }
  });

  it("gates owned-repo GitHub writes in Ask and allows them in Auto", () => {
    for (const name of ["github_create_branch", "github_create_or_update_file"]) {
      assert.equal(shouldConfirmAetherTool({ name, mode: "ask" }), true, name);
      assert.equal(shouldConfirmAetherTool({ name, mode: "auto" }), false, name);
    }
  });

  it("does not pause ordinary workspace work", () => {
    for (const name of [
      "workspace_exec",
      "workspace_write_file",
      "workspace_publish_file",
    ]) {
      assert.equal(shouldConfirmAetherTool({ name, mode: "ask" }), false, name);
      assert.equal(shouldConfirmAetherTool({ name, mode: "auto" }), false, name);
    }
  });

  it("does not pause create_presentation or create_spreadsheet", () => {
    for (const name of ["create_presentation", "create_spreadsheet"]) {
      assert.equal(shouldConfirmAetherTool({ name, mode: "ask" }), false, name);
      assert.equal(shouldConfirmAetherTool({ name, mode: "auto" }), false, name);
    }
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
    assert.equal(
      shouldConfirmAetherTool({
        name: "create_artifact",
        mode: "ask",
        args: { action: "other_side_effect", title: "Q3 costs" },
      }),
      false,
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
