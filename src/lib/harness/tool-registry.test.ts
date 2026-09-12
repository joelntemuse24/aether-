import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TOOL_NAMES } from "@/lib/tools";
import { buildToolRegistry, resolveAvailableToolNames } from "./tool-registry";

describe("tool availability vs Cloud route", () => {
  it("keeps workspace and office-file tools on Cloud (tools are not a speed-tier gate)", () => {
    const names = resolveAvailableToolNames({ userId: "user-1" });
    for (const name of [
      TOOL_NAMES.workspaceExec,
      TOOL_NAMES.workspacePublishFile,
      TOOL_NAMES.createPresentation,
      TOOL_NAMES.createSpreadsheet,
      TOOL_NAMES.createDocument,
      TOOL_NAMES.createPdf,
      TOOL_NAMES.createArtifact,
      TOOL_NAMES.currentTime,
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

  it("gives execute_python a durable execute so the worker can finish the turn", async () => {
    const calls: Array<{ name: string; args: unknown }> = [];
    const tools = buildToolRegistry({
      executeAetherOwned: async (name, args) => {
        calls.push({ name, args });
        return { ok: true, stdout: "12:00 Europe/Dublin\n", durationMs: 8 };
      },
    });
    const python = tools[TOOL_NAMES.executePython];
    assert.equal(typeof python?.execute, "function");
    const out = await python.execute!(
      { code: "print('hi')" },
      {
        toolCallId: "t1",
        messages: [],
        abortSignal: new AbortController().signal,
      },
    );
    assert.deepEqual(calls, [
      { name: TOOL_NAMES.executePython, args: { code: "print('hi')" } },
    ]);
    assert.equal((out as { ok?: boolean }).ok, true);
    assert.match(String((out as { stdout?: string }).stdout), /Dublin/);
  });

  it("leaves execute_python client-side on the request path", () => {
    const tools = buildToolRegistry({});
    assert.equal(tools[TOOL_NAMES.executePython]?.execute, undefined);
  });
});
