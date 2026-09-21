import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TOOL_NAMES } from "@/lib/tools";
import { buildHeadStartFastTools } from "./head-start-fast-tools";
import { buildHeadStartToolSchemas } from "./tool-schemas";

describe("head-start fast tools", () => {
  it("executes read-only search/time tools on step 1 and leaves mutations schema-only", () => {
    const tools = buildHeadStartFastTools({ toolsEnabled: true });
    assert.equal(typeof tools[TOOL_NAMES.webSearch]?.execute, "function");
    assert.equal(typeof tools[TOOL_NAMES.currentTime]?.execute, "function");
    assert.equal(typeof tools[TOOL_NAMES.fetchUrl]?.execute, "function");
    assert.equal(typeof tools[TOOL_NAMES.browsePage]?.execute, "function");
    assert.equal(
      tools[TOOL_NAMES.createArtifact] &&
        typeof tools[TOOL_NAMES.createArtifact] === "object" &&
        "execute" in tools[TOOL_NAMES.createArtifact] &&
        tools[TOOL_NAMES.createArtifact].execute != null,
      false,
    );
    assert.equal(
      tools[TOOL_NAMES.executePython] &&
        typeof tools[TOOL_NAMES.executePython] === "object" &&
        "execute" in tools[TOOL_NAMES.executePython] &&
        tools[TOOL_NAMES.executePython].execute != null,
      false,
    );
  });

  it("still returns no tools when tools are disabled", () => {
    const tools = buildHeadStartFastTools({ toolsEnabled: false });
    assert.equal(Object.keys(tools).length, 0);
    assert.equal(Object.keys(buildHeadStartToolSchemas({ toolsEnabled: false })).length, 0);
  });
});
