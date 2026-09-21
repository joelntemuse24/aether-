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

describe("current_time stays server-side", () => {
  it("never addToolResults the clock from the browser", async () => {
    const { shouldExecuteCurrentTimeInBrowser } = await import("./tools");
    assert.equal(shouldExecuteCurrentTimeInBrowser("durable"), false);
    assert.equal(shouldExecuteCurrentTimeInBrowser("request"), false);
  });
});

describe("tool system prompt requires a grounded final answer", () => {
  it("tells the model to estimate with caveats and never finish on tools", async () => {
    const { TOOLS_SYSTEM_PROMPT } = await import("./tools");
    assert.match(TOOLS_SYSTEM_PROMPT, /Always end the turn with a clear, user-visible answer/);
    assert.match(TOOLS_SYSTEM_PROMPT, /numeric estimate|grounded estimate/i);
    assert.match(TOOLS_SYSTEM_PROMPT, /caveat/i);
  });
});
