import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { TOOL_NAMES } from "@/lib/tools";
import { buildHeadStartToolSchemas } from "./tool-schemas";

describe("head-start schema-only tools", () => {
  it("exposes core tools without execute fns", () => {
    const tools = buildHeadStartToolSchemas({ toolsEnabled: true });
    assert.ok(tools[TOOL_NAMES.currentTime]);
    assert.ok(tools[TOOL_NAMES.webSearch]);
    assert.ok(tools[TOOL_NAMES.fetchUrl]);
    assert.ok(tools[TOOL_NAMES.createArtifact]);
    assert.ok(tools[TOOL_NAMES.workspaceExec]);
    assert.ok(tools[TOOL_NAMES.workspaceReadFile]);
    assert.ok(tools[TOOL_NAMES.workspaceWriteFile]);
    assert.ok(tools[TOOL_NAMES.workspaceListFiles]);
    assert.ok(tools[TOOL_NAMES.workspacePublishFile]);
    assert.ok(tools[TOOL_NAMES.createPresentation]);
    assert.ok(tools[TOOL_NAMES.createSpreadsheet]);
    assert.ok(tools[TOOL_NAMES.createDocument]);
    assert.ok(tools[TOOL_NAMES.createPdf]);
    assert.ok(tools[TOOL_NAMES.generateImage]);
    assert.ok(tools[TOOL_NAMES.browsePage]);
    assert.ok(tools[TOOL_NAMES.browserSnapshot]);
    assert.ok(tools[TOOL_NAMES.searchImages]);
    assert.ok(tools[TOOL_NAMES.workspaceFfmpeg]);
    assert.ok(tools[TOOL_NAMES.scheduleCreate]);
    assert.ok(tools[TOOL_NAMES.designList]);
    assert.ok(tools[TOOL_NAMES.deploymentsList]);
    assert.ok(tools[TOOL_NAMES.socialSearch]);
    for (const tool of Object.values(tools)) {
      assert.equal(
        tool && typeof tool === "object" && "execute" in tool && tool.execute != null,
        false,
      );
    }
  });

  it("omits deferred connector tools until the session has those capabilities", () => {
    const core = buildHeadStartToolSchemas({ toolsEnabled: true });
    assert.equal(core[TOOL_NAMES.memorySearch], undefined);
    assert.equal(core[TOOL_NAMES.driveRead], undefined);
    const full = buildHeadStartToolSchemas({
      toolsEnabled: true,
      hasMemory: true,
      hasDrive: true,
      hasGitHub: true,
    });
    assert.ok(full[TOOL_NAMES.memorySearch]);
    assert.ok(full[TOOL_NAMES.projectKnowledgeSearch]);
    assert.ok(full[TOOL_NAMES.driveRead]);
    assert.ok(full[TOOL_NAMES.driveUpload]);
    assert.ok(full[TOOL_NAMES.driveWrite]);
    assert.ok(full[TOOL_NAMES.githubReadFile]);
    assert.ok(full[TOOL_NAMES.githubListIssues]);
    assert.ok(full[TOOL_NAMES.githubCreateOrUpdateFile]);
    assert.ok(full[TOOL_NAMES.githubMergePullRequest]);
    const google = buildHeadStartToolSchemas({
      toolsEnabled: true,
      hasGmail: true,
      hasCalendar: true,
      hasContacts: true,
    });
    assert.ok(google[TOOL_NAMES.gmailSearch]);
    assert.ok(google[TOOL_NAMES.gmailSend]);
    assert.ok(google[TOOL_NAMES.calendarCreateEvent]);
    assert.ok(google[TOOL_NAMES.contactsCreate]);
    // Google tools stay hidden until granted.
    assert.equal(core[TOOL_NAMES.gmailSearch], undefined);
  });

  it("returns no tools when tools are disabled", () => {
    const tools = buildHeadStartToolSchemas({ toolsEnabled: false });
    assert.equal(Object.keys(tools).length, 0);
  });
});

describe("schema module stays light", () => {
  it("does not import execute-side modules", () => {
    const source = readFileSync(
      new URL("./tool-schemas.ts", import.meta.url),
      "utf8",
    );
    const imports = source
      .split("\n")
      .filter((line) => line.startsWith("import "));
    const blob = imports.join("\n");
    assert.doesNotMatch(blob, /tool-registry/);
    assert.doesNotMatch(blob, /web-search/);
    assert.doesNotMatch(blob, /connectors\/browser/);
    assert.doesNotMatch(blob, /aether-tools/);
    assert.doesNotMatch(source, /execute:\s*async/);
  });
});
