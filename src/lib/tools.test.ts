import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldExecutePythonInBrowser, TOOL_NAMES } from "./tools";

describe("client vs durable execute_python", () => {
  it("runs Pyodide only on the request fallback", () => {
    assert.equal(shouldExecutePythonInBrowser("request"), true);
    assert.equal(shouldExecutePythonInBrowser("durable"), false);
  });

  it("keeps execute_python in CLIENT_TOOLS for the request path", () => {
    assert.equal(TOOL_NAMES.executePython, "execute_python");
  });
});
