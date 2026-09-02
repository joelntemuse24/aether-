import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { TOOL_NAMES } from "@/lib/tools";
import { buildHeadStartToolSchemas } from "./tool-schemas";

describe("head-start schema-only tools", () => {
  it("exposes core tools without execute fns", () => {
    const tools = buildHeadStartToolSchemas({ toolsEnabled: true });
    assert.ok(tools[TOOL_NAMES.webSearch]);
    assert.ok(tools[TOOL_NAMES.fetchUrl]);
    assert.ok(tools[TOOL_NAMES.createArtifact]);
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
    assert.ok(full[TOOL_NAMES.driveRead]);
    assert.ok(full[TOOL_NAMES.githubReadFile]);
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
