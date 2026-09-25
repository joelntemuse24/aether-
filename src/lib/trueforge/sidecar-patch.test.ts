import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { applyTrueForgeSidecarPatches } from "./sidecar-patch";

const PACKAGE_FILES = [
  "node_modules/@truefoundry/trueforge-core/dist/core/runtime/DeferredTool.js",
  "node_modules/@truefoundry/trueforge-core/dist/core/runtime/DeferredTool.mjs",
  "node_modules/@truefoundry/trueforge-core/dist/core/sandbox/Sandbox.js",
  "node_modules/@truefoundry/trueforge-core/dist/core/sandbox/Sandbox.mjs",
];

describe("TrueForge sidecar patch", () => {
  it("hides discovery tools when every server is preloaded and shortens the sandbox prompt", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tf-patch-"));
    for (const relative of PACKAGE_FILES) {
      const from = path.join(process.cwd(), relative);
      const to = path.join(root, relative);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
    const patched = applyTrueForgeSidecarPatches(root);
    assert.equal(patched.length, PACKAGE_FILES.length);
    for (const relative of PACKAGE_FILES.filter((file) => file.includes("DeferredTool"))) {
      const text = fs.readFileSync(path.join(root, relative), "utf8");
      assert.match(text, /!server\.preload/);
      assert.match(text, /return \[\]/);
    }
    for (const relative of PACKAGE_FILES.filter((file) => file.includes("Sandbox"))) {
      const text = fs.readFileSync(path.join(root, relative), "utf8");
      assert.match(text, /skills\.includes\("SKILL.md"\)/);
      assert.match(text, /exec can reach these MCP servers/);
      assert.match(text, /buildSchemaSection\(builder\) \{\n    return;/);
      assert.match(text, /sandbox_artifacts block/);
      const mcp = text.indexOf("exec can reach these MCP servers");
      const essay = text.indexOf("from mcp_client import call_tool");
      assert.ok(mcp > 0 && essay > mcp);
      assert.ok(text.slice(mcp, essay).includes("return;"));
    }
    assert.deepEqual(applyTrueForgeSidecarPatches(root), []);
  });
});
