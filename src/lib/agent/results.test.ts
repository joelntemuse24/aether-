import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { capToolResult, DEFAULT_TOOL_RESULT_CHARS, toolError, toolOk } from "./results";

describe("agent tool results", () => {
  it("keeps a small success payload", () => {
    const result = capToolResult(toolOk({ title: "Weather" }));
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.data, { title: "Weather" });
  });

  it("caps a huge payload and drops the tail", () => {
    const result = capToolResult(toolOk("x".repeat(50_000) + "END_MARKER"), 200);
    const encoded = JSON.stringify(result);
    assert.ok(encoded.length <= 200);
    assert.equal(encoded.includes("END_MARKER"), false);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal((result.data as { truncated?: boolean }).truncated, true);
  });

  it("caps a failure without dropping retryable", () => {
    const result = capToolResult(toolError("e".repeat(DEFAULT_TOOL_RESULT_CHARS), true), 120);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.retryable, true);
      assert.match(result.error, /truncated/i);
    }
  });
});
