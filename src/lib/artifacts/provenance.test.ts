import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeProvenance, provenanceLabels } from "./provenance";

describe("artifact provenance", () => {
  it("records the producing tool", () => {
    const rows = mergeProvenance([], ["create_artifact"], "2026-09-11T00:00:00.000Z");
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.tool, "create_artifact");
    assert.equal(rows[0]?.at, "2026-09-11T00:00:00.000Z");
  });

  it("skips duplicate consecutive tools and empty names", () => {
    const first = mergeProvenance([], ["create_artifact"], "t1");
    const next = mergeProvenance(first, ["create_artifact", "", "workspace_exec"], "t2");
    assert.equal(next.length, 2);
    assert.equal(next[1]?.tool, "workspace_exec");
  });

  it("maps tools to display labels without vendor names", () => {
    const labels = provenanceLabels([
      { tool: "create_artifact", at: "t" },
      { tool: "create_presentation", at: "t" },
    ]);
    assert.deepEqual(labels, ["Artifact", "Presentation"]);
    assert.ok(labels.every((label) => !/openai|anthropic|claude|gpt/i.test(label)));
  });
});
