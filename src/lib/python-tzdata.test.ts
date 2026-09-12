import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  WORKSPACE_ENSURE_TZDATA_COMMAND,
  wrapWorkspaceCommandForPythonTzdata,
} from "./python-tzdata";

describe("IANA tzdata for workspace + execute_python", () => {
  it("installs tzdata when ZoneInfo cannot resolve Europe/Dublin", () => {
    assert.match(WORKSPACE_ENSURE_TZDATA_COMMAND, /tzdata/);
    assert.match(WORKSPACE_ENSURE_TZDATA_COMMAND, /Europe\/Dublin/);
    assert.match(WORKSPACE_ENSURE_TZDATA_COMMAND, /pip install|python3 -m pip/);
  });

  it("prefixes python workspace commands so ZoneInfo works", () => {
    const wrapped = wrapWorkspaceCommandForPythonTzdata(
      "python3 -c \"from zoneinfo import ZoneInfo; print(datetime.now(ZoneInfo('Europe/Dublin')))\"",
    );
    assert.match(wrapped, /tzdata/);
    assert.match(wrapped, /python3 -c/);
    assert.match(wrapped, /&&/);
  });

  it("leaves non-python workspace commands unchanged", () => {
    assert.equal(wrapWorkspaceCommandForPythonTzdata("ls -la"), "ls -la");
  });

  it("wraps execute_python snippets as a heredoc python3 command", async () => {
    const { workspacePythonCommand } = await import("./python-tzdata");
    const cmd = workspacePythonCommand(
      "from zoneinfo import ZoneInfo\nprint(ZoneInfo('Europe/Dublin'))",
    );
    assert.match(cmd, /python3 -/);
    assert.match(cmd, /from zoneinfo import ZoneInfo/);
    assert.match(cmd, /Europe\/Dublin/);
    const wrapped = wrapWorkspaceCommandForPythonTzdata(cmd);
    assert.match(wrapped, /tzdata/);
    assert.match(wrapped, /&&/);
  });

  it("Pyodide worker installs tzdata before user code", () => {
    const src = readFileSync(new URL("./pyodide.ts", import.meta.url), "utf8");
    assert.match(src, /tzdata/);
    assert.match(src, /micropip/);
  });

  it("sandbox create ensures tzdata so workspace Python can resolve IANA zones", () => {
    const src = readFileSync(
      new URL("./connectors/workspace.ts", import.meta.url),
      "utf8",
    );
    assert.match(src, /WORKSPACE_ENSURE_TZDATA_COMMAND|ensureWorkspaceTzdata|tzdata/);
  });
});
