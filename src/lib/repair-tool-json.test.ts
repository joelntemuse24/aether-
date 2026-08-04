import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractFirstJsonValue,
  repairToolCallInputJson,
  stripJsonCodeFences,
} from "./repair-tool-json";

describe("repair-tool-json", () => {
  it("extracts the first object from concatenated JSON", () => {
    const raw =
      '{"path": "buy/runner.py", "repo": "joelntemuse24/poly-money-maker"}{"path": "buy/relayer.py", "repo": "joelntemuse24/poly-money-maker"}';
    assert.equal(
      extractFirstJsonValue(raw),
      '{"path": "buy/runner.py", "repo": "joelntemuse24/poly-money-maker"}',
    );
    assert.equal(
      repairToolCallInputJson(raw),
      JSON.stringify({
        path: "buy/runner.py",
        repo: "joelntemuse24/poly-money-maker",
      }),
    );
  });

  it("takes the first element when given an array of objects", () => {
    const raw = JSON.stringify([
      { path: "a.py", repo: "o/r" },
      { path: "b.py", repo: "o/r" },
    ]);
    assert.equal(
      repairToolCallInputJson(raw),
      JSON.stringify({ path: "a.py", repo: "o/r" }),
    );
  });

  it("returns null for already-valid single objects", () => {
    assert.equal(
      repairToolCallInputJson('{"path":"a.py","repo":"o/r"}'),
      null,
    );
  });

  it("strips markdown fences before repairing", () => {
    const fenced =
      '```json\n{"path":"a.py","repo":"o/r"}{"path":"b.py","repo":"o/r"}\n```';
    assert.equal(stripJsonCodeFences(fenced).startsWith("{"), true);
    assert.equal(
      repairToolCallInputJson(fenced),
      JSON.stringify({ path: "a.py", repo: "o/r" }),
    );
  });

  it("handles nested braces inside strings", () => {
    const raw =
      '{"path":"x{y}.ts","repo":"o/r"}{"path":"z.ts","repo":"o/r"}';
    assert.equal(
      repairToolCallInputJson(raw),
      JSON.stringify({ path: "x{y}.ts", repo: "o/r" }),
    );
  });
});
