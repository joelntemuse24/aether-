import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TOOL_NAMES } from "@/lib/tools";
import { resolveAvailableToolNames } from "./tool-registry";

describe("tool availability vs Fast/Expert", () => {
  it("keeps workspace and office-file tools on Cloud regardless of speed tier", () => {
    const names = resolveAvailableToolNames({ userId: "user-1" });
    for (const name of [
      TOOL_NAMES.workspaceExec,
      TOOL_NAMES.workspacePublishFile,
      TOOL_NAMES.createPresentation,
      TOOL_NAMES.createSpreadsheet,
      TOOL_NAMES.createArtifact,
      TOOL_NAMES.webSearch,
    ]) {
      assert.ok(names.includes(name), name);
    }
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        resolveAvailableToolNames,
        "speedTier",
      ),
      false,
    );
  });
});
