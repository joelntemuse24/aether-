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
      TOOL_NAMES.createDocument,
      TOOL_NAMES.createPdf,
      TOOL_NAMES.createArtifact,
      TOOL_NAMES.webSearch,
      TOOL_NAMES.browsePage,
      TOOL_NAMES.browserSnapshot,
      TOOL_NAMES.searchImages,
      TOOL_NAMES.generateImage,
      TOOL_NAMES.fetchUrl,
      TOOL_NAMES.workspaceFfmpeg,
      TOOL_NAMES.scheduleCreate,
      TOOL_NAMES.designList,
      TOOL_NAMES.deploymentsList,
      TOOL_NAMES.socialSearch,
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
