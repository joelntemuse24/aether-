import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveWorkspacePath } from "./workspace";

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
