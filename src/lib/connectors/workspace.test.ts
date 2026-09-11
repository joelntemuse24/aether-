import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyWorkspaceError,
  resolveWorkspacePath,
  sandboxAuthFromEnv,
  workspaceExec,
  workspaceReadBinary,
  WORKSPACE_UNAVAILABLE_MESSAGE,
  type WorkspaceSandbox,
} from "./workspace";

function fakeSandbox(over: Partial<WorkspaceSandbox> = {}): WorkspaceSandbox {
  return {
    runCommand: async () => ({
      exitCode: 0,
      stdout: async () => "ok\n",
      stderr: async () => "",
      durationMs: 12,
    }),
    mkDir: async () => undefined,
    readFileToBuffer: async () => Buffer.from("hello"),
    writeFiles: async () => undefined,
    ...over,
  };
}

describe("workspace path boundary", () => {
  it("resolves relative paths inside the workspace", () => {
    assert.equal(
      resolveWorkspacePath("src/app.ts"),
      "/vercel/sandbox/workspace/src/app.ts",
    );
    assert.equal(
      resolveWorkspacePath("./notes/todo.md"),
      "/vercel/sandbox/workspace/notes/todo.md",
    );
  });

  it("rejects empty paths and path traversal", () => {
    assert.equal(resolveWorkspacePath(""), null);
    assert.equal(resolveWorkspacePath("../secret"), null);
    assert.equal(resolveWorkspacePath("../../etc/passwd"), null);
  });
});

describe("sandbox auth from env", () => {
  it("returns credentials when token, team, and project are set", () => {
    assert.deepEqual(
      sandboxAuthFromEnv({
        VERCEL_TOKEN: "tok",
        VERCEL_TEAM_ID: "team_1",
        VERCEL_PROJECT_ID: "prj_1",
      }),
      { token: "tok", teamId: "team_1", projectId: "prj_1" },
    );
  });

  it("accepts OIDC token and org id aliases", () => {
    assert.deepEqual(
      sandboxAuthFromEnv({
        VERCEL_OIDC_TOKEN: "oidc",
        VERCEL_ORG_ID: "team_2",
        VERCEL_PROJECT_ID: "prj_2",
      }),
      { token: "oidc", teamId: "team_2", projectId: "prj_2" },
    );
  });

  it("returns null when auth is incomplete", () => {
    assert.equal(
      sandboxAuthFromEnv({
        VERCEL_PROJECT_ID: "prj_1",
        VERCEL_ORG_ID: "team_1",
      }),
      null,
    );
  });
});

describe("workspace_exec failure path", () => {
  it("does not swallow a missing conversation as a generic outage", async () => {
    const result = await workspaceExec(
      { userId: "u1", conversationId: null },
      { command: "pwd" },
      { getSandbox: async () => fakeSandbox() },
    );
    assert.equal(result.ok, false);
    assert.match(String(result.error), /conversation/i);
    assert.doesNotMatch(String(result.error), /unavailable/i);
  });

  it("fails loud with a file-tool fallback when the sandbox cannot start", async () => {
    const result = await workspaceExec(
      { userId: "u1", conversationId: "c1" },
      { command: "pip install python-pptx" },
      {
        getSandbox: async () => {
          throw new Error("OIDC token missing");
        },
      },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error, WORKSPACE_UNAVAILABLE_MESSAGE);
    assert.match(String(result.error), /create_presentation/);
    assert.match(String(result.error), /create_spreadsheet/);
    assert.doesNotMatch(String(result.error), /Vercel|E2B|Trigger/i);
  });

  it("maps credential errors to the same user-facing copy", () => {
    assert.equal(
      classifyWorkspaceError(new Error("Unauthorized (401)")),
      WORKSPACE_UNAVAILABLE_MESSAGE,
    );
    assert.match(
      classifyWorkspaceError(new Error("conversation scope is required")),
      /conversation/i,
    );
  });
});

describe("workspace_exec happy path", () => {
  it("runs a command in the isolated workspace when the sandbox is up", async () => {
    let seen = "";
    const result = await workspaceExec(
      { userId: "u1", conversationId: "c1" },
      { command: "pwd && ls" },
      {
        getSandbox: async (identity) => {
          assert.equal(identity.conversationId, "c1");
          return fakeSandbox({
            runCommand: async (input) => {
              seen = [input.cmd, ...input.args].join(" ");
              return {
                exitCode: 0,
                stdout: async () => "/vercel/sandbox/workspace\ndeck.pptx\n",
                stderr: async () => "",
                durationMs: 40,
              };
            },
          });
        },
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.match(String(result.stdout), /deck\.pptx/);
    assert.match(seen, /bash/);
    assert.match(seen, /pwd && ls/);
  });

  it("publishes a binary workspace file as a buffer", async () => {
    const pptx = Buffer.from("PK\x03\x04binary-pptx");
    const result = await workspaceReadBinary(
      { userId: "u1", conversationId: "c1" },
      { path: "out/deck.pptx" },
      {
        getSandbox: async () =>
          fakeSandbox({
            readFileToBuffer: async () => pptx,
          }),
      },
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.buffer.equals(pptx), true);
    }
  });
});
