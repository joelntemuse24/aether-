import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffText } from "./diff";

describe("artifact text diff", () => {
  it("marks added and removed lines", () => {
    const lines = diffText("alpha\nbeta\n", "alpha\ngamma\n");
    const added = lines.filter((l) => l.type === "add").map((l) => l.text);
    const removed = lines.filter((l) => l.type === "del").map((l) => l.text);
    const same = lines.filter((l) => l.type === "same").map((l) => l.text);
    assert.deepEqual(same, ["alpha"]);
    assert.deepEqual(removed, ["beta"]);
    assert.deepEqual(added, ["gamma"]);
  });

  it("returns all-same when texts match", () => {
    const lines = diffText("one\ntwo", "one\ntwo");
    assert.ok(lines.every((l) => l.type === "same"));
    assert.deepEqual(lines.map((l) => l.text), ["one", "two"]);
  });

  it("handles empty previous version", () => {
    const lines = diffText("", "hello");
    assert.deepEqual(lines, [{ type: "add", text: "hello" }]);
  });
});
