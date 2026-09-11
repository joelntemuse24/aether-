import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ARTIFACT_KINDS, TOOL_NAMES } from "@/lib/tools";
import { buildHeadStartToolSchemas } from "@/lib/harness/tool-schemas";
import { bumpArtifactVersions } from "./versions";
import { mergeProvenance } from "./provenance";

describe("Milestone C wiring", () => {
  it("exposes html and react artifact kinds to create_artifact", () => {
    assert.ok((ARTIFACT_KINDS as readonly string[]).includes("html"));
    assert.ok((ARTIFACT_KINDS as readonly string[]).includes("react"));
    assert.ok((ARTIFACT_KINDS as readonly string[]).includes("markdown"));
    assert.ok((ARTIFACT_KINDS as readonly string[]).includes("csv"));
  });

  it("exposes project_knowledge_search when memory/cloud is on", () => {
    const tools = buildHeadStartToolSchemas({
      toolsEnabled: true,
      hasMemory: true,
    });
    assert.ok(tools[TOOL_NAMES.projectKnowledgeSearch]);
    assert.equal(
      tools[TOOL_NAMES.projectKnowledgeSearch] &&
        typeof tools[TOOL_NAMES.projectKnowledgeSearch] === "object" &&
        "execute" in tools[TOOL_NAMES.projectKnowledgeSearch] &&
        tools[TOOL_NAMES.projectKnowledgeSearch].execute != null,
      false,
    );
  });

  it("sandboxes HTML/React live preview without parent cookie access", () => {
    const src = readFileSync(
      new URL("../../components/layout/artifact-panel.tsx", import.meta.url),
      "utf8",
    );
    assert.match(src, /kind === "html"/);
    assert.match(src, /kind === "react"/);
    assert.match(src, /sandbox="allow-scripts"/);
    assert.doesNotMatch(
      src,
      /sandbox="allow-scripts allow-same-origin"/,
    );
  });

  it("bumps versions and records provenance on persist helpers", () => {
    const versions = bumpArtifactVersions(
      bumpArtifactVersions([], "", "<h1>Hi</h1>", "t1"),
      "<h1>Hi</h1>",
      "<h1>Hello</h1>",
      "t2",
    );
    assert.equal(versions.length, 2);
    const provenance = mergeProvenance([], ["create_artifact"], "t1");
    assert.equal(provenance[0]?.tool, "create_artifact");
  });
});
